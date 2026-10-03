<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../pusher_helper.php'; // REQ-054 B4-C

$auth = authenticate(['Cashier', 'Admin']);

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['order_id'], $data['order_item_id'])) {
    echo json_encode(['success' => false, 'message' => 'Invalid data.']);
    exit;
}

$orderId = $data['order_id'];
$orderItemId = $data['order_item_id'];

try {
    $pdo->beginTransaction();

    // 1. Mark item as deleted
    $stmt = $pdo->prepare("UPDATE order_items SET is_deleted = 1, updated_at = NOW() WHERE order_item_id = ?");
    $stmt->execute([$orderItemId]);

    // 2. Recalculate Order Total
    $updateOrder = $pdo->prepare("
        UPDATE orders 
        SET subtotal_amount = (SELECT COALESCE(SUM(subtotal), 0) FROM order_items WHERE order_id = ? AND is_deleted = 0),
            total_amount = (SELECT COALESCE(SUM(subtotal), 0) FROM order_items WHERE order_id = ? AND is_deleted = 0) - COALESCE(discount_amount, 0),
            updated_at = NOW()
        WHERE order_id = ?
    ");
    $updateOrder->execute([$orderId, $orderId, $orderId]);

    $pdo->commit();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'VOID_ITEM', "Voided item #{$orderItemId} from order",
        'order', $orderId, (string)$orderId, 'VOIDED');

    // REQ-054 B4-C: tell the customer tracker the order changed so it re-fetches.
    if (function_exists('broadcastOrderUpdate')) {
        broadcastOrderUpdate($orderId, "Item voided from order", null);
    }

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('void_item error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}
