<?php
header('Content-Type: application/json');

require_once __DIR__ . '/../config/paymongo_config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../rate_limit.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../url_signer.php';

hof_rate_limit('create_qrph_payment', 5, 60);

$input = json_decode(file_get_contents('php://input'), true);

if (!$input || empty($input['order_id']) || empty($input['reference_number'])) {
    echo json_encode([
        'success' => false,
        'message' => 'Missing required fields: order_id, reference_number'
    ]);
    exit;
}

$order_id = (int)$input['order_id'];
$reference_number = $input['reference_number'];
$method = $input['method'] ?? 'qrph';
$sig = $input['sig'] ?? '';
$device_id = $input['device_id'] ?? '';

$staffUserId = null;
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$hasStaffAuth = false;
if (preg_match('/Bearer\s+(.+)/i', $authHeader, $m)) {
    $token = $m[1];
    $parts = explode('.', $token);
    if (count($parts) === 3) {
        $expectedSig = hash_hmac('sha256', $parts[0] . '.' . $parts[1], JWT_SECRET, true);
        $gotSig = base64_decode(str_replace(['-', '_'], ['+', '/'], $parts[2]));
        if ($gotSig !== false && hash_equals($expectedSig, $gotSig)) {
            $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $parts[1])), true);
            if (is_array($payload) && ($payload['exp'] ?? 0) > time()) {
                $roleLower = strtolower(trim($payload['role'] ?? ''));
                if (in_array($roleLower, ['cashier', 'admin', 'supervisor'], true)) {
                    $hasStaffAuth = true;
                    $staffUserId = (int)$payload['user_id'];
                }
            }
        }
    }
}

if (!$hasStaffAuth) {
    if (!$sig) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Missing signature — please start from the payment page']);
        exit;
    }
    hof_require_signed_params(['order_id' => $order_id, 'ref' => $reference_number, 'purpose' => 'pay'], $sig, false, true);
}

$orderStmt = $pdo->prepare("SELECT total_amount, payment_status, payment_intent_id, payment_intent_status, status FROM orders WHERE order_id = ?");
$orderStmt->execute([$order_id]);
$dbOrder = $orderStmt->fetch(PDO::FETCH_ASSOC);

if (!$dbOrder) {
    http_response_code(404);
    echo json_encode(['success' => false, 'message' => 'Order not found.']);
    exit;
}
if ($dbOrder['payment_status'] === 'COMPLETED') {
    http_response_code(409);
    echo json_encode(['success' => false, 'message' => 'This order is already paid.']);
    exit;
}
if ($dbOrder['status'] === 'CANCELLED') {
    http_response_code(409);
    echo json_encode(['success' => false, 'message' => 'This order has expired. Please see the cashier.']);
    exit;
}

$amount = (float)$dbOrder['total_amount'];

// ── QUICK DOUBLE PAYMENT GUARD ──
// Return existing payment data from DB without hitting PayMongo API
$existingIntentStatus = $dbOrder['payment_intent_status'] ?? '';
$existingIntentId = $dbOrder['payment_intent_id'] ?? '';

if (in_array($existingIntentStatus, ['awaiting_payment_method', 'awaiting_next_action', 'processing']) && !empty($existingIntentId)) {
    // The payments table has no payment_intent_id column on the local DB —
    // match on the order row (orders.payment_intent_id is authoritative).
    // Re-derive QR/redirect from the intent via the PayMongo API (single
    // round-trip) so resume shows the same doors as before.
    $qrCodeSrc = null;
    $redirectUrl = null;
    try {
        $checkResp = payMongoRequest('/v1/payment_intents/' . $existingIntentId, 'GET');
        if ($checkResp['status_code'] === 200) {
            $attrs = $checkResp['response']['data']['attributes'] ?? [];
            if (isset($attrs['next_action']['qr_code']['src'])) {
                $qrCodeSrc = $attrs['next_action']['qr_code']['src'];
            }
            if (isset($attrs['next_action']['redirect']['url'])) {
                $redirectUrl = $attrs['next_action']['redirect']['url'];
            }
        }
    } catch (Throwable $e) { /* fall through with nulls */ }

    http_response_code(200);
    echo json_encode([
        'success' => true,
        'payment_intent_id' => $existingIntentId,
        'qr_code_src' => $qrCodeSrc,
        'redirect_url' => $redirectUrl,
        'existing_intent' => true
    ]);
    exit;
}

