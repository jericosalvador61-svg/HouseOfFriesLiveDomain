<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';

$auth = authenticate(['Cashier', 'Admin']);

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['order_id'], $data['order_item_id'], $data['action'])) {
    echo json_encode(['success' => false, 'message' => 'Invalid request data.']);
    exit;
}

$orderId = $data['order_id'];
$orderItemId = $data['order_item_id'];
$action = $data['action'];

try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare("SELECT quantity, price FROM order_items WHERE order_item_id = ? AND is_deleted = 0");
    $stmt->execute([$orderItemId]);
    $item = $stmt->fetch();

    if (!$item) {
        throw new Exception("Item not found or already deleted.");
    }

    $oldQty = (int)$item['quantity'];
    $newQty = $oldQty;
    $unitPrice = $item['price'];

    if ($action === 'add') {
        $newQty++;
    } elseif ($action === 'sub') {
        if ($newQty > 1) {
            $newQty--;
        } else {
            throw new Exception("Minimum quantity reached.");
        }
    }

    $updateItem = $pdo->prepare("UPDATE order_items SET quantity = ?, updated_at = NOW() WHERE order_item_id = ?");
    $updateItem->execute([$newQty, $orderItemId]);

    $updateOrder = $pdo->prepare("
        UPDATE orders 
        SET total_amount = (SELECT SUM(subtotal) FROM order_items WHERE order_id = ? AND is_deleted = 0),
            updated_at = NOW()
        WHERE order_id = ?
    ");
    $updateOrder->execute([$orderId, $orderId]);

    $pdo->commit();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'UPDATE_ITEM_QTY', "Item #{$orderItemId}: {$oldQty} → {$newQty}",
        'order', $orderId);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('update_item_quantity error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}
