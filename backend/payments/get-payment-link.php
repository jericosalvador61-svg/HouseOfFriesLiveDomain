<?php
header('Content-Type: application/json');

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../url_signer.php';
require_once __DIR__ . '/../rate_limit.php';

hof_rate_limit('get_payment_link', 10, 60);

$input = json_decode(file_get_contents('php://input'), true);
$order_id = isset($input['order_id']) ? (int)$input['order_id'] : 0;
$ref = $input['ref'] ?? '';
$purpose = $input['purpose'] ?? 'pay';
$device_id = $input['device_id'] ?? '';

if (!$order_id || !$ref) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing order_id or ref']);
    exit;
}

if (!in_array($purpose, ['pay', 'track', 'check', 'items', 'dining', 'cancel', 'receipt'], true)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Invalid purpose']);
    exit;
}

$stmt = $pdo->prepare("SELECT reference_number, status FROM orders WHERE order_id = ?");
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

if ($order['status'] === 'CANCELLED' && $purpose === 'pay') {
    http_response_code(409);
    echo json_encode(['success' => false, 'message' => 'Order has expired — cannot generate payment link']);
    exit;
}

$params = in_array($purpose, ['check', 'track'], true)
    ? ['order_id' => $order_id, 'purpose' => $purpose]
    : ['order_id' => $order_id, 'ref' => $ref, 'purpose' => $purpose];
$sig = hof_sign_params($params);

$scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$qrPage = '/customer/qr_payment.html';
$signedUrl = $scheme . '://' . $host . $qrPage . '?order_id=' . $order_id . '&ref=' . urlencode($ref) . '&sig=' . urlencode($sig);

echo json_encode([
    'success' => true,
    'signed_url' => $signedUrl,
    'sig' => $sig
]);