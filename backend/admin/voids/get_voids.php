<?php
/**
 * ============================================================
 * HOF Admin API - Voids Dashboard
 * Returns every voided ITEM (void_requests joined to void_items
 * joined to the actual order item + menu item), with filters:
 *
 * GET params:
 *   status   : '' | PENDING | APPROVED | REJECTED
 *   search   : matches item name / reference number / reason / requester
 *   date_from: YYYY-MM-DD (on voids.created_at)
 *   date_to  : YYYY-MM-DD
 *   page     : int (default 1)
 *   limit    : int (default 20, max 100)
 *   export   : 'csv' to download filtered results
 *
 * Response:
 *   { success, items: [...], stats: {...}, pagination: {...} }
 * ============================================================
 */
header('Content-Type: application/json');

require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../date_window_helper.php';
$user = authenticate(['Admin', 'Supervisor']);

$page  = max(1, (int)($_GET['page'] ?? 1));
$limit = min(100, max(1, (int)($_GET['limit'] ?? 20)));
$status = strtoupper(trim($_GET['status'] ?? ''));
$search = trim($_GET['search'] ?? '');
$dateFrom = $_GET['date_from'] ?? '';
$dateTo = $_GET['date_to'] ?? '';
$isExport = isset($_GET['export']) && $_GET['export'] === 'csv';

// REQ-049: Supervisor hard-block — voids are locked to the 31-day rolling window.
if (($user['role'] ?? '') === 'Supervisor') {
    $window = hof_month_window($dateFrom ?: null, $dateTo ?: null);
    if ($window['blocked']) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Supervisor access is limited to the last 31 days.']);
        exit;
    }
    $dateFrom = $window['from'];
    $dateTo   = $window['to'];
}

$where = [];
$params = [];

if ($status && in_array($status, ['PENDING', 'APPROVED', 'REJECTED'], true)) {
    $where[] = "v.status = :status";
    $params[':status'] = $status;
}

if ($search !== '') {
    $where[] = "(mi.item_name LIKE :search
                 OR o.reference_number LIKE :search2
                 OR v.reason LIKE :search3
                 OR CONCAT(ru.first_name, ' ', ru.last_name) LIKE :search4)";
    $params[':search']  = "%$search%";
    $params[':search2'] = "%$search%";
    $params[':search3'] = "%$search%";
    $params[':search4'] = "%$search%";
}

if ($dateFrom && preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateFrom)) {
    $where[] = "DATE(v.created_at) >= :date_from";
    $params[':date_from'] = $dateFrom;
}
if ($dateTo && preg_match('/^\d{4}-\d{2}-\d{2}$/', $dateTo)) {
    $where[] = "DATE(v.created_at) <= :date_to";
    $params[':date_to'] = $dateTo;
}

$whereClause = count($where) ? 'WHERE ' . implode(' AND ', $where) : '';

try {
    // ---------- SUMMARY STATS (respect filters, ignore paging) ----------
    $statsStmt = $pdo->prepare("
        SELECT
            COUNT(*) AS total_items,
            COALESCE(SUM(vi.quantity * oi.price), 0) AS total_voided_value,
            COUNT(DISTINCT v.void_id) AS total_requests,
            SUM(CASE WHEN v.status = 'PENDING' THEN 1 ELSE 0 END) AS pending_requests,
            SUM(CASE WHEN v.status = 'APPROVED' THEN vi.quantity ELSE 0 END) AS approved_qty,
            SUM(CASE WHEN v.status = 'PENDING' THEN vi.quantity ELSE 0 END) AS pending_qty
        FROM voids v
        JOIN void_items vi ON vi.void_id = v.void_id AND vi.is_deleted = 0
        JOIN order_items oi ON oi.order_item_id = vi.order_item_id
        JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
        JOIN orders o ON o.order_id = v.order_id
        JOIN users ru ON ru.user_id = v.requested_by
        LEFT JOIN users au ON au.user_id = v.approved_by
        $whereClause
    ");
    $statsStmt->execute($params);
    $stats = $statsStmt->fetch(PDO::FETCH_ASSOC);

    // ---------- ROWS ----------
    $sql = "
        SELECT
            vi.void_item_id,
            v.void_id,
            v.status,
            v.reason,
            v.created_at AS requested_at,
            v.approved_at,
            vi.quantity AS void_qty,
            oi.order_item_id,
            oi.price AS unit_price,
            (vi.quantity * oi.price) AS voided_amount,
            mi.item_name,
            o.order_id,
            o.reference_number,
            TRIM(CONCAT(COALESCE(ru.first_name,''), ' ', COALESCE(ru.last_name,''))) AS requested_by_name,
            TRIM(CONCAT(COALESCE(au.first_name,''), ' ', COALESCE(au.last_name,''))) AS approved_by_name,
            r.role_name AS requester_role
        FROM voids v
        JOIN void_items vi ON vi.void_id = v.void_id AND vi.is_deleted = 0
        JOIN order_items oi ON oi.order_item_id = vi.order_item_id
        JOIN menu_items mi ON mi.menu_item_id = oi.menu_item_id
        JOIN orders o ON o.order_id = v.order_id
        JOIN users ru ON ru.user_id = v.requested_by
        JOIN roles r ON r.role_id = ru.role_id
        LEFT JOIN users au ON au.user_id = v.approved_by
        $whereClause
        ORDER BY v.created_at DESC, vi.void_item_id DESC
    ";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // ---------- CSV EXPORT ----------
    if ($isExport) {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="voids-report-' . date('Y-m-d') . '.csv"');
        $out = fopen('php://output', 'w');
        fputcsv($out, ['Void ID', 'Reference #', 'Item', 'Qty Voided', 'Unit Price', 'Voided Amount', 'Status', 'Reason', 'Requested By', 'Requested At', 'Approved By', 'Approved At']);
        foreach ($rows as $r) {
            fputcsv($out, [
                $r['void_id'],
                $r['reference_number'],
                $r['item_name'],
                $r['void_qty'],
                number_format((float)$r['unit_price'], 2),
                number_format((float)$r['voided_amount'], 2),
                $r['status'],
                $r['reason'],
                $r['requested_by_name'],
                $r['requested_at'],
                $r['approved_by_name'],
                $r['approved_at']
            ]);
        }
        fclose($out);
        exit;
    }

    // ---------- PAGINATE ----------
    $total = count($rows);
    $offset = ($page - 1) * $limit;
    $items = array_slice($rows, $offset, $limit);

    echo json_encode([
        'success' => true,
        'items' => $items,
        'stats' => [
            'total_items' => (int)$stats['total_items'],
            'total_voided_value' => (float)$stats['total_voided_value'],
            'total_requests' => (int)$stats['total_requests'],
            'pending_requests' => (int)$stats['pending_requests'],
            'approved_qty' => (int)$stats['approved_qty'],
            'pending_qty' => (int)$stats['pending_qty']
        ],
        'pagination' => [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => max(1, (int)ceil($total / $limit))
        ]
    ]);
} catch (Exception $e) {
    http_response_code(500);
    error_log($e->getMessage());
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}
