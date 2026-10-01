<?php
/**
 * customer/logout.php
 * REQ-052 Batch 3 — Stateless JWT logout.
 *
 * The customer token is a stateless JWT (24h exp) with no server-side
 * revocation list, so logout is purely client-side: the client drops
 * localStorage hof_customer_token + the cookie. We log best-effort.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/customer_auth.php';
require_once __DIR__ . '/../backend/log_activity_helper.php';

$payload = null;
try {
    $token = getCustomerTokenFromRequest();
    $payload = $token !== '' ? hof_decode_customer_token($token) : null;
} catch (Throwable $e) {
    $payload = null;
}

if (is_array($payload) && !empty($payload['phone_number'])) {
    logActivity($pdo, null, $payload['phone_number'], 'Customer', 'CUSTOMER_LOGOUT',
        "Customer logged out: {$payload['phone_number']}",
        'customer', (int)$payload['customer_id'], $payload['phone_number'], 'COMPLETED');
}

echo json_encode([
    'success' => true,
    'message' => 'Logged out. Please clear your session data.',
    'clear'   => ['hof_customer_token'],
]);