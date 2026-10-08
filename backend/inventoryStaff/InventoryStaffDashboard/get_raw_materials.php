<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../inventory_helpers.php";
require_once __DIR__ . "/../../auth_middleware.php";

$auth = authenticate(['Inventory Staff', 'Kitchen Staff', 'Supervisor', 'Admin']);

try {
    require_once __DIR__ . '/../../image_blob_helper.php';
    // REQ-070+071 F7-LIVE-3: image_blob is a REQ-057 additive column that may
    // be absent on an unmigrated DB — mirror the admin
    // manageInventory/get_materials.php hasColumn() guard so this endpoint
    // never 500s when the column is missing.
    $hasImageBlob = false;
    try {
        $cols = $pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'raw_materials'")->fetchAll(PDO::FETCH_COLUMN);
        $hasImageBlob = in_array('image_blob', $cols, true);
    } catch (Throwable $e) { /* treat as un-migrated */ }
    $stmt = $pdo->query("SELECT raw_material_id, raw_material_name, current_quantity, unit, cost_per_unit, img_url"
        . ($hasImageBlob ? ", image_blob" : "")
        . " FROM raw_materials WHERE status='Active'");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($materials as &$mat) {
        $mat['available_batch_sum'] = hof_check_batch_total($pdo, (int)$mat['raw_material_id']);
    }
    unset($mat);
    if ($hasImageBlob) {
        hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);
    }
    echo json_encode($materials);
} catch (Exception $e) {
    echo json_encode([]);
}