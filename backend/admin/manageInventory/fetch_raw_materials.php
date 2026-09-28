<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    // Added WHERE status = 'ACTIVE' to filter out soft-deleted items
    $stmt = $pdo->query("
        SELECT 
            raw_material_id, 
            raw_material_name, 
            description, 
            unit, 
            current_quantity, 
            reorder_level, 
            status, 
            is_perishable, 
            img_url
        FROM raw_materials
        WHERE status = 'ACTIVE'
        ORDER BY raw_material_name ASC
    ");

    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(['status' => 'success', 'data' => $materials]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
