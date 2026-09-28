<?php
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    // We combine first_name and last_name since full_name doesn't exist
    // We also use a LEFT JOIN for users in case a user was deleted but the record remains
    $query = "
        SELECT 
            so.stock_out_id,
            so.stock_out_date,
            so.remarks,
            so.status,
            rm.raw_material_name,
            soi.quantity,
            rm.unit,
            CONCAT(u.first_name, ' ', u.last_name) as processor_name
        FROM stock_out so
        INNER JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
        INNER JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
        LEFT JOIN users u ON so.user_id = u.user_id
        WHERE soi.is_deleted = 0
        ORDER BY so.created_at DESC
    ";

    $stmt = $pdo->query($query);
    $history = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // If the name comes back as null (e.g. user_id was 0 or null), default to 'System/Admin'
    foreach ($history as &$row) {
        if (empty(trim($row['processor_name']))) {
            $row['processor_name'] = 'Admin';
        }
    }

    echo json_encode(['status' => 'success', 'data' => $history]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
