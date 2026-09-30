<?php
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Cashier', 'Admin', 'Waiter']);
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

if (!isset($_GET['order_id'])) {
    echo json_encode(['success' => false, 'error' => 'No order ID provided']);
    exit;
}

$order_id = $_GET['order_id'];

try {
    // 1. Fetch Order Info (Tweak: Included customer_name in the column selection)
    $orderQuery = "SELECT order_id, reference_number, total_amount, subtotal_amount, discount_amount, discount_type_id, order_type, customer_name FROM orders WHERE order_id = :order_id";
    $stmt = $pdo->prepare($orderQuery);
    $stmt->execute(['order_id' => $order_id]);
    $orderInfo = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$orderInfo) {
        echo json_encode(['success' => false, 'error' => 'Order not found']);
        exit;
    }

    // 2. Fetch Items (Added order_item_id and is_deleted check)
    $itemsQuery = "SELECT 
                    oi.order_item_id, 
                    mi.item_name, 
                    oi.quantity, 
                    oi.price,
                    oi.special_instructions 
                   FROM order_items oi
                   JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
                   WHERE oi.order_id = :order_id 
                   AND oi.is_deleted = 0"; // <-- This hides soft-deleted items (is_deleted = 1)

    $stmt = $pdo->prepare($itemsQuery);
    $stmt->execute(['order_id' => $order_id]);
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'order_info' => $orderInfo,
        'items' => $items
    ]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
