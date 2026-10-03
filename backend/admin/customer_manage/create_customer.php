<?php
/**
 * backend/admin/customer_manage/create_customer.php
 * REQ-054 B3-C — Create a customer account (Admin + Supervisor).
 *
 * Creates an inactive-but-active (is_active=1) customer with an empty
 * password_hash placeholder. The account cannot log in until a password
 * is set (via the customer password-reset flow); the empty string satisfies
 * the NOT NULL constraint without granting access.
 */
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

$auth = authenticate(['Admin', 'Supervisor']);

$data = json_decode(file_get_contents('php://input'), true);
$name = trim($data['name'] ?? '');
$phone = trim($data['phone_number'] ?? '');

if ($name === '' || $phone === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Name and phone number are required.']);
    exit;
}

// Normalize + validate PH phone (mirror update_customer.php + register.php):
// strip non-digits; 12-char '63' prefix → '0'+last10; require 09XXXXXXXXX.
$digits = preg_replace('/[^0-9]/', '', $phone);
if (strlen($digits) === 12 && substr($digits, 0, 2) === '63') {
    $digits = '0' . substr($digits, -10);
}
if (!preg_match('/^09\d{9}$/', $digits)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Enter a valid PH phone number (09XXXXXXXXX).']);
    exit;
}
$phone = $digits;

try {
    $chk = $pdo->prepare('SELECT 1 FROM customers WHERE phone_number = ? LIMIT 1');
    $chk->execute([$phone]);
    if ($chk->fetchColumn()) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This phone number is already registered.']);
        exit;
    }

    $ins = $pdo->prepare('INSERT INTO customers (phone_number, name, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(), NOW())');
    $ins->execute([$phone, $name, '']);
    $customerId = (int)$pdo->lastInsertId();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'CUSTOMER_CREATE', "Created customer {$name} ({$phone})", 'customer', $customerId, $phone, 'ACTIVE');

    echo json_encode([
        'success' => true,
        'customer_id' => $customerId,
        'message' => 'Customer created.'
    ]);
} catch (Throwable $e) {
    error_log('create_customer error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to create customer.']);
}
