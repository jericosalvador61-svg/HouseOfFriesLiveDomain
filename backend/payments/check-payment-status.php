<?php
/**
 * Check Payment Status - Local Sandbox Verification
 * 
 * Verifies a PayMongo Payment Intent directly against the PayMongo API
 * and (once, when paid) confirms the order:
 *   - order status  -> IN-PROGRESS  (appears in kitchen KDS)
 *   - payment       -> COMPLETED    (inserted into payments table)
 *   - Pusher        -> new-order broadcast (dashboard + tracker)
 * 
 * WHY THIS FILE EXISTS:
 * PayMongo webhooks cannot reach localhost, so during local sandbox
 * testing the return page (checkout.html) calls this endpoint instead.
 * On the live domain the webhook (paymongo-webhook.php) does the same job.
 * Verification is server-side using the secret key — the client cannot fake it.
 * 
 * GET /backend/payments/check-payment-status.php?order_id=113
 * 
 * @author Jerico (BSIT Capstone)
 * @version 1.0
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/paymongo_config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../pusher_helper.php';
require_once __DIR__ . '/../notifications/notification_helper.php';
require_once __DIR__ . '/../secret.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../url_signer.php';

$order_id = isset($_GET['order_id']) ? (int)$_GET['order_id'] : 0;

if (!$order_id) {
    echo json_encode(['success' => false, 'message' => 'Missing order_id']);
    exit;
}

$sig = $_GET['sig'] ?? '';
$device_id = $_GET['device_id'] ?? '';

$staffUserId = null;
$staffUsername = 'GUEST';
$staffRole = 'Customer';
$hasStaffAuth = false;
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$candidate = null;
if (preg_match('/Bearer\s+(\S+)/i', $authHeader, $m)) {
    $candidate = $m[1];
}
if ($candidate) {
    $parts = explode('.', $candidate);
    if (count($parts) === 3) {
        $jwtExpected = hash_hmac('sha256', $parts[0] . '.' . $parts[1], JWT_SECRET, true);
        $jwtGot = base64_decode(str_replace(['-', '_'], ['+', '/'], $parts[2]));
        if ($jwtGot !== false && hash_equals($jwtExpected, $jwtGot)) {
            $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $parts[1])), true);
            if (is_array($payload) && ($payload['exp'] ?? 0) > time() && !empty($payload['user_id'])) {
                $roleLower = strtolower(trim($payload['role'] ?? ''));
                if (in_array($roleLower, ['cashier', 'admin', 'supervisor'], true)) {
                    $hasStaffAuth = true;
                    $staffUserId = (int)$payload['user_id'];
                    $staffUsername = $payload['username'] ?? 'Staff';
                    $staffRole = $payload['role'] ?? 'Staff';
                }
            }
        }
    }
}

if (!$hasStaffAuth && !$sig) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Missing signature']);
    exit;
}
if (!$hasStaffAuth) {
    hof_require_signed_params(['order_id' => $order_id, 'purpose' => 'check'], $sig, false, true);
}

try {
    // 1. Load order + payment intent
    $stmt = $pdo->prepare("
        SELECT order_id, status, payment_intent_id, payment_status, reference_number, total_amount
        FROM orders WHERE order_id = ?
    ");
    $stmt->execute([$order_id]);
    $order = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$order) {
        echo json_encode(['success' => false, 'message' => 'Order not found']);
        exit;
    }

    // Already confirmed — nothing to do (idempotent)
    if ($order['payment_status'] === 'COMPLETED') {
        echo json_encode([
            'success' => true,
            'paid' => true,
            'already_paid' => true,
            'status' => $order['status'],
            'reference_number' => $order['reference_number']
        ]);
        exit;
    }

    if (empty($order['payment_intent_id'])) {
        echo json_encode(['success' => false, 'message' => 'No payment intent found for this order']);
        exit;
    }

    // 2. Ask PayMongo for the current intent state (server-side, secret key)
    $resp = payMongoRequest('/v1/payment_intents/' . $order['payment_intent_id'], 'GET');

    if ($resp['status_code'] !== 200) {
        throw new Exception('PayMongo verification failed: ' . json_encode($resp['response']));
    }

    $intent = $resp['response']['data']['attributes'] ?? [];
    $intentStatus = $intent['status'] ?? '';

    // Guard: do NOT resurrect a cancelled order — but DO record the payment
    if ($intentStatus === 'succeeded' && $order['status'] === 'CANCELLED') {
        error_log('check-payment-status: Late payment detected for CANCELLED order ' . $order_id);

        $paymentId = isset($intent['payments'][0]['id']) ? $intent['payments'][0]['id'] : ('intent_' . $order['payment_intent_id']);
        $amount    = ($intent['amount'] ?? $order['total_amount'] * 100) / 100;

        $stmt = $pdo->prepare("
            INSERT INTO payments (
                order_id, user_id, amount_paid, payment_method, payment_status, paid_at, transaction_reference
            ) VALUES (?, ?, ?, 'GCASH', 'COMPLETED', NOW(), ?)
        ");
        $stmt->execute([$order_id, $staffUserId, $amount, $paymentId]);

        logActivity($pdo, null, 'SYSTEM', 'SYSTEM',
            'PAYMENT_LATE_ON_CANCELLED', "Late payment for CANCELLED order #{$order['reference_number']} — resolves manually",
            'order', $order_id, $order['reference_number']);

        echo json_encode([
            'success' => false,
            'paid' => true,
            'late_payment' => true,
            'message' => 'Payment received for a cancelled order. Please see the cashier for resolution.',
            'reference_number' => $order['reference_number']
        ]);
        exit;
    }

    if ($intentStatus === 'succeeded') {
        $pdo->beginTransaction();
        try {
            // 3a. Flip the order into the kitchen pipeline — once only
            $stmt = $pdo->prepare("
                UPDATE orders 
                SET status = 'IN-PROGRESS',
                    payment_status = 'COMPLETED',
                    payment_intent_status = 'succeeded'
                WHERE order_id = ? AND payment_status <> 'COMPLETED'
            ");
            $stmt->execute([$order_id]);

            if ($stmt->rowCount() > 0) {
                // 3b. Record the payment — attributed to the logged-in cashier when known
                $paymentId = isset($intent['payments'][0]['id']) ? $intent['payments'][0]['id'] : ('intent_' . $order['payment_intent_id']);
                $amount    = ($intent['amount'] ?? $order['total_amount'] * 100) / 100;

                $stmt = $pdo->prepare("
                    INSERT INTO payments (
                        order_id, user_id, amount_paid, payment_method, payment_status, paid_at, transaction_reference
                    ) VALUES (?, ?, ?, 'GCASH', 'COMPLETED', NOW(), ?)
                ");
                $stmt->execute([$order_id, $staffUserId, $amount, $paymentId]);

                // Attribute the order to the verifying staff as well (if unassigned)
                if ($staffUserId !== null) {
                    $upd = $pdo->prepare("UPDATE orders SET user_id = ? WHERE order_id = ? AND user_id IS NULL");
                    $upd->execute([$staffUserId, $order_id]);
                }

                // 3c. Tell the kitchen dashboards in real time
                if (function_exists('broadcastOrderUpdate')) {
                    broadcastOrderUpdate($order_id, "Order #{$order['reference_number']} paid via GCash. Ready for kitchen.", 'IN-PROGRESS');
                }

                // Notify Kitchen Staff: GCash-paid order ready to prepare
                hof_notify_roles($pdo, 'order_paid', 'GCash Payment Received',
                    "Order #{$order['reference_number']} paid via GCash. Please start preparing it.",
                    ['Kitchen Staff'], '/public/kitchenStaff/kitchen_dashboard.html');

                logActivity($pdo, $staffUserId, $staffUsername, $staffRole,
                    'PAYMENT_STATUS_SYNCED', "GCash: {$order['payment_status']}→COMPLETED for #{$order['reference_number']}",
                    'order', $order_id, $order['reference_number']);
            }

            $pdo->commit();
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }

        echo json_encode([
            'success' => true,
            'paid' => true,
            'status' => 'IN-PROGRESS',
            'reference_number' => $order['reference_number']
        ]);

    } elseif (in_array($intentStatus, ['awaiting_payment_method', 'awaiting_next_action', 'processing'], true)) {
        // Still waiting on GCash — customer hasn't finished (or sandbox lag)
        echo json_encode([
            'success' => false,
            'paid' => false,
            'message' => 'Payment still processing',
            'status' => 'PENDING'
        ]);

    } elseif (in_array($intentStatus, ['failed', 'cancelled', 'canceled'], true)) {
        echo json_encode([
            'success' => false,
            'paid' => false,
            'message' => 'Payment failed or cancelled',
            'status' => 'FAILED'
        ]);

    } else {
        echo json_encode([
            'success' => false,
            'paid' => false,
            'message' => 'Unknown payment status: ' . $intentStatus,
            'status' => 'PENDING'
        ]);
    }

} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'message' => $e->getMessage()
    ]);
}
?>