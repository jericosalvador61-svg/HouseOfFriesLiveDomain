<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    require_once __DIR__ . '/../../image_blob_helper.php';
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
            img_url,
            image_blob
        FROM raw_materials
        WHERE status = 'ACTIVE'
        ORDER BY raw_material_name ASC
    ");

    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // REQ-057: base64-encode image_blob so tables render data URIs.
    hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);

    echo json_encode(['status' => 'success', 'data' => $materials]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
