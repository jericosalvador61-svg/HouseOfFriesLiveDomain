<?php
// backend/get_raw_materials.php
header("Content-Type: application/json");
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
$user = authenticate(['Admin', 'Supervisor']);

try {
    require_once __DIR__ . '/../../image_blob_helper.php';
    // 🛠️ FIX: Added cost_per_unit to the SELECT query string below
    $stmt = $pdo->query("SELECT raw_material_id, raw_material_name, current_quantity, reorder_level, unit, cost_per_unit, img_url, image_blob, updated_at FROM raw_materials");
    $materials = $stmt->fetchAll();

    // REQ-057: base64-encode image_blob so dropdowns/rows render data URIs.
    hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);

    echo json_encode($materials);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Error fetching materials: " . $e->getMessage()]);
}
