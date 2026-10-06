<?php
header('Content-Type: application/json');

require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/Kitchen.php';
require_once __DIR__ . '/../../date_window_helper.php';

/**
 * Get kitchen orders history with pagination and filtering
 *
 * Query params:
 * - page (int): page number (default 1)
 * - limit (int): items per page (default 20)
 * - search (string): search in reference_number, customer_name
 * - status (string): filter by status
 * - type (string): filter by order_type
 * - payment_method (string): CASH | GCASH
 * - cashier (string): exact resolved cashier/attribution name (see GCash rule)
 * - date_from (string): YYYY-MM-DD
 * - date_to (string): YYYY-MM-DD
 * - export (string): 'csv' for CSV export
 *
 * Attribution rule (advisor requirement):
 * Online GCash orders with NO cashier/user attached are attributed to "Admin".
 *
 * Response format:
 * {
 *   "status": "success",
 *   "message": "Orders retrieved",
 *   "data": {
 *     "data": [...],
 *     "pagination": { "page": 1, "limit": 20, "total": 100, "total_pages": 5 },
 *     "stats": { "total_orders": N, "paid_orders": N, "paid_revenue": "0.00", "avg_order_value": "0.00" },
 *     "cashiers": ["Admin", "Emmie Binongo", ...]
 *   }
 * }
 */

$user = authenticate(['Kitchen Staff', 'Admin', 'Supervisor']);

$page = max(1, (int)($_GET['page'] ?? 1));
$limit = min(100, max(1, (int)($_GET['limit'] ?? 20)));
$search = trim($_GET['search'] ?? '');
$status = $_GET['status'] ?? '';
$type = $_GET['type'] ?? '';

// ---- Kitchen Staff default: show only COMPLETED unless a specific status filter is requested ----
$userRole = $user['role'] ?? '';
if ($userRole === 'Kitchen Staff' && empty($status) && !isset($_GET['cancelled_today'])) {
    $status = 'COMPLETED';
}
$paymentMethod = strtoupper(trim($_GET['payment_method'] ?? ''));
$cashier = trim($_GET['cashier'] ?? '');
$dateFrom = $_GET['date_from'] ?? '';
$dateTo = $_GET['date_to'] ?? '';
$isExport = isset($_GET['export']) && $_GET['export'] === 'csv';

// ---- Supervisor golden rule: history is locked to the 31-day rolling window ----
// (Admin / Kitchen Staff behaviour is unchanged — enforcement applies only to Supervisor.)
if (($user['role'] ?? '') === 'Supervisor') {
    $window = hof_month_window($dateFrom ?: null, $dateTo ?: null);
    if ($window['blocked']) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Supervisor access is limited to the last 31 days.']);
        exit;
    }
    [$dateFrom, $dateTo] = [$window['from'], $window['to']];
}

$kitchen = new Kitchen();

// ---- Resolved attribution expression ------------------------------------
// GCash online payment with no processor user and no order user => "Admin"
$cashierNameExpr = "TRIM(CONCAT(COALESCE(pu.first_name,''), ' ', COALESCE(pu.last_name,'')))";
$resolvedCashierExpr = "CASE
    WHEN p.payment_method = 'GCASH' AND p.user_id IS NULL AND o.user_id IS NULL THEN 'Admin'
    ELSE {$cashierNameExpr}
END";

// ---- Joins ----------------------------------------------------------------
$joinPayment = "
    LEFT JOIN payments p
        ON p.payment_id = (
            SELECT MAX(x.payment_id) FROM payments x
            WHERE x.order_id = o.order_id AND x.payment_status = 'COMPLETED'
        )
    LEFT JOIN users pu ON pu.user_id = COALESCE(p.user_id, o.user_id)
";

// ---- Where conditions ------------------------------------------------------
$whereConditions = ["o.order_type IN ('DINE_IN', 'TAKE_OUT')"];
$params = [];

if ($search) {
    $whereConditions[] = "(o.reference_number LIKE :search OR o.customer_name LIKE :search)";
    $params[':search'] = "%$search%";
}

