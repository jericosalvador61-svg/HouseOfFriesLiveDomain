<?php
/**
 * backend/admin/customer_reset/generate_reset_code.php
 * REQ-052 Batch 3 — Staff-generated customer password-reset code.
 *
 * Admin/Supervisor POST {phone} → generates a 15-min single-use reset code,
 * stores it in the file-based store (sys_get_temp_dir()/hof_customer_resets),
 * logs it to Activity Logs (role Customer), and returns the code to the staff
 * ONLY (it is the customer who must never see it in a response).
 *
 * A locked (is_active=0) customer can also be reset here — the reset endpoint
 * re-activates on successful code use.
 */
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../manageUsers/temp_code_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

$auth = authenticate(['Admin', 'Supervisor']);

$data = json_decode(file_get_contents('php://input'), true);
$phone = isset($data['phone']) ? trim((string)$data['phone']) : '';
if ($phone === '') {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Phone number is required.']);
    exit;
}

$normalized = preg_replace('/[^0-9]/', '', $phone);
if (strlen($normalized) === 12 && substr($normalized, 0, 2) === '63') {
    $normalized = '0' . substr($normalized, 2);
}
$phone = (strlen($normalized) === 11) ? $normalized : $phone;

// Enforce PH mobile format (mirror register/login/reset).
if (!preg_match('/^09\d{9}$/', $phone)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Please enter a valid Philippine mobile number (e.g. 09171234567).']);
    exit;
}

try {
    $chk = $pdo->prepare('SELECT customer_id, phone_number, name FROM customers WHERE phone_number = ? LIMIT 1');
    $chk->execute([$phone]);
    $customer = $chk->fetch(PDO::FETCH_ASSOC);

    // If the customer does not exist, still return success with a generic
    // message so the staff phone-number input cannot be probed via error text.
    if (!$customer) {
        echo json_encode([
            'success' => true,
            'message' => 'If that phone number is registered, a reset code has been generated (valid 15 min).',
            'code'    => null,
            'expires_in' => 900,
        ]);
        exit;
    }

    $code = hof_generate_temp_code(8);

    $storeDir = sys_get_temp_dir() . '/hof_customer_resets';
    if (!is_dir($storeDir)) {
        @mkdir($storeDir, 0700, true);
    }
    $storeFile = $storeDir . '/' . hash('sha256', $phone) . '.json';
    @file_put_contents($storeFile, json_encode([
        'code'       => $code,
        'phone'      => $phone,
        'expires_at' => time() + (15 * 60),
    ]), LOCK_EX);
    @chmod($storeFile, 0600);

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'CUSTOMER_RESET_CODE',
        "Generated customer reset code for {$customer['name']} ({$phone})",
        'customer', (int)$customer['customer_id'], $phone, 'PENDING');

    echo json_encode([
        'success' => true,
        'message' => 'Reset code generated (valid 15 min).',
        'code'    => $code,
        'expires_in' => 900,
    ]);
} catch (Throwable $e) {
    error_log('generate_reset_code error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to generate reset code.']);
}