<?php
/**
 * Admin Activity Logs API
 * Fetches activity logs from the centralized activity_logs table,
 * with UNION fallback to existing business tables for historical data.
 * Accessible by: Admin, Supervisor
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../date_window_helper.php';
header('Content-Type: application/json');

// Auth: Admin or Supervisor
$user = authenticate(['Admin', 'Supervisor']);

// Parse filters
$page     = max(1, intval($_GET['page'] ?? 1));
$limit    = min(100, max(1, intval($_GET['limit'] ?? 50)));
$offset   = ($page - 1) * $limit;

$date_from    = $_GET['date_from'] ?? date('Y-m-01');
$date_to      = $_GET['date_to'] ?? date('Y-m-d');
$action_type  = $_GET['action_type'] ?? '';
$role_filter  = $_GET['role'] ?? '';
$user_search  = $_GET['user_search'] ?? '';

// REQ-049: Supervisor hard-block — activity logs are locked to the 31-day rolling window.
if (($user['role'] ?? '') === 'Supervisor') {
    $window = hof_month_window($date_from ?: null, $date_to ?: null);
    if ($window['blocked']) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Supervisor access is limited to the last 31 days.']);
        exit;
    }
    $date_from = $window['from'];
    $date_to   = $window['to'];
}

try {
    $db = $pdo;

    // ---------- Check if activity_logs table exists ----------
    $tableExists = false;
    try {
        $check = $db->query("SHOW TABLES LIKE 'activity_logs'");
        $tableExists = $check && $check->fetchColumn();
    } catch (Exception $e) {
        $tableExists = false;
    }

    // Build WHERE conditions
    $where = [];
    $params = [];

    $where[] = "created_at BETWEEN ? AND ?";
    $params[] = $date_from . ' 00:00:00';
    $params[] = $date_to . ' 23:59:59';

    if ($action_type) {
        $where[] = "action_type = ?";
        $params[] = $action_type;
    }

    if ($role_filter) {
        $where[] = "user_role = ?";
        $params[] = $role_filter;
    }

    if ($user_search) {
        $where[] = "(username LIKE ? OR description LIKE ? OR reference_number LIKE ?)";
        $params[] = "%$user_search%";
        $params[] = "%$user_search%";
        $params[] = "%$user_search%";
    }

    $where_sql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    // ------ COUNT ------
    if ($tableExists) {
        $count_sql = "SELECT COUNT(*) FROM activity_logs $where_sql";
        $stmt = $db->prepare($count_sql);
        $stmt->execute($params);
        $total = (int)$stmt->fetchColumn();

        // ------ DATA ------
        $data_sql = "SELECT 
                        log_id,
                        user_id,
                        username,
                        user_role,
                        action_type,
                        action_category,
                        description,
                        reference_type,
                        reference_id,
                        reference_number,
                        ip_address,
                        status,
                        created_at as activity_date
                     FROM activity_logs 
                     $where_sql 
                     ORDER BY created_at DESC 
                     LIMIT ? OFFSET ?";
        $data_params = $params;
        $data_params[] = $limit;
        $data_params[] = $offset;

        $stmt = $db->prepare($data_sql);
        $stmt->execute($data_params);
        $activities = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // ------ DISTINCT FILTERS ------
        $types_sql = "SELECT DISTINCT action_type FROM activity_logs ORDER BY action_type";
        $stmt = $db->query($types_sql);
        $action_types = $stmt->fetchAll(PDO::FETCH_COLUMN);

        $roles_sql = "SELECT DISTINCT user_role FROM activity_logs WHERE user_role IS NOT NULL ORDER BY user_role";
        $stmt = $db->query($roles_sql);
        $roles = $stmt->fetchAll(PDO::FETCH_COLUMN);
    } else {
        // Fallback: use the UNION query from existing business tables
        $result = fetchActivityFromBusinessTables($db, $date_from, $date_to, $action_type, $role_filter, $user_search, $page, $limit, $offset);
        $activities   = $result['data'];
        $total        = $result['total'];
        $action_types = $result['action_types'];
        $roles        = $result['roles'];
    }

    echo json_encode([
        'success' => true,
        'data' => $activities,
        'pagination' => [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => max(1, ceil($total / $limit))
        ],
        'filters' => [
            'action_types' => $action_types ?? [],
            'roles' => $roles ?? []
        ]
    ]);

} catch (Exception $e) {
    error_log("Activity logs error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Server error: ' . $e->getMessage()]);
}

/**
 * Fallback: query activity from existing business tables via UNION
 */