// ---- cancelled_today mode (Kitchen Staff quick-filter) ----
$cancelledToday = isset($_GET['cancelled_today']) && $_GET['cancelled_today'] === '1';
if ($cancelledToday) {
    $whereConditions[] = "o.status = 'CANCELLED'";
    $whereConditions[] = "DATE(o.updated_at) = CURDATE()";
}

if ($status) {
    $validStatuses = ['PENDING', 'IN-PROGRESS', 'COOKING', 'COMPLETED', 'SERVED', 'CANCELLED'];
    if (in_array($status, $validStatuses, true)) {
        $whereConditions[] = "o.status = :status";
        $params[':status'] = $status;
    }
}

if ($type) {
    $validTypes = ['DINE_IN', 'TAKE_OUT'];
    if (in_array($type, $validTypes, true)) {
        $whereConditions[] = "o.order_type = :type";
        $params[':type'] = $type;
    }
}

// Payment method filter (CASH / GCASH)
if ($paymentMethod && in_array($paymentMethod, ['CASH', 'GCASH'], true)) {
    $whereConditions[] = "p.payment_method = :pay_method";
    $params[':pay_method'] = $paymentMethod;
}

// Cashier filter — matches the RESOLVED attribution shown in the table,
// so filtering by "Admin" includes auto-attributed online GCash orders.
if ($cashier !== '') {
    $whereConditions[] = "({$resolvedCashierExpr}) = :cashier";
    $params[':cashier'] = $cashier;
}

if ($dateFrom) {
    $whereConditions[] = "DATE(o.ordered_at) >= :date_from";
    $params[':date_from'] = $dateFrom;
}

if ($dateTo) {
    $whereConditions[] = "DATE(o.ordered_at) <= :date_to";
    $params[':date_to'] = $dateTo;
}

$whereClause = implode(' AND ', $whereConditions);
$db = $kitchen->getDb();

