<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../backend/db.php";
require_once __DIR__ . "/../backend/rate_limit.php";
require_once __DIR__ . "/../backend/log_activity_helper.php";
require_once __DIR__ . "/../backend/url_signer.php";

hof_rate_limit('update_dining', 15, 60);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['success' => false, 'message' => 'Invalid request protocol.']);
    exit;
}

$jsonInput = file_get_contents('php://input');
$data = json_decode($jsonInput, true);

$orderId = isset($data['order_id']) ? intval($data['order_id']) : 0;
$diningOption = isset($data['dining_option']) ? trim($data['dining_option']) : '';
$ref = isset($data['ref']) ? trim($data['ref']) : '';
$sig = isset($data['sig']) ? trim($data['sig']) : '';

if ($orderId <= 0 || empty($diningOption) || empty($ref) || empty($sig)) {
    echo json_encode(['success' => false, 'message' => 'Missing required parameters.']);
    exit;
}

// REQ-050 H4: only the two enum values are accepted.
$diningOption = strtoupper($diningOption);
if (!in_array($diningOption, ['DINE_IN', 'TAKE_OUT'], true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid serving style.']);
    exit;
}

hof_require_signed_params(['order_id' => $orderId, 'ref' => $ref, 'purpose' => 'dining'], $sig, false, true);

try {
    // REQ-050 H4: only PENDING + unpaid orders may change their serving style.
    $verifyStmt = $pdo->prepare("SELECT reference_number, status, payment_status FROM orders WHERE order_id = ?");
    $verifyStmt->execute([$orderId]);
    $dbOrder = $verifyStmt->fetch(PDO::FETCH_ASSOC);
    if (!$dbOrder) {
        echo json_encode(['success' => false, 'message' => 'Order not found.']);
        exit;
    }
    if ($dbOrder['reference_number'] !== $ref) {
        echo json_encode(['success' => false, 'message' => 'Reference mismatch.']);
        exit;
    }
    if ($dbOrder['status'] !== 'PENDING' || $dbOrder['payment_status'] === 'COMPLETED') {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This order can no longer be changed. You can place a new order instead.']);
        exit;
    }

    $stmt = $pdo->prepare("UPDATE orders SET order_type = :order_type WHERE order_id = :order_id");
    $result = $stmt->execute([
        'order_type' => $diningOption,
        'order_id' => $orderId
    ]);

    if ($result) {
        logActivity($pdo, null, 'GUEST', 'Customer', 'UPDATE_DINING_PREFERENCE', "Changed dining preference for order #{$ref}", 'order', $orderId, $ref);
        echo json_encode(['success' => true, 'message' => 'Serving style updated!']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Failed to execute update statement.']);
    }
} catch (PDOException $e) {
    error_log('update_dining_preference error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Server DB Error.']);
}