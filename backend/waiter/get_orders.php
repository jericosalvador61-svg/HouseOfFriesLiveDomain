<?php
/**
 * HOF Waiter API - Get Orders
 * Returns: orders filtered by status tab.
 *
 * Accepts EITHER a tab key (pending | preparing | ready | served | cancelled
 * | all) OR a raw database status (PENDING | IN-PROGRESS | COOKING |
 * COMPLETED | SERVED | CANCELLED). Raw statuses are validated against a
 * whitelist, so nothing is ever interpolated from user input.
 *
 * Flow: PENDING -> IN-PROGRESS -> COOKING -> COMPLETED (kitchen) -> SERVED (waiter)
 */
header('Content-Type: application/json');

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../db.php';

authenticate(['Waiter', 'Admin', 'Supervisor']);

try {
    $requested = strtoupper(trim((string)($_GET['status'] ?? 'all')));

    // Tab key -> database statuses
    $statusMap = [
        'PENDING'    => ['PENDING'],
        'PREPARING'  => ['IN-PROGRESS', 'COOKING'],
        'READY'      => ['COMPLETED'],
        'SERVED'     => ['SERVED'],
        'CANCELLED'  => ['CANCELLED'],
        // All in-flight statuses: waiter dashboard "Active Orders" list.
        'ACTIVE'     => ['PENDING', 'IN-PROGRESS', 'COOKING', 'COMPLETED', 'SERVED'],
    ];

    // Raw statuses that may be requested directly
    $rawAllowed = ['PENDING', 'IN-PROGRESS', 'COOKING', 'COMPLETED', 'SERVED', 'CANCELLED'];

    $where  = '';
    $params = [];

    if ($requested !== '' && $requested !== 'ALL') {
        if (isset($statusMap[$requested])) {
            $statuses = $statusMap[$requested];
        } elseif (in_array($requested, $rawAllowed, true)) {
            $statuses = [$requested];
        } else {
            $statuses = null; // unknown -> no filter (same as 'all')
        }

        if ($statuses !== null) {
            $placeholders = implode(',', array_fill(0, count($statuses), '?'));
            $where  = " WHERE o.status IN ($placeholders)";
            $params = $statuses;
        }
    }

    $sql = "
        SELECT 
            o.order_id,
            o.reference_number,
            o.order_type,
            o.status,
            o.total_amount,
            o.customer_name,
            rt.table_number,
            DATE_FORMAT(o.ordered_at, '%Y-%m-%dT%H:%i:%s') as ordered_at,
            UNIX_TIMESTAMP(o.ordered_at) AS ordered_at_epoch,
            DATE_FORMAT(o.completed_at, '%Y-%m-%dT%H:%i:%s') as completed_at,
            UNIX_TIMESTAMP(o.completed_at) AS completed_at_epoch,
            CONCAT(u.first_name, ' ', u.last_name) as created_by_name
        FROM orders o
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        LEFT JOIN users u ON o.user_id = u.user_id
    ";

    $sql .= $where;
    $sql .= " ORDER BY o.ordered_at DESC LIMIT 100";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $orders = $stmt->fetchAll();

    // Get items for each order
    foreach ($orders as &$order) {
        $itemStmt = $pdo->prepare("
            SELECT 
                oi.order_item_id,
                oi.quantity,
                mi.item_name,
                mi.price
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
            WHERE oi.order_id = :order_id AND oi.is_deleted = 0
        ");
        $itemStmt->execute(['order_id' => $order['order_id']]);
        $order['items'] = $itemStmt->fetchAll();
    }

    echo json_encode(['success' => true, 'orders' => $orders]);
} catch (PDOException $e) {
    error_log('get_orders error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load orders.']);
}