<?php
/**
 * backend/admin/customer_manage/toggle_customer.php
 * REQ-052 Batch 3 — Toggle a customer's is_active (Admin + Supervisor).
 *
 * Locked (is_active=0) customers are re-activated here; active customers can
 * be deactivated. Required to recover accounts locked by repeated failures.
 */
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

$auth = authenticate(['Admin', 'Supervisor']);

$data = json_decode(file_get_contents('php://input'), true);
$customerId = isset($data['customer_id']) ? (int)$data['customer_id'] : 0;
if ($customerId < 1) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Customer id is required.']);
    exit;
}

try {
    $chk = $pdo->prepare('SELECT customer_id, phone_number, name, is_active FROM customers WHERE customer_id = ? LIMIT 1');
    $chk->execute([$customerId]);
    $customer = $chk->fetch(PDO::FETCH_ASSOC);
    if (!$customer) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Customer not found.']);
        exit;
    }

    $newState = (int)$customer['is_active'] === 1 ? 0 : 1;
    $upd = $pdo->prepare('UPDATE customers SET is_active = ?, updated_at = NOW() WHERE customer_id = ?');
    $upd->execute([$newState, $customerId]);

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'CUSTOMER_ACTIVITY_TOGGLE',
        ($newState === 1 ? 'Reactivated' : 'Deactivated') . " customer {$customer['name']} ({$customer['phone_number']})",
        'customer', $customerId, $customer['phone_number'], $newState === 1 ? 'ACTIVE' : 'INACTIVE');

    echo json_encode([
        'success' => true,
        'is_active' => $newState,
        'message' => $newState === 1 ? 'Customer reactivated.' : 'Customer deactivated.',
    ]);
} catch (Throwable $e) {
    error_log('toggle_customer error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to update customer.']);
}