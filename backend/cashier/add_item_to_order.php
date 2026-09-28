<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';

$auth = authenticate(['Cashier', 'Admin']);

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['order_id'], $data['menu_item_id'], $data['price'])) {
    echo json_encode(['success' => false, 'message' => 'Missing required data.']);
    exit;
}

$orderId = $data['order_id'];
$menuItemId = $data['menu_item_id'];
$price = $data['price'];

try {
    $pdo->beginTransaction();

    $availStmt = $pdo->prepare("SELECT status, item_name FROM menu_items WHERE menu_item_id = ?");
    $availStmt->execute([$menuItemId]);
    $availRow = $availStmt->fetch();
    if (!$availRow || $availRow['status'] !== 'Available') {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'message' => 'This item is no longer available and cannot be added to the order.']);
        exit;
    }

    $itemName = $availRow['item_name'];

    $checkStmt = $pdo->prepare("SELECT order_item_id, quantity FROM order_items WHERE order_id = ? AND menu_item_id = ? AND is_deleted = 0");
    $checkStmt->execute([$orderId, $menuItemId]);
    $existingItem = $checkStmt->fetch();

    if ($existingItem) {
            $newQty = $existingItem['quantity'] + 1;
            $updateStmt = $pdo->prepare("UPDATE order_items SET quantity = ? WHERE order_item_id = ?");
            $updateStmt->execute([$newQty, $existingItem['order_item_id']]);
        } else {
            $insertStmt = $pdo->prepare("INSERT INTO order_items (order_id, menu_item_id, quantity, price) VALUES (?, ?, 1, ?)");
            $insertStmt->execute([$orderId, $menuItemId, $price]);
        }

    $updateOrder = $pdo->prepare("
        UPDATE orders 
        SET total_amount = (SELECT SUM(subtotal) FROM order_items WHERE order_id = ? AND is_deleted = 0),
            updated_at = NOW()
        WHERE order_id = ?
    ");
    $updateOrder->execute([$orderId, $orderId]);

    $pdo->commit();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'ADD_ITEM_TO_ORDER', "Added {$itemName} x1 to order",
        'order', $orderId);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('add_item_to_order error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}
