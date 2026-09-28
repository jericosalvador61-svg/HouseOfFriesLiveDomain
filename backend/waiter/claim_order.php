<?php
/**
 * HOF Waiter API - Claim Order (Assist)
 * Race-safe: only claims if user_id IS NULL (first-come-first-served).
 * POST { order_id }
 * Returns: claimed = true/false, message
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';

$auth = authenticate(['Waiter', 'Admin', 'Supervisor']);
$waiterId = (int)$auth['user_id'];

$data = json_decode(file_get_contents('php://input'), true);
$orderId = (int)($data['order_id'] ?? 0);

if (!$orderId) {
    echo json_encode(['success' => false, 'message' => 'Missing order_id.']);
    exit;
}

try {
    $stmt = $pdo->prepare("UPDATE orders SET user_id = ?, updated_at = NOW() WHERE order_id = ? AND user_id IS NULL");
    $stmt->execute([$waiterId, $orderId]);

    if ($stmt->rowCount() > 0) {
        $refStmt = $pdo->prepare("SELECT reference_number FROM orders WHERE order_id = ?");
        $refStmt->execute([$orderId]);
        $ref = $refStmt->fetchColumn();
        logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'ORDER_CLAIM', "Waiter claimed order #{$ref}", 'order', $orderId, $ref);
        echo json_encode(['success' => true, 'claimed' => true, 'message' => 'Order assigned to you.']);
    } else {
        echo json_encode(['success' => true, 'claimed' => false, 'message' => 'This order was already taken.']);
    }
} catch (Exception $e) {
    error_log('claim_order error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Failed to claim order.']);
}