<?php
/**
 * customer/reset_password.php
 * REQ-052 Batch 3 — Customer self-service password reset.
 *
 * Flow (staff-administered, mirroring the staff temp-code pattern):
 *   1. Staff (admin/supervisor) generates a 15-min single-use reset code via
 *      backend/admin/customer_reset/generate_reset_code.php — the code is
 *      stored in a FILE-based store under sys_get_temp_dir()/hof_customer_resets
 *      (NO new DB columns; the schema is locked).
 *   2. The customer enters phone + code + new password on customer/reset_password.html.
 *   3. This endpoint validates the code, hashes the new password, clears the
 *      store file (single use), and re-activates the account (is_active=1).
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/rate_limit.php';
require_once __DIR__ . '/../backend/log_activity_helper.php';

// First gate: per-IP throttle.
hof_rate_limit('customer_reset_password', 20, 3600);

$data = json_decode(file_get_contents('php://input'), true);
$phone = isset($data['phone']) ? trim((string)$data['phone']) : '';
$tempCode = isset($data['temp_code']) ? trim((string)$data['temp_code']) : '';
$newPassword = (string)($data['new_password'] ?? '');
$confirm = (string)($data['confirm_password'] ?? '');

if ($phone === '' || $tempCode === '' || $newPassword === '' || $confirm === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Phone number, reset code, and new password are required.']);
    exit;
}

// Normalize phone (same rule as register/login).
$normalized = preg_replace('/[^0-9]/', '', $phone);
if (strlen($normalized) === 12 && substr($normalized, 0, 2) === '63') {
    $normalized = '0' . substr($normalized, 2);
}
$phone = (strlen($normalized) === 11) ? $normalized : $phone;

// Enforce PH mobile format on reset too (mirror register/login).
if (!preg_match('/^09\d{9}$/', $phone)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Please enter a valid Philippine mobile number (e.g. 09171234567).']);
    exit;
}

if ($newPassword !== $confirm) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Passwords do not match.']);
    exit;
}

// Password strength (staff mirror).
$errors = [];
if (strlen($newPassword) < 6) $errors[] = 'at least 6 characters';
if (!preg_match('/[A-Z]/', $newPassword)) $errors[] = 'one uppercase letter';
if (!preg_match('/[0-9]/', $newPassword)) $errors[] = 'one number';
if (!preg_match('/[^A-Za-z0-9]/', $newPassword)) $errors[] = 'one special character';
if (!empty($errors)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Password must contain: ' . implode(', ', $errors)]);
    exit;
}

// Second gate: per-phone throttle (after cheap local validation).
hof_rate_limit('customer_reset_password', 5, 900, true, $phone);

// File-based temp-code store: sys_get_temp_dir()/hof_customer_resets/<sha256(phone)>.json
$storeDir = sys_get_temp_dir() . '/hof_customer_resets';
$storeFile = $storeDir . '/' . hash('sha256', $phone) . '.json';

try {
    if (!is_file($storeFile)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid or expired reset code. Please ask staff to generate a new one.']);
        exit;
    }

    $record = json_decode((string)file_get_contents($storeFile), true);
    if (!is_array($record)) {
        @unlink($storeFile);
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid or expired reset code. Please ask staff to generate a new one.']);
        exit;
    }

    // Single-use + expiry (15 minutes).
    if ((int)($record['expires_at'] ?? 0) < time()) {
        @unlink($storeFile);
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'This reset code has expired. Please ask staff to generate a new one.']);
        exit;
    }

    if (!hash_equals((string)$record['code'], $tempCode)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid or expired reset code. Please ask staff to generate a new one.']);
        exit;
    }

    // Consume the code (single use) BEFORE touching the DB so a second
    // submission can never replay it.
    @unlink($storeFile);

    // The code was issued against this phone (and possibly a specific customer
    // row). Resolve the customer row by phone.
    $stmt = $pdo->prepare('SELECT customer_id, phone_number, name, is_active FROM customers WHERE phone_number = ? LIMIT 1');
    $stmt->execute([$phone]);
    $customer = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$customer) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'No account is registered with this phone number.']);
        exit;
    }

    $passwordHash = password_hash($newPassword, PASSWORD_DEFAULT);
    $updStmt = $pdo->prepare('UPDATE customers SET password_hash = ?, is_active = 1, updated_at = NOW() WHERE customer_id = ?');
    $updStmt->execute([$passwordHash, (int)$customer['customer_id']]);

    // Clear any file-based consecutive-failure lock counter (same store as login.php).
    $failFile = sys_get_temp_dir() . '/hof_customer_failures/' . hash('sha256', $phone) . '.json';
    if (is_file($failFile)) @unlink($failFile);

    logActivity($pdo, null, $phone, 'Customer', 'CUSTOMER_RESET_PASSWORD',
        "Customer reset password: {$customer['name']} ({$phone})",
        'customer', (int)$customer['customer_id'], $phone, 'COMPLETED');

    echo json_encode([
        'success' => true,
        'message' => 'Password reset successfully. You can now log in with your new password.',
    ]);
} catch (PDOException $e) {
    error_log('customer reset_password error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Reset failed. Please try again later.']);
}