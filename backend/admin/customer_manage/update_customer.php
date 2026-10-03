<?php
/**
 * backend/admin/customer_manage/update_customer.php
 * REQ-060 #4 — Edit an existing customer's name / phone (Admin + Supervisor).
 *
 * Mirrors create_customer.php: normalizes the phone (09XXXXXXXXX), enforces
 * uniqueness excluding the customer being edited, captures before/after values
 * for the activity log, and NEVER touches payment fields.
 */
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

$auth = authenticate(['Admin', 'Supervisor']);

$data = json_decode(file_get_contents('php://input'), true);
$customerId = (int)($data['customer_id'] ?? 0);
$name = trim($data['name'] ?? '');
$phone = trim($data['phone_number'] ?? '');

if (!$customerId || $name === '' || $phone === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'customer_id, name and phone_number are required.']);
    exit;
}

$normalized = preg_replace('/[^0-9]/', '', $phone);
if (strlen($normalized) === 12 && substr($normalized, 0, 2) === '63') {
    $normalized = '0' . substr($normalized, 2);
}
$phone = (strlen($normalized) === 11) ? $normalized : $phone;

if (!preg_match('/^09\d{9}$/', $phone)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Please enter a valid Philippine mobile number (e.g. 09171234567).']);
    exit;
}

try {
    $get = $pdo->prepare('SELECT customer_id, phone_number, name FROM customers WHERE customer_id = ? LIMIT 1');
    $get->execute([$customerId]);
    $existing = $get->fetch(PDO::FETCH_ASSOC);

    if (!$existing) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Customer not found.']);
        exit;
    }

    $chk = $pdo->prepare('SELECT 1 FROM customers WHERE phone_number = ? AND customer_id <> ? LIMIT 1');
    $chk->execute([$phone, $customerId]);
    if ($chk->fetchColumn()) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This phone number is already registered to another customer.']);
        exit;
    }

    $upd = $pdo->prepare('UPDATE customers SET name = ?, phone_number = ?, updated_at = NOW() WHERE customer_id = ?');
    $upd->execute([$name, $phone, $customerId]);

    logActivity(
        $pdo,
        $auth['user_id'],
        $auth['username'],
        $auth['role'],
        'CUSTOMER_UPDATE',
        "Updated customer {$name} ({$phone})",
        'customer',
        $customerId,
        $phone,
        'ACTIVE',
        $existing['name'] . ' / ' . $existing['phone_number'],
        $name . ' / ' . $phone
    );

    echo json_encode([
        'success' => true,
        'customer_id' => $customerId,
        'message' => 'Customer updated.'
    ]);
} catch (Throwable $e) {
    error_log('update_customer error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to update customer.']);
}
