<?php
/**
 * HOF Waiter API - Order History
 * Returns today's orders with status + ownership filters.
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
header('Content-Type: application/json');

$auth = authenticate(['Waiter', 'Admin', 'Supervisor']);
$waiterId = (int)$auth['user_id'];

try {
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = min(100, max(1, (int)($_GET['limit'] ?? 20)));
    $search = trim($_GET['search'] ?? '');
    $status = trim($_GET['status'] ?? 'all');
    $scope = trim($_GET['scope'] ?? 'mine');

    // Hard-code today boundary
    $today = date('Y-m-d');
    $tomorrow = date('Y-m-d', strtotime('+1 day'));

    $whereConditions = ["o.ordered_at >= :today_start", "o.ordered_at < :tomorrow_start"];
    $params = [':today_start' => $today . ' 00:00:00', ':tomorrow_start' => $tomorrow . ' 00:00:00'];

    // Status filter (whitelist all valid statuses including CANCELLED)
    $validStatuses = ['PENDING', 'IN-PROGRESS', 'COOKING', 'COMPLETED', 'SERVED', 'CANCELLED'];
    if ($status !== 'all' && in_array($status, $validStatuses, true)) {
        $whereConditions[] = "o.status = :status";
        $params[':status'] = $status;
    }

    // Ownership filter
    if ($scope === 'mine') {
        $whereConditions[] = "o.user_id = :waiter_id";
        $params[':waiter_id'] = $waiterId;
    }

    if ($search) {
        $whereConditions[] = "(o.reference_number LIKE :search OR o.customer_name LIKE :search)";
        $params[':search'] = "%$search%";
    }

    $whereClause = implode(' AND ', $whereConditions);

    // Get total count
    $countSql = "SELECT COUNT(*) as total FROM orders o WHERE $whereClause";
    $countStmt = $pdo->prepare($countSql);
    $countStmt->execute($params);
    $total = (int)$countStmt->fetchColumn();

    // Get orders
    $offset = ($page - 1) * $limit;

    $sql = "
        SELECT 
            o.order_id,
            o.reference_number,
            o.table_id,
            o.status,
            o.ordered_at,
            UNIX_TIMESTAMP(o.ordered_at) AS ordered_at_epoch,
            o.completed_at,
            UNIX_TIMESTAMP(o.completed_at) AS completed_at_epoch,
            o.order_type,
            o.total_amount,
            o.customer_name,
            o.user_id,
            rt.table_number,
            CONCAT(u.first_name, ' ', u.last_name) AS creator_name
        FROM orders o
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        LEFT JOIN users u ON o.user_id = u.user_id
        WHERE $whereClause
        ORDER BY o.ordered_at DESC
        LIMIT :limit OFFSET :offset
    ";

    $stmt = $pdo->prepare($sql);
    $bindParams = array_merge($params, [':limit' => $limit, ':offset' => $offset]);
    $stmt->execute($bindParams);
    $orders = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Fetch items for each order
    foreach ($orders as &$order) {
        $itemStmt = $pdo->prepare("
            SELECT 
                oi.quantity,
                mi.item_name,
                mi.price
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
            WHERE oi.order_id = :order_id AND oi.is_deleted = 0
        ");
        $itemStmt->execute(['order_id' => $order['order_id']]);
        $order['items'] = $itemStmt->fetchAll(PDO::FETCH_ASSOC);
    }
    unset($order);

    echo json_encode([
        'success' => true,
        'orders' => $orders,
        'pagination' => [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => (int)ceil($total / $limit)
        ]
    ]);
} catch (Exception $e) {
    error_log('get_order_history error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Failed to load order history.']);
}