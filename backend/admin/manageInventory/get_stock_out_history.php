<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);
header('Content-Type: application/json');

try {
    // REQ-057 pagination: 10 rows/page, server-side LIMIT/OFFSET.
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = 10;
    $offset = ($page - 1) * $limit;

    $countStmt = $pdo->query("
        SELECT COUNT(*) FROM stock_out so
        INNER JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
        INNER JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
        WHERE soi.is_deleted = 0
    ");
    $total = (int)$countStmt->fetchColumn();

    // We combine first_name and last_name since full_name doesn't exist
    // We also use a LEFT JOIN for users in case a user was deleted but the record remains
    // REQ-057: include soi.unit_cost snapshot for gross-profit reporting.
    $query = "
        SELECT 
            so.stock_out_id,
            so.stock_out_date,
            so.remarks,
            so.status,
            rm.raw_material_name,
            soi.quantity,
            soi.unit_cost,
            rm.unit,
            CONCAT(u.first_name, ' ', u.last_name) as processor_name
        FROM stock_out so
        INNER JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
        INNER JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
        LEFT JOIN users u ON so.user_id = u.user_id
        WHERE soi.is_deleted = 0
        ORDER BY so.created_at DESC
        LIMIT :limit OFFSET :offset
    ";

    $stmt = $pdo->prepare($query);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // If the name comes back as null (e.g. user_id was 0 or null), default to 'System/Admin'
    foreach ($history as &$row) {
        if (empty(trim($row['processor_name']))) {
            $row['processor_name'] = 'Admin';
        }
    }

    echo json_encode([
        'status' => 'success',
        'data' => $history,
        'pagination' => [
            'total' => $total,
            'page' => $page,
            'per_page' => $limit,
            'total_pages' => (int)ceil($total / $limit)
        ]
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
