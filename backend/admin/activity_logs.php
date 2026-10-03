<?php
/**
 * Admin Activity Logs API
 * Fetches activity logs from the centralized activity_logs table.
 * Direct logging is the SINGLE source of truth (REQ-050 — no business-table reconstruction).
 * Accessible by: Admin, Supervisor
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../date_window_helper.php';
header('Content-Type: application/json');

// Auth: Admin or Supervisor
$user = authenticate(['Admin', 'Supervisor']);

// REQ-050: export flag — stream the FULL filtered set (no 100-row clamp)
$export = ($_GET['export'] ?? '') === '1';

// Parse filters
$page     = max(1, intval($_GET['page'] ?? 1));
$limit    = $export ? 50000 : min(100, max(1, intval($_GET['limit'] ?? 50)));
$offset   = ($page - 1) * $limit;

$date_from    = $_GET['date_from'] ?? date('Y-m-01');
$date_to      = $_GET['date_to'] ?? date('Y-m-d');
$action_type  = $_GET['action_type'] ?? '';
$role_filter  = $_GET['role'] ?? '';
$user_search  = $_GET['user_search'] ?? '';
$module_filter = $_GET['module'] ?? '';       // REQ-050: filters action_category
$status_filter = $_GET['status'] ?? '';       // REQ-050: filters status column

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

    if (!$tableExists) {
        // Direct-logging single source missing — return empty list + clear message, never reconstruct.
        echo json_encode([
            'success' => true,
            'data' => [],
            'pagination' => ['page' => $page, 'limit' => $limit, 'total' => 0, 'total_pages' => 1],
            'filters' => ['action_types' => [], 'roles' => [], 'modules' => [], 'statuses' => []],
            'message' => 'activity_logs table is missing. Import the consolidated schema; activity logs will be recorded once the table exists.'
        ]);
        exit;
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

    if ($module_filter) {
        $where[] = "action_category = ?";
        $params[] = $module_filter;
    }

    if ($status_filter) {
        $where[] = "status = ?";
        $params[] = $status_filter;
    }

    if ($user_search) {
        $where[] = "(username LIKE ? OR description LIKE ? OR reference_number LIKE ?)";
        $params[] = "%$user_search%";
        $params[] = "%$user_search%";
        $params[] = "%$user_search%";
    }

    $where_sql = $where ? 'WHERE ' . implode(' AND ', $where) : '';

    // ------ COUNT ------
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
                    user_agent,
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

    // REQ-050: distinct module (action_category) + status values for the filter dropdowns
    $modules_sql = "SELECT DISTINCT action_category FROM activity_logs WHERE action_category IS NOT NULL ORDER BY action_category";
    $stmt = $db->query($modules_sql);
    $modules = $stmt->fetchAll(PDO::FETCH_COLUMN);

    // REQ-058: merge a STATIC complete module list so categories with no rows in
    // the current window (e.g. CUSTOMER) still show in the filter dropdown.
    $allModules = ['AUTH','ORDER','SALES','TABLE','KITCHEN','INVENTORY','USER_MGMT','CUSTOMER','MENU','SETTINGS','SYSTEM'];
    $modules = array_values(array_unique(array_merge($allModules, $modules)));

    $statuses_sql = "SELECT DISTINCT status FROM activity_logs WHERE status IS NOT NULL AND status <> '' ORDER BY status";
    $stmt = $db->query($statuses_sql);
    $statuses = $stmt->fetchAll(PDO::FETCH_COLUMN);

    echo json_encode([
        'success' => true,
        'data' => $activities,
        'pagination' => [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => max(1, ceil($total / $limit)),
            'export_cap' => $export ? 50000 : null
        ],
        'filters' => [
            'action_types' => $action_types ?? [],
            'roles' => $roles ?? [],
            'modules' => $modules ?? [],
            'statuses' => $statuses ?? []
        ]
    ]);

} catch (Exception $e) {
    error_log("Activity logs error: " . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Server error: ' . $e->getMessage()]);
}