<?php
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . '/../../auth_middleware.php';

$auth = authenticate(['Admin', 'Supervisor']);

try {
    $search  = trim((string)($_GET['search'] ?? ''));
    $type    = trim((string)($_GET['type'] ?? ''));
    $status  = trim((string)($_GET['status'] ?? ''));
    $deleted = trim((string)($_GET['deleted'] ?? '0'));
    $page    = max(1, (int)($_GET['page'] ?? 1));
    $limit   = max(1, min(100, (int)($_GET['limit'] ?? 9))); // Default to 9 records per page
    $offset  = ($page - 1) * $limit;

    $where = [];
    $params = [];

    if ($deleted === 'all') {
        // No filter on is_deleted
    } elseif ($deleted === '1') {
        $where[] = 'is_deleted = 1';
    } else {
        $where[] = 'is_deleted = 0';
    }

    if ($type !== '' && in_array($type, ['DINE_IN', 'TAKEOUT'], true)) {
        $where[] = 'table_type = :type';
        $params[':type'] = $type;
    }

    if ($status !== '' && in_array($status, ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE'], true)) {
        $where[] = 'status = :status';
        $params[':status'] = $status;
    }

    if ($search !== '') {
        $where[] = 'table_number LIKE :search';
        $params[':search'] = '%' . $search . '%';
    }

    $whereSQL = count($where) > 0 ? 'WHERE ' . implode(' AND ', $where) : '';

    $countSQL = "SELECT COUNT(*) as total FROM restaurant_table $whereSQL";
    $countStmt = $pdo->prepare($countSQL);
    $countStmt->execute($params);
    $total = (int)($countStmt->fetch()['total'] ?? 0);

    $dataSQL = "SELECT table_id, table_number, table_type, status, qr_code, is_deleted, deleted_at
                FROM restaurant_table $whereSQL
                ORDER BY CAST(REGEXP_REPLACE(table_number, '[^0-9]', '') AS UNSIGNED) ASC, table_number ASC, table_id ASC
                LIMIT :limit OFFSET :offset";
    $dataStmt = $pdo->prepare($dataSQL);
    foreach ($params as $k => $v) {
        $dataStmt->bindValue($k, $v);
    }
    $dataStmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $dataStmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $dataStmt->execute();
    $rows = $dataStmt->fetchAll(PDO::FETCH_ASSOC);

    // Compute next suggested DINE_IN table number across all records (including soft-deleted)
    // to guarantee no collision with existing active or deleted tables
    $nextSQL = "SELECT MAX(CAST(REGEXP_REPLACE(table_number, '[^0-9]', '') AS UNSIGNED)) as max_num
                FROM restaurant_table WHERE table_type = 'DINE_IN'";
    $nextStmt = $pdo->query($nextSQL);
    $maxNum = (int)($nextStmt->fetch()['max_num'] ?? 0);
    $next_table_number = $maxNum + 1;

    // Accurate overall stats for active tables so pagination does not distort counts
    $statsSQL = "SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
                    SUM(CASE WHEN status = 'OCCUPIED' THEN 1 ELSE 0 END) as occupied,
                    SUM(CASE WHEN status = 'MAINTENANCE' THEN 1 ELSE 0 END) as maintenance
                 FROM restaurant_table WHERE is_deleted = 0";
    $statsStmt = $pdo->query($statsSQL);
    $statsRow = $statsStmt ? $statsStmt->fetch(PDO::FETCH_ASSOC) : [];

    echo json_encode([
        'success' => true,
        'data' => $rows,
        'total' => $total,
        'page' => $page,
        'limit' => $limit,
        'next_table_number' => $next_table_number,
        'stats' => [
            'total' => (int)($statsRow['total'] ?? 0),
            'available' => (int)($statsRow['available'] ?? 0),
            'occupied' => (int)($statsRow['occupied'] ?? 0),
            'maintenance' => (int)($statsRow['maintenance'] ?? 0)
        ]
    ]);
} catch (PDOException $e) {
    error_log('fetch_tables.php PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database error occurred while fetching tables']);
} catch (\Throwable $e) {
    error_log('fetch_tables.php fatal error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'An unexpected server error occurred']);
}
