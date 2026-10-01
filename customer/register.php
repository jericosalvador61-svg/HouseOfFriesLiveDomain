<?php
/**
 * customer/register.php
 * REQ-052 Batch 3 — Customer registration (phone + password).
 *
 * - PH phone validation + normalization (09XXXXXXXXX) before UNIQUE lookup.
 * - Password strength mirrors staff validatePasswordStrength (backend/auth/change_password_first_login.php).
 * - Rate limited per-IP AND per-phone (file-based, backend/rate_limit.php).
 * - Duplicate registration is reported plainly (expected); login failures
 *   must stay generic so existence is never enumerable.
 * - No new DB columns — uses the existing `customers` table.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/rate_limit.php';
require_once __DIR__ . '/../backend/customer_auth.php';
require_once __DIR__ . '/../backend/log_activity_helper.php';

// First gate: per-IP throttle.
hof_rate_limit('customer_register', 20, 3600);

$data = json_decode(file_get_contents('php://input'), true);
$phone = isset($data['phone']) ? trim((string)$data['phone']) : '';
$name  = isset($data['name']) ? trim((string)$data['name']) : '';
$password = (string)($data['password'] ?? '');
$confirm  = (string)($data['confirm_password'] ?? '');

if ($phone === '' || $name === '' || $password === '' || $confirm === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Phone number, name and password are required.']);
    exit;
}

// ── PH phone normalization ──
$normalized = preg_replace('/[^0-9]/', '', $phone);
if (strlen($normalized) === 12 && substr($normalized, 0, 2) === '63') {
    $normalized = '0' . substr($normalized, 2);
}
if (!preg_match('/^09\d{9}$/', $normalized)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Please enter a valid Philippine mobile number (e.g. 09171234567).']);
    exit;
}
$phone = $normalized;

// ── Name ──
if (mb_strlen($name) < 2 || mb_strlen($name) > 100) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Name must be between 2 and 100 characters.']);
    exit;
}

// ── Password strength (staff mirror: min 6 + upper + number + special) ──
if ($password !== $confirm) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Passwords do not match.']);
    exit;
}
$errors = [];
if (strlen($password) < 6) $errors[] = 'at least 6 characters';
if (!preg_match('/[A-Z]/', $password)) $errors[] = 'one uppercase letter';
if (!preg_match('/[0-9]/', $password)) $errors[] = 'one number';
if (!preg_match('/[^A-Za-z0-9]/', $password)) $errors[] = 'one special character';
if (!empty($errors)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Password must contain: ' . implode(', ', $errors)]);
    exit;
}

// Second gate: per-phone throttle (after cheap local validation).
hof_rate_limit('customer_register', 5, 3600, true, $phone);

try {
    // Duplicate check (prepared, UNIQUE key is the backstop)
    $dupStmt = $pdo->prepare('SELECT customer_id FROM customers WHERE phone_number = ? LIMIT 1');
    $dupStmt->execute([$phone]);
    if ($dupStmt->fetch(PDO::FETCH_ASSOC)) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This phone number is already registered.']);
        exit;
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    $insStmt = $pdo->prepare('INSERT INTO customers (phone_number, name, password_hash, is_active, created_at, updated_at) VALUES (?, ?, ?, 1, NOW(), NOW())');
    $insStmt->execute([$phone, $name, $passwordHash]);
    $customerId = (int)$pdo->lastInsertId();

    $customer = [
        'customer_id'  => $customerId,
        'phone_number' => $phone,
        'name'         => $name,
    ];
    $token = issueCustomerToken($customer);

    logActivity($pdo, null, $phone, 'Customer', 'CUSTOMER_REGISTER',
        "Customer registered: {$name} ({$phone})",
        'customer', $customerId, $phone, 'COMPLETED');

    echo json_encode([
        'success' => true,
        'message' => 'Account created successfully.',
        'token'   => $token,
        'name'    => $name,
        'phone'   => $phone,
    ]);
} catch (PDOException $e) {
    // 23000 = duplicate phone (race between check and insert) — same generic message.
    if ($e->getCode() == 23000) {
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This phone number is already registered.']);
        exit;
    }
    error_log('customer register error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Registration failed. Please try again later.']);
}