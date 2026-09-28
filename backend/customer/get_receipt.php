<?php
require_once __DIR__ . '/../auth_middleware.php';
$auth = authenticate(['Customer', 'Admin', 'Cashier']);
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

$orderId = (int)($_GET['order_id'] ?? 0);
if (!$orderId) {
    echo json_encode(['success' => false, 'message' => 'Invalid order']);
    exit;
}

try {
    $stmt = $pdo->prepare("
        SELECT o.*, 
               u.username AS cashier_name,
               rt.table_number
        FROM orders o
        LEFT JOIN users u ON o.processed_by = u.user_id
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        WHERE o.order_id = ?
    ");
    $stmt->execute([$orderId]);
    $order = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$order) {
        echo json_encode(['success' => false, 'message' => 'Order not found']);
        exit;
    }

    $itemsStmt = $pdo->prepare("
        SELECT oi.*, mi.item_name, mi.price
        FROM order_items oi
        JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
        WHERE oi.order_id = ? AND oi.is_deleted = 0
    ");
    $itemsStmt->execute([$orderId]);
    $items = $itemsStmt->fetchAll(PDO::FETCH_ASSOC);

    $payStmt = $pdo->prepare("SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC LIMIT 1");
    $payStmt->execute([$orderId]);
    $payment = $payStmt->fetch(PDO::FETCH_ASSOC);

    echo json_encode([
        'success' => true,
        'restaurant_name' => 'House of Fries',
        'address' => 'Tagoloan Branch',
        'reference_number' => $order['reference_number'],
        'created_at' => $order['created_at'],
        'customer_name' => $order['customer_name'],
        'table_number' => $order['table_number'],
        'cashier' => $order['cashier_name'],
        'payment_method' => $payment['payment_method'] ?? ($order['payment_status'] === 'COMPLETED' ? 'CASH' : 'GCASH'),
        'total_amount' => $order['total_amount'],
        'amount_paid' => $payment['amount_paid'] ?? $order['total_amount'],
        'change_amount' => $payment['change'] ?? 0,
        'items' => $items
    ]);
} catch (Exception $e) {
    error_log('get_receipt.php error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Could not load receipt']);
}