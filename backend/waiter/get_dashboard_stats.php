<?php
/**
 * HOF Waiter API - Dashboard Statistics
 * Returns: table counts, active orders, served today, recent orders and tables
 */
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Waiter', 'Admin', 'Supervisor']);
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

try {
    // Available tables
    $availStmt = $pdo->query("
        SELECT COUNT(*) as count 
        FROM restaurant_table 
        WHERE status = 'AVAILABLE' AND is_deleted = 0
    ");
    $available = $availStmt->fetch()['count'] ?? 0;

    // Occupied tables
    $occStmt = $pdo->query("
        SELECT COUNT(*) as count 
        FROM restaurant_table 
        WHERE status = 'OCCUPIED' AND is_deleted = 0
    ");
    $occupied = $occStmt->fetch()['count'] ?? 0;

    // Maintenance tables
    $resStmt = $pdo->query("
        SELECT COUNT(*) as count 
        FROM restaurant_table 
        WHERE status = 'MAINTENANCE' AND is_deleted = 0
    ");
    $maintenance = $resStmt->fetch()['count'] ?? 0;

    // Active orders (pending, in-progress, cooking, completed-ready-to-deliver)
    $activeStmt = $pdo->query("
        SELECT COUNT(*) as count 
        FROM orders 
        WHERE status IN ('PENDING', 'IN-PROGRESS', 'COOKING', 'COMPLETED')
    ");
    $activeOrders = $activeStmt->fetch()['count'] ?? 0;

    // Served today (status = SERVED)
    $today = date('Y-m-d');
    $servedStmt = $pdo->prepare("
        SELECT COUNT(*) as count 
        FROM orders 
        WHERE status = 'SERVED' AND DATE(updated_at) = :today
    ");
    $servedStmt->execute(['today' => $today]);
    $servedToday = $servedStmt->fetch()['count'] ?? 0;

    // Recent active orders with items (incl. COMPLETED = ready to deliver)
    $orderStmt = $pdo->query("
        SELECT 
            o.order_id,
            o.reference_number,
            o.status,
            o.total_amount,
            o.order_type,
            rt.table_number,
            DATE_FORMAT(o.ordered_at, '%Y-%m-%dT%H:%i:%s') as ordered_at
        FROM orders o
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        WHERE o.status IN ('PENDING', 'IN-PROGRESS', 'COOKING', 'COMPLETED')
        ORDER BY o.ordered_at DESC
        LIMIT 10
    ");
    $orders = $orderStmt->fetchAll();

    // Get items for each order
    foreach ($orders as &$order) {
        $itemStmt = $pdo->prepare("
            SELECT 
                oi.quantity,
                mi.item_name
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
            WHERE oi.order_id = :order_id AND oi.is_deleted = 0
        ");
        $itemStmt->execute(['order_id' => $order['order_id']]);
        $order['items'] = $itemStmt->fetchAll();
    }

    // All tables
    $tableStmt = $pdo->query("
        SELECT
            table_id,
            table_number,
            status,
            updated_at
        FROM restaurant_table
        WHERE is_deleted = 0
        ORDER BY CAST(table_number AS UNSIGNED)
        LIMIT 20
    ");
    $tables = $tableStmt->fetchAll();
    $totalTables = count($tables);

    echo json_encode([
        'success' => true,
        'total_tables' => (int)$totalTables,
        'available_tables' => (int)$available,
        'occupied_tables' => (int)$occupied,
        'maintenance_tables' => (int)$maintenance,
        'active_orders' => (int)$activeOrders,
        'served_today' => (int)$servedToday,
        'orders' => $orders,
        'tables' => $tables
    ]);
} catch (PDOException $e) {
    error_log('get_dashboard_stats error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load dashboard statistics.']);
}