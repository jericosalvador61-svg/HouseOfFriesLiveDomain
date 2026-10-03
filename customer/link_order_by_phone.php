<?php
/**
 * customer/link_order_by_phone.php
 * REQ-062 #13 / #1 — Guest → login bridge.
 *
 * Links a completed guest order to a customer account by phone number.
 * The order must be COMPLETED/SERVED (or paid) and must NOT already be
 * linked. Identity is never guessed: an account must already exist for the
 * phone — no auto-creation.
 */
header('Content-Type: application/json');

require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/url_signer.php';
require_once __DIR__ . '/../backend/log_activity_helper.php';

$input = json_decode(file_get_contents('php://input'), true);
$order_id = isset($input['order_id']) ? (int)$input['order_id'] : 0;
$ref = $input['ref'] ?? '';
$phone = $input['phone'] ?? '';
$sig = $input['sig'] ?? '';

if (!$order_id || $ref === '' || $phone === '' || $sig === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing required parameters.']);
    exit;
}

hof_require_signed_params(['order_id' => $order_id, 'ref' => $ref, 'purpose' => 'link'], $sig, false, true);

// Normalize PH phone: strip non-digits; 12-char '63' prefix → '0'+last10.
$digits = preg_replace('/[^0-9]/', '', (string)$phone);
if (strlen($digits) === 12 && substr($digits, 0, 2) === '63') {
    $digits = '0' . substr($digits, -10);
}
if (!preg_match('/^09\d{9}$/', $digits)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Enter a valid PH phone number (09XXXXXXXXX).']);
    exit;
}
$phone = $digits;

$stmt = $pdo->prepare("SELECT customer_account_id, status, payment_status, reference_number FROM orders WHERE order_id = ?");
$stmt->execute([$order_id]);
$order = $stmt->fetch(PDO::FETCH_ASSOC);

if (!$order) {
    http_response_code(404);
    echo json_encode(['success' => false, 'message' => 'Order not found.']);
    exit;
}

if ($order['reference_number'] !== $ref) {
    http_response_code(403);
    echo json_encode(['success' => false, 'message' => 'Reference mismatch.']);
    exit;
}

$status = strtoupper((string)$order['status']);
$paid = strtoupper((string)$order['payment_status']) === 'COMPLETED';
if (!in_array($status, ['COMPLETED', 'SERVED'], true) && !$paid) {
    http_response_code(409);
    echo json_encode(['success' => false, 'message' => 'Order is not paid/completed yet — you can link it once it is finished.']);
    exit;
}

if (!empty($order['customer_account_id'])) {
    echo json_encode(['success' => true, 'message' => 'Order already linked to an account.']);
    exit;
}

$custStmt = $pdo->prepare("SELECT customer_id, name FROM customers WHERE phone_number = ? AND is_active = 1 LIMIT 1");
$custStmt->execute([$phone]);
$customer = $custStmt->fetch(PDO::FETCH_ASSOC);

if (!$customer) {
    echo json_encode(['success' => false, 'message' => 'No account found for that phone number. Ask staff to create one, or register first.']);
    exit;
}

// Only link when the order is currently unlinked (double-checked — no overwrite).
$update = $pdo->prepare("UPDATE orders SET customer_account_id = ? WHERE order_id = ? AND customer_account_id IS NULL");
$update->execute([(int)$customer['customer_id'], $order_id]);

if ($update->rowCount() === 0) {
    echo json_encode(['success' => true, 'message' => 'Order already linked to an account.']);
    exit;
}

logActivity($pdo, null, (string)$customer['name'], 'Customer', 'CUSTOMER_LINK',
    "Guest order #{$ref} linked to customer account {$customer['name']}",
    'order', $order_id, $ref);

echo json_encode(['success' => true, 'message' => 'Order linked to your account — log in to see it in My Orders.']);
