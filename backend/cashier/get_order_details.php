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

    // REQ-068 M4-2: guard a poisoned/stale subtotal. Some live-DB rows carry
    // subtotal_amount = 99999999 (the writers recompute from SUM(order_items.subtotal),
    // so the bad value is never written by code). If the stored subtotal is
    // > 1000000 or NULL, recompute it from the non-deleted items and use that
    // for the RESPONSE only — never mutate the DB. total_amount stays as-is.
    $subtotal = isset($orderInfo['subtotal_amount']) ? (float)$orderInfo['subtotal_amount'] : 0.0;
    if ($subtotal > 1000000 || $subtotal <= 0) {
        $subStmt = $pdo->prepare("SELECT COALESCE(SUM(quantity * price), 0) FROM order_items WHERE order_id = ? AND is_deleted = 0");
        $subStmt->execute([$order_id]);
        $subtotal = (float)$subStmt->fetchColumn();
    }
    $orderInfo['subtotal_amount'] = $subtotal;

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