// ---- Stats over the FULL filtered set (not just current page) -------------
$statsSql = "
    SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN p.payment_id IS NOT NULL THEN o.total_amount ELSE 0 END), 0) AS paid_revenue,
        COALESCE(SUM(CASE WHEN p.payment_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS paid_orders
    FROM orders o
    $joinPayment
    WHERE $whereClause
";
$statsStmt = $db->prepare($statsSql);
$statsStmt->execute($params);
$statsRow = $statsStmt->fetch(PDO::FETCH_ASSOC);

$totalOrders = (int)$statsRow['total_orders'];
$paidOrders = (int)$statsRow['paid_orders'];
$paidRevenue = (float)$statsRow['paid_revenue'];

// Total Profit (gross): paid revenue - COGS (APPROVED stock-out value in range, schema-agnostic)
$grossProfit = $paidRevenue;
try {
    $hasUnitCost = false;
    try {
        $colChk = $db->prepare("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'stock_out_items' AND column_name = 'unit_cost'");
        $colChk->execute();
        $hasUnitCost = ((int)$colChk->fetchColumn() > 0);
    } catch (Throwable $t) { $hasUnitCost = false; }
    $costExpr = $hasUnitCost ? "COALESCE(soi.unit_cost, rm.cost_per_unit, 0)" : "COALESCE(rm.cost_per_unit, 0)";
    $cogsSql = "SELECT COALESCE(SUM(soi.quantity * $costExpr),0) AS cogs
        FROM stock_out so
        JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
        JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
        WHERE so.status = 'APPROVED'";
    $cogsParams = [];
    if ($dateFrom) { $cogsSql .= " AND DATE(so.stock_out_date) >= :cogs_from"; $cogsParams[':cogs_from'] = $dateFrom; }
    if ($dateTo) { $cogsSql .= " AND DATE(so.stock_out_date) <= :cogs_to"; $cogsParams[':cogs_to'] = $dateTo; }
    $cogsStmt = $db->prepare($cogsSql);
    $cogsStmt->execute($cogsParams);
    $cogs = (float)$cogsStmt->fetchColumn();
    $grossProfit = $paidRevenue - $cogs;
} catch (Throwable $t) { $grossProfit = $paidRevenue; }

$stats = [
    'total_orders' => $totalOrders,
    'paid_orders' => $paidOrders,
    'unpaid_orders' => $totalOrders - $paidOrders,
    'paid_revenue' => number_format($paidRevenue, 2, '.', ''),
    'avg_order_value' => number_format($paidOrders > 0 ? $paidRevenue / $paidOrders : 0, 2, '.', ''),
    'gross_profit' => number_format($grossProfit, 2, '.', '')
];

// ---- Cashier dropdown options ----------------------------------------------
// Active staff whose actions can appear as attribution + virtual "Admin".
try {
    $cashiersStmt = $db->query("
        SELECT DISTINCT TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS display_name
        FROM users u
        JOIN roles r ON u.role_id = r.role_id
        WHERE u.status = 'Active' AND r.role_name IN ('Cashier', 'Admin', 'Supervisor')
        ORDER BY display_name ASC
    ");
    $cashiers = $cashiersStmt->fetchAll(PDO::FETCH_COLUMN);
    // Ensure "Admin" present (covers GCash auto-attribution even if no Admin user row)
    if (!in_array('Admin', $cashiers, true)) {
        array_unshift($cashiers, 'Admin');
    }
} catch (Exception $e) {
    $cashiers = ['Admin'];
}

// ---- Total count ------------------------------------------------------------
$countSql = "SELECT COUNT(*) as total FROM orders o $joinPayment WHERE $whereClause";
$countStmt = $db->prepare($countSql);
$countStmt->execute($params);
$total = (int)$countStmt->fetchColumn();

// ---- Page rows ---------------------------------------------------------------
$offset = ($page - 1) * $limit;
$queryParams = $params;
$queryParams[':limit'] = $limit;
$queryParams[':offset'] = $offset;

$sql = "
    SELECT
        o.order_id,
        o.reference_number,
        o.table_id,
        o.status,
        o.ordered_at,
        o.cooking_started_at,
        o.completed_at,
        o.order_type,
        o.total_amount,
        o.customer_name,
        rt.table_number,
        p.payment_method,
        p.paid_at,
        CASE WHEN p.payment_id IS NOT NULL THEN 1 ELSE 0 END AS is_paid,
        {$resolvedCashierExpr} AS cashier_name
    FROM orders o
    $joinPayment
    LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
    WHERE $whereClause
    ORDER BY o.ordered_at DESC
    LIMIT :limit OFFSET :offset
";

$stmt = $db->prepare($sql);
$stmt->execute($queryParams);
$orders = $stmt->fetchAll(PDO::FETCH_ASSOC);

// Fetch items for each order
try {
    foreach ($orders as &$order) {
        $order['items'] = $kitchen->getOrderItems($order['order_id']);
    }
    unset($order);
} catch (Throwable $e) {
    // REQ-065 #3: missing live column (order_items.subtotal etc) must not 500 before JSON.
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Could not load order items: ' . $e->getMessage()]);
    exit;
}

// ---- CSV Export ----------------------------------------------------------------
if ($isExport) {
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="order-history-' . date('Y-m-d') . '.csv"');
    $output = fopen('php://output', 'w');

    fputcsv($output, ['Order ID', 'Reference', 'Ordered At', 'Type', 'Status', 'Customer', 'Table', 'Payment Method', 'Paid At', 'Cashier', 'Total Amount', 'Items']);

    foreach ($orders as $order) {
        $itemsStr = implode('; ', array_map(fn($i) => "{$i['item_name']} x{$i['quantity']}", $order['items']));
        fputcsv($output, [
            $order['order_id'],
            $order['reference_number'],
            $order['ordered_at'],
            $order['order_type'],
            $order['status'],
            $order['customer_name'] ?? '',
            $order['table_number'] ?? '',
            ((int)$order['is_paid'] === 1 && !empty($order['payment_method'])) ? strtoupper($order['payment_method']) : 'UNPAID',
            $order['paid_at'] ?? '',
            $order['cashier_name'] ?? '',
            $order['total_amount'],
            $itemsStr
        ]);
    }

    fclose($output);
    exit;
}

echo json_encode([
    'status' => 'success',
    'message' => 'Orders retrieved',
    'data' => [
        'data' => $orders,
        'pagination' => [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => (int)ceil($total / $limit)
        ],
        'stats' => $stats,
        'cashiers' => $cashiers
    ]
]);