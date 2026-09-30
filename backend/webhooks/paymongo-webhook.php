<?php
/**
 * PayMongo Webhook Handler
 * 
 * Receives payment status updates from PayMongo API.
 * 
 * PayMongo webhook payload shape:
 * {
 *   "data": {
 *     "id": "evt_...",
 *     "type": "payment.paid",            // event type lives HERE
 *     "attributes": {
 *       "data": {                        // the resource
 *         "id": "pay_...",
 *         "type": "payment",
 *         "attributes": { amount, status, payment_method, metadata, ... }
 *       }
 *     }
 *   }
 * }
 * 
 * @author Jerico (BSIT Capstone)
 * @version 2.0
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/paymongo_config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../pusher_helper.php';
require_once __DIR__ . '/../notifications/notification_helper.php';
require_once __DIR__ . '/../log_activity_helper.php';

// Log webhook received
$logFile = __DIR__ . '/../logs/paymongo_webhook.log';
$logDir = dirname($logFile);
if (!is_dir($logDir)) {
    mkdir($logDir, 0755, true);
}

function logWebhook($message) {
    global $logFile;
    file_put_contents($logFile, date('Y-m-d H:i:s') . " - $message\n", FILE_APPEND);
}

// Get raw webhook data
$rawBody = file_get_contents('php://input');
$input = json_decode($rawBody, true);

// REQ-050 (Phase 4): NEVER log the full payload (card/BIN/last4 risk).
// Log only event type + order reference (if present) + a SHA-256 hash of the body.
$eventTypeForLog = $input['data']['type'] ?? 'unknown';
$refForLog = '';
if (is_array($input['data']['attributes']['data']['attributes']['metadata'] ?? null)) {
    $refForLog = $input['data']['attributes']['data']['attributes']['metadata']['reference_number'] ?? '';
}
$bodyHash = hash('sha256', $rawBody);
logWebhook("Webhook received: event={$eventTypeForLog} order_ref=" . ($refForLog ?: 'n/a') . " sha256={$bodyHash}");

if (!$input || !isset($input['data'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid webhook payload']);
    exit;
}

// ------------------------------------------------------------------
// Signature verification
// PayMongo sends ONE header:  Paymongo-Signature: t=<ts>,v1=<hmac>
// HMAC key = PAYMONGO_WEBHOOK_SECRET (whsec_...), NOT the API secret.
// ------------------------------------------------------------------
$signatureHeader = $_SERVER['HTTP_PAYMONGO_SIGNATURE'] ?? '';

if (empty($signatureHeader)) {
    http_response_code(400);
    logWebhook('Rejected: missing Paymongo-Signature header');
    echo json_encode(['success' => false, 'message' => 'Missing signature header']);
    exit;
}

// Parse t=... and v1=... out of the single header
$parts = [];
foreach (explode(',', $signatureHeader) as $piece) {
    $kv = explode('=', trim($piece), 2);
    if (count($kv) === 2) {
        $parts[$kv[0]] = $kv[1];
    }
}
$timestamp = $parts['t'] ?? '';
$signature = $parts['v1'] ?? '';

if (empty($timestamp) || empty($signature)) {
    http_response_code(400);
    logWebhook('Rejected: malformed signature header');
    echo json_encode(['success' => false, 'message' => 'Malformed signature header']);
    exit;
}

// Timestamp freshness (within 5 minutes)
if (abs(time() - (int)$timestamp) > 300) {
    http_response_code(400);
    logWebhook('Rejected: timestamp too old');
    echo json_encode(['success' => false, 'message' => 'Request timestamp too old']);
    exit;
}

if (PAYMONGO_WEBHOOK_SECRET === '') {
    // REQ-050 C4: never skip signature verification. A missing secret is a
    // misconfiguration — reject the webhook so a payment can never be flipped
    // by a forged payload.
    http_response_code(403);
    logWebhook('Rejected: PAYMONGO_WEBHOOK_SECRET is not configured');
    echo json_encode(['success' => false, 'message' => 'Webhook not configured']);
    exit;
}

$expectedSignature = hash_hmac('sha256', $timestamp . '.' . $rawBody, PAYMONGO_WEBHOOK_SECRET);
if (!hash_equals($expectedSignature, $signature)) {
    http_response_code(401);
    logWebhook('Rejected: invalid signature');
    echo json_encode(['success' => false, 'message' => 'Invalid signature']);
    exit;
}

try {
    // Event type lives at data.type (NOT data.attributes.type)
    $eventType = $input['data']['type'] ?? '';

    if ($eventType === 'payment.paid' || $eventType === 'checkout.session.paid') {
        // Payment was successful!
        $resource     = $input['data']['attributes']['data'] ?? null;
        $paymentData  = $resource['attributes'] ?? [];   // flat fields: amount, status, metadata, payment_method
        $paymentId    = $resource['id'] ?? '';

        $amount        = ($paymentData['amount'] ?? 0) / 100; // Convert from centavos
        $status        = $paymentData['status'] ?? '';
        $metadata      = $paymentData['metadata'] ?? [];
        $rawMethod     = strtolower($paymentData['payment_method'] ?? 'gcash');

        // Normalize to payments.payment_method enum ('CASH','CARD','GCASH','ONLINE')
        $methodMap = ['cash' => 'CASH', 'card' => 'CARD', 'gcash' => 'GCASH', 'grab_pay' => 'ONLINE', 'paymaya' => 'ONLINE', 'maya' => 'ONLINE'];
        $paymentMethod = $methodMap[$rawMethod] ?? 'ONLINE';

        $orderId          = $metadata['order_id'] ?? null;
        $referenceNumber  = $metadata['reference_number'] ?? null;

        if ($orderId && $status === 'paid') {
            $pdo->beginTransaction();
            try {
            // Check order status first — do NOT resurrect CANCELLED
            $chkStmt = $pdo->prepare("SELECT status FROM orders WHERE order_id = ?");
            $chkStmt->execute([$orderId]);
            $orderStatus = $chkStmt->fetchColumn();

            if ($orderStatus === 'CANCELLED') {
                $stmt = $pdo->prepare("
                    INSERT INTO payments (
                        order_id, amount_paid, payment_method, payment_status, paid_at, transaction_reference
                    ) VALUES (?, ?, ?, 'COMPLETED', NOW(), ?)
                ");
                $stmt->execute([$orderId, $amount, $paymentMethod, $paymentId]);

                logActivity($pdo, null, 'SYSTEM', 'SYSTEM',
                    'PAYMENT_LATE_ON_CANCELLED', "Late payment (webhook) for CANCELLED order #{$referenceNumber} — resolves manually",
                    'order', $orderId, $referenceNumber);

                logWebhook("Late payment recorded for CANCELLED Order #$orderId ($referenceNumber)");
                echo json_encode([
                    'success' => true,
                    'message' => 'Late payment recorded — order remains cancelled'
                ]);
                $pdo->commit();
                exit;
            }

            // Update order status — kitchen sees IN-PROGRESS orders
            $stmt = $pdo->prepare("
                UPDATE orders 
                SET status = 'IN-PROGRESS', 
                    payment_status = 'COMPLETED',
                    payment_intent_status = 'succeeded'
                WHERE order_id = ? AND payment_status <> 'COMPLETED'
            ");
            $stmt->execute([$orderId]);

            if ($stmt->rowCount() > 0) {
                // Create payment record (idempotent — only when order was actually flipped)
                // Attributed to the staff on the order (if any) for sales reporting
                $stmt = $pdo->prepare("
                    INSERT INTO payments (
                        order_id, 
                        user_id,
                        amount_paid, 
                        payment_method, 
                        payment_status, 
                        paid_at,
                        transaction_reference
                    ) VALUES (?, (SELECT user_id FROM orders WHERE order_id = ?), ?, ?, 'COMPLETED', NOW(), ?)
                ");
                $stmt->execute([$orderId, $orderId, $amount, $paymentMethod, $paymentId]);

                // Broadcast real-time update
                if (function_exists('broadcastOrderUpdate')) {
                    broadcastOrderUpdate($orderId, "Order #$referenceNumber payment confirmed via GCash. Ready for kitchen.");
                }

                // Notify Kitchen Staff: paid order ready to prepare
                hof_notify_roles($pdo, 'order_paid', 'GCash Payment Received',
                    "Order #$referenceNumber paid. Please start preparing it.",
                    ['Kitchen Staff'], '/public/kitchenStaff/kitchen_dashboard.html');

                logActivity($pdo, null, 'SYSTEM', 'SYSTEM',
                    'PAYMENT_WEBHOOK', "{$eventType}: payment confirmed for #{$referenceNumber}",
                    'order', $orderId, $referenceNumber);
            }

            $pdo->commit();
            logWebhook("Payment confirmed for Order #$orderId ($referenceNumber)");
            echo json_encode([
                'success' => true,
                'message' => 'Payment confirmed and order updated'
            ]);
        } catch (Exception $e) {
            $pdo->rollBack();
            throw $e;
        }
        } else {
            logWebhook("Order not found or already processed (order_id=$orderId, status=$status)");
            echo json_encode([
                'success' => false,
                'message' => 'Order not found or already processed'
            ]);
        }

    } elseif ($eventType === 'payment.failed' || $eventType === 'checkout.session.failed') {
        // Payment failed
        $resource    = $input['data']['attributes']['data'] ?? null;
        $paymentData = $resource['attributes'] ?? [];
        $metadata    = $paymentData['metadata'] ?? [];
        $orderId     = $metadata['order_id'] ?? null;
        $refNumber   = $metadata['reference_number'] ?? null;

        if ($orderId) {
            $stmt = $pdo->prepare("
                UPDATE orders 
                SET payment_status = 'FAILED',
                    payment_intent_status = 'failed'
                WHERE order_id = ?
            ");
            $stmt->execute([$orderId]);

            // REQ-050: log failed payment
            logActivity($pdo, null, 'SYSTEM', 'SYSTEM',
                'PAYMENT_FAILED', "{$eventType}: payment failed for #" . ($refNumber ?? $orderId),
                'order', (int)$orderId, $refNumber, 'FAILED');

            logWebhook("Payment failed for Order #$orderId ($refNumber)");
        }

        echo json_encode([
            'success' => true,
            'message' => 'Payment failure recorded'
        ]);

    } else {
        logWebhook('Event type not handled: ' . $eventType);
        echo json_encode([
            'success' => true,
            'message' => 'Event type not handled: ' . $eventType
        ]);
    }

} catch (Exception $e) {
    logWebhook('Error: ' . $e->getMessage());
    echo json_encode([
        'success' => false,
        'message' => 'Webhook processing error'
    ]);
}
?>