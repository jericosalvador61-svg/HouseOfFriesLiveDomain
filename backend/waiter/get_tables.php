<?php
/**
 * ============================================================
 * backend/waiter/get_tables.php - Tables for the waiter module
 * ------------------------------------------------------------
 * Query params (all optional):
 *   status      = AVAILABLE | OCCUPIED | MAINTENANCE | all
 *   table_type  = DINE_IN | TAKEOUT | all
 *   search      = substring match on table_number (LIKE)
 *   page        = 1-based page number (default 1)
 *   limit       = records per page (default 9, capped at 100)
 *
 * Response: { success, tables: [{ id, table_id, table_number, table_type,
 *                                 status, updated_at }],
 *             pagination: { page, limit, total, total_pages },
 *             stats: { total, available, occupied, maintenance } }
 * ============================================================
 */
header('Content-Type: application/json');

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../db.php';

authenticate(['Waiter', 'Admin', 'Supervisor']);

$validStatuses = ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE'];
$validTypes    = ['DINE_IN', 'TAKEOUT'];

$status = strtoupper(trim((string)($_GET['status'] ?? 'all')));
$type   = strtoupper(trim((string)($_GET['table_type'] ?? 'all')));
$search = trim((string)($_GET['search'] ?? ''));
$page   = max(1, (int)($_GET['page'] ?? 1));
$limit  = max(1, min(100, (int)($_GET['limit'] ?? 9)));
$offset = ($page - 1) * $limit;

$where  = ['t.is_deleted = 0'];
$params = [];

if (in_array($status, $validStatuses, true)) {
    $where[]  = 't.status = :status';
    $params[':status'] = $status;
}
if (in_array($type, $validTypes, true)) {
    $where[]  = 't.table_type = :type';
    $params[':type'] = $type;
}
if ($search !== '') {
    $where[]  = 't.table_number LIKE :search';
    $params[':search'] = '%' . $search . '%';
}

$whereSQL = implode(' AND ', $where);

try {
    // Accurate overall stats across ALL matching rows (not just the current page).
    $statsSQL = "SELECT COUNT(*) AS total,
                        SUM(CASE WHEN t.status = 'AVAILABLE'    THEN 1 ELSE 0 END) AS available,
                        SUM(CASE WHEN t.status = 'OCCUPIED'     THEN 1 ELSE 0 END) AS occupied,
                        SUM(CASE WHEN t.status = 'MAINTENANCE'  THEN 1 ELSE 0 END) AS maintenance
                 FROM restaurant_table t
                 WHERE " . $whereSQL;
    $statsStmt = $pdo->prepare($statsSQL);
    $statsStmt->execute($params);
    $statsRow = $statsStmt->fetch(PDO::FETCH_ASSOC);

    $countSQL = "SELECT COUNT(*) AS total FROM restaurant_table t WHERE " . $whereSQL;
    $countStmt = $pdo->prepare($countSQL);
    $countStmt->execute($params);
    $total = (int)($countStmt->fetch()['total'] ?? 0);
    $totalPages = max(1, (int)ceil($total / $limit));

    $sql = "SELECT t.table_id AS id,
                   t.table_id,
                   t.table_number,
                   t.table_type,
                   t.status,
                   t.updated_at
            FROM restaurant_table t
            WHERE " . $whereSQL . "
            ORDER BY t.table_type ASC, CAST(t.table_number AS UNSIGNED), t.table_number
            LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);
    foreach ($params as $k => $v) {
        $stmt->bindValue($k, $v);
    }
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $tables = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($tables as &$t) {
        $t['table_id'] = (int)$t['table_id'];
    }
    unset($t);

    echo json_encode([
        'success'    => true,
        'tables'     => $tables,
        'pagination' => [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => $totalPages
        ],
        'stats'      => [
            'total'       => (int)($statsRow['total'] ?? 0),
            'available'   => (int)($statsRow['available'] ?? 0),
            'occupied'    => (int)($statsRow['occupied'] ?? 0),
            'maintenance' => (int)($statsRow['maintenance'] ?? 0)
        ]
    ]);
} catch (PDOException $e) {
    error_log('get_tables error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load tables.']);
}
