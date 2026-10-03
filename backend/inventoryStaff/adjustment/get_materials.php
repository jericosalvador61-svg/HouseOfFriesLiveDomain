<?php
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    require_once __DIR__ . '/../../image_blob_helper.php';

    $stmt = $pdo->query("
        SELECT raw_material_id, raw_material_name, description, unit, 
               current_quantity, reorder_level, status, is_perishable, img_url, image_blob, updated_at
        FROM raw_materials
        ORDER BY raw_material_name ASC
    ");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($materials as &$mat) {
        $mat['available_batch_sum'] = hof_check_batch_total($pdo, (int)$mat['raw_material_id']);
    }
    unset($mat);

    // REQ-057: base64-encode image_blob so dropdowns render data URIs.
    hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);

    echo json_encode([
        'status' => 'success',
        'data' => $materials
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    error_log('get_materials error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}
