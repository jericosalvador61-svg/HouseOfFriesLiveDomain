<?php
/**
 * HOF Waiter API - Get Today's Orders
 * Returns orders for the current day only, grouped by status.
 * Supports scope=mine (default): returns waiter's assigned orders + all unclaimed.
 * Returns epoch timestamps for accurate client-side display.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
header('Content-Type: application/json');

$auth = authenticate(['Waiter', 'Admin', 'Supervisor']);
$waiterId = (int)$auth['user_id'];

try {
    $scope = trim($_GET['scope'] ?? 'mine');

    // Get today's date range
    $today = date('Y-m-d');
    $tomorrow = date('Y-m-d', strtotime('+1 day'));

    // Main orders: scoped to waiter's assigned orders (exclude unclaimed)
    $whereExtra = '';
    $params = ['today_start' => $today . ' 00:00:00', 'tomorrow_start' => $tomorrow . ' 00:00:00'];
    if ($scope === 'mine') {
        $whereExtra = 'AND o.user_id = :waiter_id';
        $params[':waiter_id'] = $waiterId;
    }

    $stmt = $pdo->prepare("
        SELECT 
            o.order_id,
            o.reference_number,
            o.order_type,
            o.table_id,
            o.status,
            o.total_amount,
            o.ordered_at,
            UNIX_TIMESTAMP(o.ordered_at) AS ordered_at_epoch,
            o.completed_at,
            UNIX_TIMESTAMP(o.completed_at) AS completed_at_epoch,
            o.customer_name,
            o.user_id,
            rt.table_number,
            CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM orders o
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        LEFT JOIN users u ON o.user_id = u.user_id
        WHERE o.ordered_at >= :today_start
          AND o.ordered_at < :tomorrow_start
          AND o.status NOT IN ('CANCELLED')
          AND o.user_id IS NOT NULL
          $whereExtra
        ORDER BY o.ordered_at DESC
    ");
    $stmt->execute($params);
    $orders = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Unclaimed orders (user_id IS NULL) — always returned separately
    $unclaimStmt = $pdo->prepare("
        SELECT 
            o.order_id,
            o.reference_number,
            o.order_type,
            o.table_id,
            o.status,
            o.total_amount,
            o.ordered_at,
            UNIX_TIMESTAMP(o.ordered_at) AS ordered_at_epoch,
            o.completed_at,
            UNIX_TIMESTAMP(o.completed_at) AS completed_at_epoch,
            o.customer_name,
            o.user_id,
            rt.table_number,
            CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
        FROM orders o
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        LEFT JOIN users u ON o.user_id = u.user_id
        WHERE o.ordered_at >= :today_start
          AND o.ordered_at < :tomorrow_start
          AND o.status NOT IN ('CANCELLED')
          AND o.user_id IS NULL
        ORDER BY o.ordered_at DESC
    ");
    $unclaimStmt->execute(['today_start' => $today . ' 00:00:00', 'tomorrow_start' => $tomorrow . ' 00:00:00']);
    $unclaimedOrders = $unclaimStmt->fetchAll(PDO::FETCH_ASSOC);

    $allOrders = array_merge($orders, $unclaimedOrders);

    // Get items for all orders
    if (!empty($allOrders)) {
        $orderIds = array_column($allOrders, 'order_id');
        $placeholders = implode(',', array_fill(0, count($orderIds), '?'));

        $itemStmt = $pdo->prepare("
            SELECT 
                oi.order_id,
                oi.quantity,
                mi.item_name,
                mi.price
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
            WHERE oi.order_id IN ($placeholders)
              AND oi.is_deleted = 0
        ");
        $itemStmt->execute($orderIds);
        $items = $itemStmt->fetchAll(PDO::FETCH_ASSOC);

        $itemsByOrder = [];
        foreach ($items as $item) {
            $itemsByOrder[$item['order_id']][] = $item;
        }

        foreach ($allOrders as &$order) {
            $order['items'] = $itemsByOrder[$order['order_id']] ?? [];
        }
        unset($order);
    }

    echo json_encode([
        'success' => true,
        'orders' => $orders,
        'unclaimed_orders' => $unclaimedOrders
    ]);
} catch (Exception $e) {
    error_log('get_orders_today error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Failed to load orders.']);
}