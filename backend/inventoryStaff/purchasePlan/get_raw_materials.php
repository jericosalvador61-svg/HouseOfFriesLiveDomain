<?php
// backend/get_raw_materials.php
header("Content-Type: application/json");
require_once __DIR__ . '/../../db.php';

try {
    require_once __DIR__ . '/../../image_blob_helper.php';
    // 🛠️ FIX: Added cost_per_unit to the SELECT query string below
    // REQ-070+071 F7-LIVE-3: image_blob is a REQ-057 additive column that may
    // be absent on an unmigrated DB — mirror the admin
    // manageInventory/get_materials.php hasColumn() guard so this endpoint
    // never 500s when the column is missing.
    $hasImageBlob = false;
    try {
        $cols = $pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'raw_materials'")->fetchAll(PDO::FETCH_COLUMN);
        $hasImageBlob = in_array('image_blob', $cols, true);
    } catch (Throwable $e) { /* treat as un-migrated */ }
    $stmt = $pdo->query("SELECT raw_material_id, raw_material_name, current_quantity, reorder_level, unit, cost_per_unit, img_url, updated_at"
        . ($hasImageBlob ? ", image_blob" : "")
        . " FROM raw_materials");
    $materials = $stmt->fetchAll();

    // REQ-057: base64-encode image_blob so dropdowns/rows render data URIs.
    if ($hasImageBlob) {
        hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);
    }

    echo json_encode($materials);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Error fetching materials: " . $e->getMessage()]);
}
