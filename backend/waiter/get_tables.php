<?php
/**
 * ============================================================
 * backend/waiter/get_tables.php - Tables for the waiter module
 * ------------------------------------------------------------
 * Query params (all optional):
 *   status      = AVAILABLE | OCCUPIED | MAINTENANCE | all
 *   table_type  = DINE_IN | TAKEOUT | all
 *
 * Response: { success, tables: [{ id, table_id, table_number, table_type,
 *                                 status, updated_at }] }
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

$where  = ['t.is_deleted = 0'];
$params = [];

if (in_array($status, $validStatuses, true)) {
    $where[]  = 't.status = ?';
    $params[] = $status;
}
if (in_array($type, $validTypes, true)) {
    $where[]  = 't.table_type = ?';
    $params[] = $type;
}

try {
    $sql = "SELECT t.table_id AS id,
                   t.table_id,
                   t.table_number,
                   t.table_type,
                   t.status,
                   t.updated_at
            FROM restaurant_table t
            WHERE " . implode(' AND ', $where) . "
            ORDER BY t.table_type ASC, CAST(t.table_number AS UNSIGNED), t.table_number";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $tables = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($tables as &$t) {
        $t['table_id'] = (int)$t['table_id'];
    }
    unset($t);

    echo json_encode(['success' => true, 'tables' => $tables]);
} catch (PDOException $e) {
    error_log('get_tables error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load tables.']);
}