try {
    // Single-intent guard: reuse existing intent if still valid
    $existingIntentId = $dbOrder['payment_intent_id'];
    $existingStatus = $dbOrder['payment_intent_status'];

    if ($existingIntentId && in_array($existingStatus, ['awaiting_payment_method', 'awaiting_next_action', 'processing'], true)) {
        $checkResp = payMongoRequest('/v1/payment_intents/' . $existingIntentId, 'GET');
        if ($checkResp['status_code'] === 200) {
            $pi = $checkResp['response']['data'];
            $attrs = $pi['attributes'];
            $qrCodeSrc = null;
            if (isset($attrs['next_action']['qr_code']['src'])) {
                $qrCodeSrc = $attrs['next_action']['qr_code']['src'];
            }
            $redirectUrl = null;
            if (isset($attrs['next_action']['redirect']['url'])) {
                $redirectUrl = $attrs['next_action']['redirect']['url'];
            }

            echo json_encode([
                'success' => true,
                'resumed' => true,
                'payment_intent_id' => $existingIntentId,
                'client_key' => $attrs['client_key'] ?? '',
                'qr_code_src' => $qrCodeSrc,
                'redirect_url' => $redirectUrl,
                'status' => $attrs['status'] ?? $existingStatus,
                'message' => 'Resuming existing payment'
            ]);
            exit;
        }
    }

    // Step 1: Create Payment Intent with both methods
    $intentData = [
        'data' => [
            'attributes' => [
                'amount' => (int)round($amount * 100),
                'currency' => PAYMONGO_CURRENCY,
                'description' => 'House of Fries Order - ' . $reference_number,
                'payment_method_allowed' => ['gcash', 'qrph'],
                'metadata' => [
                    'order_id' => (string)$order_id,
                    'reference_number' => (string)$reference_number
                ]
            ]
        ]
    ];

    $intentResponse = payMongoRequest('/v1/payment_intents', 'POST', $intentData);
    if ($intentResponse['status_code'] !== 200) {
        throw new Exception('Failed to create payment intent');
    }

    $paymentIntent = $intentResponse['response']['data'];
    $intentId = $paymentIntent['id'];
    $clientKey = $paymentIntent['attributes']['client_key'] ?? '';

    // Step 2: Create and attach QRPh payment method (primary door)
    $qrCodeSrc = null;
    $qrphMethodResponse = payMongoRequest('/v1/payment_methods', 'POST', [
        'data' => ['attributes' => ['type' => 'qrph']]
    ]);

    if ($qrphMethodResponse['status_code'] === 200) {
        $qrphMethodId = $qrphMethodResponse['response']['data']['id'];

        $attachQrph = payMongoRequest('/v1/payment_intents/' . $intentId . '/attach', 'POST', [
            'data' => ['attributes' => ['payment_method' => $qrphMethodId]]
        ]);

        if ($attachQrph['status_code'] === 200) {
            $attached = $attachQrph['response']['data'];
            if (isset($attached['attributes']['next_action']['qr_code']['src'])) {
                $qrCodeSrc = $attached['attributes']['next_action']['qr_code']['src'];
            }
        }
    }

    // Step 3: Create and attach GCash payment method (second door)
    $redirectUrl = null;
    $gcashMethodResponse = payMongoRequest('/v1/payment_methods', 'POST', [
        'data' => ['attributes' => ['type' => 'gcash']]
    ]);

    if ($gcashMethodResponse['status_code'] === 200) {
        $gcashMethodId = $gcashMethodResponse['response']['data']['id'];
        $checkSig = hof_sign_params(['order_id' => $order_id, 'purpose' => 'check']);
        $returnUrl = PAYMONGO_RETURN_URL . '?order_id=' . $order_id . '&sig=' . urlencode($checkSig);

        $attachGcash = payMongoRequest('/v1/payment_intents/' . $intentId . '/attach', 'POST', [
            'data' => ['attributes' => [
                'payment_method' => $gcashMethodId,
                'return_url' => $returnUrl
            ]]
        ]);

        if ($attachGcash['status_code'] === 200) {
            $gcashAttached = $attachGcash['response']['data'];
            if (isset($gcashAttached['attributes']['next_action']['redirect']['url'])) {
                $redirectUrl = $gcashAttached['attributes']['next_action']['redirect']['url'];
            }
        }
    }

    // Step 4: Update order in database
    $status = $paymentIntent['attributes']['status'] ?? 'awaiting_next_action';
    $stmt = $pdo->prepare("
        UPDATE orders 
        SET payment_intent_id = ?, payment_intent_status = ?, payment_status = 'PENDING'
        WHERE order_id = ?
    ");
    $stmt->execute([$intentId, $status, $order_id]);

$desc = "Dual-door (QRPh/GCash) ₱{$amount} for #{$reference_number}";
if ($device_id) {
    $safeDevice = substr(preg_replace('/[^a-zA-Z0-9_-]/', '', $device_id), 0, 40);
    $desc .= " device:{$safeDevice}";
}
logActivity($pdo, null, 'GUEST', 'Customer',
    'PAYMENT_INTENT_CREATED', $desc,
    'order', $order_id, $reference_number);

    echo json_encode([
        'success' => true,
        'payment_intent_id' => $intentId,
        'client_key' => $clientKey,
        'qr_code_src' => $qrCodeSrc,
        'redirect_url' => $redirectUrl,
        'status' => $status,
        'message' => 'Dual-door payment created successfully'
    ]);

} catch (Exception $e) {
    error_log('create-qrph-payment error: ' . $e->getMessage());
    echo json_encode([
        'success' => false,
        'message' => 'Payment service unavailable. Please try again.'
    ]);
}