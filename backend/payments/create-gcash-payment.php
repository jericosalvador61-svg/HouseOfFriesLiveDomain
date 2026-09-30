<?php
/**
 * Create GCash Payment - PayMongo Integration
 * 
 * Creates a PayMongo Payment Intent for GCash payment
 * 
 * @author Jerico (BSIT Capstone)
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../config/paymongo_config.php';
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../rate_limit.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../url_signer.php';

// Rate limit: 5 GCash payment creations per 60 seconds per IP
// (PayMongo intents cost money — strict limit)
hof_rate_limit('create_gcash_payment', 5, 60);

// Get request data
$input = json_decode(file_get_contents('php://input'), true);

// Validate input
if (!$input || empty($input['order_id']) || empty($input['amount']) || empty($input['reference_number'])) {
    echo json_encode([
        'success' => false,
        'message' => 'Missing required fields: order_id, amount, reference_number'
    ]);
    exit;
}

$order_id = (int)$input['order_id'];
$amount = (float)$input['amount'];
$reference_number = $input['reference_number'];
$sig = isset($input['sig']) ? trim($input['sig']) : '';
$device_id = isset($input['device_id']) ? trim($input['device_id']) : '';

// ── OWNERSHIP GATE (REQ-050 H2) ──
// A signed payload (purpose='pay', issued for THIS order + device by
// get-payment-link.php) is required. Knowing the order id + ref alone is
// never enough — otherwise any stranger could mint PayMongo intents on
// someone else's order.
if (empty($sig)) {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'message' => 'Missing signature — please start from the payment page'
    ]);
    exit;
}
try {
    // purpose='pay' links are signed WITHOUT device_id by get-payment-link.php;
    // verify exactly the same param set the issuer used.
    $verifyParams = ['order_id' => $order_id, 'ref' => (string)$reference_number, 'purpose' => 'pay'];
    hof_require_signed_params($verifyParams, $sig, false, true);
} catch (Throwable $e) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Invalid or expired link']);
    exit;
}

// ── REFERENCE VALIDATION (REQ-050 H2) ──
// The reference_number must belong to the order — a mismatched ref means the
// payload was crafted for a different order than the one being charged.
$refStmt = $pdo->prepare("SELECT reference_number FROM orders WHERE order_id = ?");
$refStmt->execute([$order_id]);
$dbRef = $refStmt->fetchColumn();
if ($dbRef === false || $dbRef !== (string)$reference_number) {
    http_response_code(403);
    echo json_encode([
        'success' => false,
        'message' => 'Reference mismatch'
    ]);
    exit;
}

try {
    $pdo->beginTransaction();

    // ── ORDER EXISTENCE + DOUBLE-PAYMENT GUARD + AMOUNT CROSS-CHECK ──
    $checkStmt = $pdo->prepare("
        SELECT total_amount, payment_status, payment_intent_status
        FROM orders 
        WHERE order_id = ? 
        FOR UPDATE
    ");
    $checkStmt->execute([$order_id]);
    $orderRow = $checkStmt->fetch(PDO::FETCH_ASSOC);

    if (!$orderRow) {
        $pdo->rollBack();
        echo json_encode([
            'success' => false,
            'message' => 'Order not found'
        ]);
        exit;
    }

    if ($orderRow['payment_status'] === 'COMPLETED') {
        $pdo->rollBack();
        echo json_encode([
            'success' => false,
            'message' => 'This order is already paid'
        ]);
        exit;
    }

    // ── IN-PROGRESS PAYMENT GUARD ──
    // If the order already has a payment intent still being processed,
    // reject creating a new one (prevents duplicate PayMongo intents).
    $activeStatuses = ['awaiting_payment_method', 'awaiting_payment', 'awaiting_next_action', 'processing'];
    if (!empty($orderRow['payment_intent_status']) && in_array($orderRow['payment_intent_status'], $activeStatuses, true)) {
        $pdo->rollBack();
        echo json_encode([
            'success' => false,
            'message' => 'A payment is already being processed for this order'
        ]);
        exit;
    }

    // Server-side authority: use DB total_amount, never the client-provided amount
    $dbTotal = round((float)$orderRow['total_amount'], 2);
    if (abs($amount - $dbTotal) > 0.009) {
        $pdo->rollBack();
        echo json_encode([
            'success' => false,
            'message' => 'Amount does not match order total. Expected: ₱' . number_format($dbTotal, 2)
        ]);
        exit;
    }

    // Step 1: Create Payment Intent — use the verified DB total
    $intentData = [
        'data' => [
            'attributes' => [
                'amount' => (int)round($dbTotal * 100), // Convert to centavos (integer)
                'currency' => PAYMONGO_CURRENCY,
                'description' => 'House of Fries Order - ' . $reference_number,
                // PayMongo requires allowed methods for e-wallets — GCash only
                'payment_method_allowed' => ['gcash'],
                // FLAT string metadata only — PayMongo rejects numeric values
                // ("metadata attributes cannot be nested") and nested objects
                'metadata' => [
                    'order_id' => (string)$order_id,
                    'reference_number' => (string)$reference_number
                ]
            ]
        ]
    ];
    
    $intentResponse = payMongoRequest('/v1/payment_intents', 'POST', $intentData);
    
    if ($intentResponse['status_code'] !== 200) {
        throw new Exception('Failed to create payment intent: ' . json_encode($intentResponse['response']));
    }
    
    $paymentIntent = $intentResponse['response']['data'];
    $intentId = $paymentIntent['id'];
    $clientKey = $paymentIntent['attributes']['client_key'];
    
    // Step 2: Create GCash Payment Method
    // NOTE: for e-wallets PayMongo accepts type alone — do NOT send an empty
    // details object ({} is rejected as "cannot be blank"; key omitted = OK).
    $methodData = [
        'data' => [
            'attributes' => [
                'type' => 'gcash'
            ]
        ]
    ];
    
    $methodResponse = payMongoRequest('/v1/payment_methods', 'POST', $methodData);
    
    if ($methodResponse['status_code'] !== 200) {
        throw new Exception('Failed to create payment method: ' . json_encode($methodResponse['response']));
    }
    
    $paymentMethod = $methodResponse['response']['data'];
    $methodId = $paymentMethod['id'];
    
    // Step 3: Attach Payment Method to Intent
    $attachData = [
        'data' => [
            'attributes' => [
                'payment_method' => $methodId,
                'return_url' => PAYMONGO_RETURN_URL . '?order_id=' . $order_id
            ]
        ]
    ];
    
    $attachResponse = payMongoRequest('/v1/payment_intents/' . $intentId . '/attach', 'POST', $attachData);
    
    if ($attachResponse['status_code'] !== 200) {
        throw new Exception('Failed to attach payment method: ' . json_encode($attachResponse['response']));
    }
    
    $updatedIntent = $attachResponse['response']['data'];
    $status = $updatedIntent['attributes']['status'];
    
    // Step 4: Get redirect URL
    $redirectUrl = null;
    if (isset($updatedIntent['attributes']['next_action']['redirect']['url'])) {
        $redirectUrl = $updatedIntent['attributes']['next_action']['redirect']['url'];
    }
    
    // Step 5: Update order in database
    $stmt = $pdo->prepare("
        UPDATE orders 
        SET payment_intent_id = ?, payment_intent_status = ?, payment_status = 'PENDING'
        WHERE order_id = ?
    ");
    $stmt->execute([$intentId, $status, $order_id]);

    $pdo->commit();

    logActivity($pdo, null, 'GUEST', 'Customer',
        'PAYMENT_INTENT_CREATED', "GCash ₱{$dbTotal} for #{$reference_number}",
        'order', $order_id, $reference_number);

    echo json_encode([
        'success' => true,
        'payment_intent_id' => $intentId,
        'client_key' => $clientKey,
        'payment_method_id' => $methodId,
        'status' => $status,
        'redirect_url' => $redirectUrl,
        'message' => 'Payment intent created successfully'
    ]);
    
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo json_encode([
        'success' => false,
        'message' => 'Payment processing failed. Please try again.'
    ]);
}
?>