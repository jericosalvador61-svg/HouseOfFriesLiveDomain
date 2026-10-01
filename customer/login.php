<?php
/**
 * customer/login.php
 * REQ-052 Batch 3 — Customer login (phone + password).
 *
 * - Rate limited per-IP AND per-phone BEFORE any credential check.
 * - Generic failure message whether or not the phone exists (no enumeration).
 * - Lockout: after 5 consecutive failed logins the account is set
 *   is_active=0 (locked). Re-activation is a STAFF action (admin/supervisor
 *   toggles it back on, or the staff reset-code flow). No auto-unlock.
 *   The file-based limiter (per phone) provides the throttling backstop.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/rate_limit.php';
require_once __DIR__ . '/../backend/customer_auth.php';
require_once __DIR__ . '/../backend/log_activity_helper.php';

// First gate: per-IP throttle.
hof_rate_limit('customer_login', 30, 300);

$data = json_decode(file_get_contents('php://input'), true);
$phone = isset($data['phone']) ? trim((string)$data['phone']) : '';
$password = (string)($data['password'] ?? '');

if ($phone === '' || $password === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Phone number and password are required.']);
    exit;
}

// Normalize to 09XXXXXXXXX before lookup (same rule as register).
$normalized = preg_replace('/[^0-9]/', '', $phone);
if (strlen($normalized) === 12 && substr($normalized, 0, 2) === '63') {
    $normalized = '0' . substr($normalized, 2);
}
$phone = (strlen($normalized) === 11) ? $normalized : $phone;

$genericMessage = 'Invalid phone number or password.';

// Enforce PH mobile format on login too (mirror register) so non-09
// 11-digit strings can never be probed/looked up.
if (!preg_match('/^09\d{9}$/', $phone)) {
    echo json_encode(['success' => false, 'message' => $genericMessage]);
    exit;
}

// Second gate: per-phone throttle BEFORE credential check.
hof_rate_limit('customer_login', 10, 300, true, $phone);

// ── File-based consecutive-failure counter (no DB columns — schema locked).
// After LOCKOUT_MAX consecutive failed logins for a phone, the account is
// locked via is_active=0. Staff reactivate it (manage_customers toggle) or a
// staff-generated reset re-activates it. The counter is cleared on success.
const MAX_LOGIN_FAILURES = 5;

function hof_customer_failure_file($phone)
{
    $dir = sys_get_temp_dir() . '/hof_customer_failures';
    if (!is_dir($dir)) @mkdir($dir, 0777, true);
    return $dir . '/' . hash('sha256', $phone) . '.json';
}

function hof_customer_read_failures($phone)
{
    $f = hof_customer_failure_file($phone);
    if (!is_file($f)) return 0;
    $data = json_decode((string)@file_get_contents($f), true);
    return is_array($data) ? (int)($data['count'] ?? 0) : 0;
}

function hof_customer_record_failure($phone)
{
    $f = hof_customer_failure_file($phone);
    $count = hof_customer_read_failures($phone) + 1;
    @file_put_contents($f, json_encode(['count' => $count, 'last_at' => time()]), LOCK_EX);
    return $count;
}

function hof_customer_reset_failures($phone)
{
    $f = hof_customer_failure_file($phone);
    if (is_file($f)) @unlink($f);
}

try {
    $stmt = $pdo->prepare('SELECT customer_id, phone_number, name, password_hash, is_active FROM customers WHERE phone_number = ? LIMIT 1');
    $stmt->execute([$phone]);
    $customer = $stmt->fetch(PDO::FETCH_ASSOC);

    // Identical generic response when the account does not exist — never
    // reveal whether a phone is registered.
    if (!$customer || !password_verify($password, $customer['password_hash'])) {
        $failCount = hof_customer_record_failure($phone);
        // Escalating lockout: after 5 consecutive failures, set is_active=0.
        if ($customer && $failCount >= MAX_LOGIN_FAILURES) {
            $lockStmt = $pdo->prepare('UPDATE customers SET is_active = 0, updated_at = NOW() WHERE customer_id = ?');
            $lockStmt->execute([(int)$customer['customer_id']]);
            logActivity($pdo, null, $phone, 'Customer', 'LOCKOUT',
                "Customer {$phone} locked after {$failCount} consecutive failed logins",
                'customer', (int)$customer['customer_id'], $phone, 'LOCKED');
        } else {
            logActivity($pdo, null, $phone, 'Customer', 'LOGIN_FAILED',
                "Failed customer login attempt for {$phone}",
                'customer', null, $phone, 'FAILED');
        }
        echo json_encode(['success' => false, 'message' => $genericMessage]);
        exit;
    }

    // Locked accounts (is_active=0) cannot log in; staff must re-activate.
    if ((int)$customer['is_active'] !== 1) {
        logActivity($pdo, null, $phone, 'Customer', 'LOGIN_FAILED',
            "Login denied for locked customer {$phone}",
            'customer', (int)$customer['customer_id'], $phone, 'LOCKED');
        echo json_encode([
            'success' => false,
            'message' => 'This account has been locked. Please ask restaurant staff to reactivate it.',
            'locked'  => true,
        ]);
        exit;
    }

    // Success: clear the failure counter + refresh last_login_at.
    hof_customer_reset_failures($phone);
    $updStmt = $pdo->prepare('UPDATE customers SET last_login_at = NOW(), updated_at = NOW() WHERE customer_id = ?');
    $updStmt->execute([(int)$customer['customer_id']]);

    $token = issueCustomerToken($customer);

    logActivity($pdo, null, $phone, 'Customer', 'LOGIN_SUCCESS',
        "Customer logged in: {$customer['name']} ({$phone})",
        'customer', (int)$customer['customer_id'], $phone, 'COMPLETED');

    echo json_encode([
        'success' => true,
        'message' => 'Login successful.',
        'token'   => $token,
        'name'    => $customer['name'],
        'phone'   => $customer['phone_number'],
    ]);
} catch (PDOException $e) {
    error_log('customer login error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Login failed. Please try again later.']);
}