function fetchActivityFromBusinessTables(PDO $db, $date_from, $date_to, $action_type, $role_filter, $user_search, $page, $limit, $offset) {
    $where_clauses = [];
    $params = [];
    $where_clauses[] = "activity_date BETWEEN ? AND ?";
    $params[] = $date_from . ' 00:00:00';
    $params[] = $date_to . ' 23:59:59';

    if ($action_type) {
        $where_clauses[] = "action_type = ?";
        $params[] = $action_type;
    }
    if ($user_search) {
        $where_clauses[] = "(actor_name LIKE ? OR actor_username LIKE ?)";
        $params[] = "%$user_search%";
        $params[] = "%$user_search%";
    }

    $union_parts = [
        // ORDERS
        "SELECT 'ORDER' as action_category, 'ORDER_CREATED' as action_type, o.order_id as reference_id, o.reference_number, o.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Order #', o.reference_number, ' created - ', o.status, ' - ₱', FORMAT(o.total_amount, 2)) as description, o.status as status FROM orders o LEFT JOIN users u ON o.user_id = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id WHERE o.created_at BETWEEN ? AND ?",
        // STOCK IN
        "SELECT 'INVENTORY' as action_category, 'STOCK_IN' as action_type, si.stock_in_id as reference_id, CONCAT('SI-', LPAD(si.stock_in_id, 6, '0')) as reference_number, si.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Stock received from ', s.supplier_name, ' - ', si.status, ' - ₱', FORMAT(si.total_cost, 2)) as description, si.status as status FROM stock_in si LEFT JOIN users u ON si.user_id = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id LEFT JOIN suppliers s ON si.supplier_id = s.supplier_id WHERE si.created_at BETWEEN ? AND ?",
        // STOCK OUT
        "SELECT 'INVENTORY' as action_category, 'STOCK_OUT' as action_type, so.stock_out_id as reference_id, CONCAT('SO-', LPAD(so.stock_out_id, 6, '0')) as reference_number, so.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Stock dispatched - ', so.status, ' - ', so.remarks) as description, so.status as status FROM stock_out so LEFT JOIN users u ON so.user_id = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id WHERE so.created_at BETWEEN ? AND ?",
        // PAYMENTS
        "SELECT 'SALES' as action_category, 'PAYMENT' as action_type, p.payment_id as reference_id, p.transaction_reference as reference_number, p.paid_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Payment received - ', p.payment_method, ' - ₱', FORMAT(p.amount_paid, 2), ' - ', p.payment_status) as description, p.payment_status as status FROM payments p LEFT JOIN users u ON p.user_id = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id WHERE p.paid_at BETWEEN ? AND ?",
        // USERS
        "SELECT 'USER_MGMT' as action_category, 'USER_CREATED' as action_type, u.user_id as reference_id, u.username as reference_number, u.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('New user created: ', u.username, ' (', r.role_name, ')') as description, u.status as status FROM users u LEFT JOIN roles r ON u.role_id = r.role_id WHERE u.created_at BETWEEN ? AND ?",
        // SPOILAGE
        "SELECT 'INVENTORY' as action_category, 'SPOILAGE' as action_type, sp.spoilage_id as reference_id, sp.reference_number as reference_number, sp.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Spoilage reported: ', rm.raw_material_name, ' - ', sp.quantity_lost, ' ', rm.unit, ' - ₱', FORMAT(sp.estimated_loss_cost, 2), ' - ', sp.status) as description, sp.status as status FROM spoilage sp LEFT JOIN users u ON sp.user_id = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id LEFT JOIN raw_materials rm ON sp.raw_material_id = rm.raw_material_id WHERE sp.created_at BETWEEN ? AND ?",
        // ADJUSTMENTS
        "SELECT 'INVENTORY' as action_category, 'ADJUSTMENT' as action_type, a.adjustment_id as reference_id, CONCAT('ADJ-', LPAD(a.adjustment_id, 6, '0')) as reference_number, a.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Inventory adjustment: ', a.adjustment_type, ' - ', a.reason, ' - ', a.status) as description, a.status as status FROM adjustments a LEFT JOIN users u ON a.user_id = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id WHERE a.created_at BETWEEN ? AND ?",
        // VOIDS
        "SELECT 'SALES' as action_category, 'VOID' as action_type, v.void_id as reference_id, CONCAT('VD-', LPAD(v.void_id, 6, '0')) as reference_number, v.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Order void requested - Order #', o.reference_number, ' - ', v.status, ' - ', v.reason) as description, v.status as status FROM voids v LEFT JOIN users u ON v.requested_by = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id LEFT JOIN orders o ON v.order_id = o.order_id WHERE v.created_at BETWEEN ? AND ?",
        // RETURNS
        "SELECT 'INVENTORY' as action_category, 'RETURN' as action_type, rt.return_id as reference_id, rt.reference_number as reference_number, rt.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Supplier return: ', rt.return_type, ' - ', rt.reason, ' - ', rt.status) as description, rt.status as status FROM returns rt LEFT JOIN users u ON rt.user_id = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id WHERE rt.created_at BETWEEN ? AND ?",
        // PURCHASE PLANS
        "SELECT 'INVENTORY' as action_category, 'PURCHASE_PLAN' as action_type, pp.plan_id as reference_id, CONCAT('PP-', LPAD(pp.plan_id, 6, '0')) as reference_number, pp.created_at as activity_date, u.username as actor_username, CONCAT(u.first_name, ' ', u.last_name) as actor_name, r.role_name as actor_role, CONCAT('Purchase plan created - ', pp.status, ' - ₱', FORMAT(pp.total_cost, 2)) as description, pp.status as status FROM purchase_plans pp LEFT JOIN users u ON pp.created_by = u.user_id LEFT JOIN roles r ON u.role_id = r.role_id WHERE pp.created_at BETWEEN ? AND ?"
    ];

    $total_unions = count($union_parts);

    // Add role filter to each UNION part
    if ($role_filter) {
        $union_parts = array_map(function($part) use ($role_filter, &$params_for_role) {
            $params_for_role[] = $role_filter;
            return $part . " AND r.role_name = ?";
        }, $union_parts);
    }

    // Build params for each UNION part
    $all_params = [];
    for ($i = 0; $i < $total_unions; $i++) {
        $all_params[] = $date_from . ' 00:00:00';
        $all_params[] = $date_to . ' 23:59:59';
    }
    if ($action_type) {
        for ($i = 0; $i < $total_unions; $i++) {
            $all_params[] = $action_type;
        }
    }
    if ($user_search) {
        for ($i = 0; $i < $total_unions; $i++) {
            $all_params[] = "%$user_search%";
            $all_params[] = "%$user_search%";
        }
    }
    if ($role_filter) {
        for ($i = 0; $i < $total_unions; $i++) {
            $all_params[] = $role_filter;
        }
    }

    // DATA
    $sql = '(' . implode(') UNION ALL (', $union_parts) . ')';
    $sql .= " ORDER BY activity_date DESC LIMIT ? OFFSET ?";
    $data_params = $all_params;
    $data_params[] = $limit;
    $data_params[] = $offset;

    $stmt = $db->prepare($sql);
    $stmt->execute($data_params);
    $activities = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // COUNT (rough estimate from first UNION)
    $count_sql = 'SELECT COUNT(*) as total FROM (' . $union_parts[0] . ') as t';
    $count_params = [$date_from . ' 00:00:00', $date_to . ' 23:59:59'];
    if ($action_type) $count_params[] = $action_type;
    if ($user_search) { $count_params[] = "%$user_search%"; $count_params[] = "%$user_search%"; }
    if ($role_filter) $count_params[] = $role_filter;
    $stmt = $db->prepare($count_sql);
    $stmt->execute($count_params);
    $total = $stmt->fetchColumn() * $total_unions;

    // FILTER TYPES
    $sql_no_limit = str_replace(' ORDER BY activity_date DESC LIMIT ? OFFSET ?', '', $sql);
    $dropdown_params = array_slice($all_params, 0, count($all_params));
    $types_sql = "SELECT DISTINCT action_type FROM ($sql_no_limit) as t ORDER BY action_type";
    $stmt = $db->prepare($types_sql);
    $stmt->execute($dropdown_params);
    $action_types = $stmt->fetchAll(PDO::FETCH_COLUMN);
    $roles_sql = "SELECT DISTINCT actor_role FROM ($sql_no_limit) as t WHERE actor_role IS NOT NULL ORDER BY actor_role";
    $stmt = $db->prepare($roles_sql);
    $stmt->execute($dropdown_params);
    $roles = $stmt->fetchAll(PDO::FETCH_COLUMN);

    return [
        'data' => $activities,
        'total' => $total,
        'action_types' => $action_types,
        'roles' => $roles
    ];
}