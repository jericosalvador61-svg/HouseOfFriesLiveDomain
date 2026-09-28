<?php
header('Content-Type: application/json');

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../url_signer.php';

$order_id = isset($_GET['order_id']) ? (int)$_GET['order_id'] : 0;
$ref = $_GET['ref'] ?? '';
$sig = $_GET['sig'] ?? '';
$device_id = $_GET['device_id'] ?? '';

if (!$order_id || !$ref || !$sig) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing params']);
    exit;
}

hof_require_signed_params(['order_id' => $order_id, 'ref' => $ref, 'purpose' => 'pay'], $sig);

$stmt = $pdo->prepare("SELECT total_amount, status, reference_number, payment_intent_id, payment_intent_status FROM orders WHERE order_id = ?");
$stmt->execute([$order_id]);
$order = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$order) {
    http_response_code(404);
    echo json_encode(['success' => false, 'message' => 'Order not found']);
    exit;
}

if ($order['reference_number'] !== $ref) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Reference mismatch']);
    exit;
}

echo json_encode([
    'success' => true,
    'total_amount' => (float)$order['total_amount'],
    'status' => $order['status'],
    'reference_number' => $order['reference_number'],
    'payment_intent_id' => $order['payment_intent_id'],
    'payment_intent_status' => $order['payment_intent_status']
]);