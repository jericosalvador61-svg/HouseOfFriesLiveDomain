<?php
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../image_blob_helper.php';
header('Content-Type: application/json');

try {
    // REQ-070+071 F7-LIVE-3: image_blob is a REQ-057 additive column that may
    // be absent on an unmigrated DB — mirror the admin
    // manageInventory/get_materials.php hasColumn() guard so this endpoint
    // never 500s when the column is missing.
    $hasImageBlob = false;
    try {
        $cols = $pdo->query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'raw_materials'")->fetchAll(PDO::FETCH_COLUMN);
        $hasImageBlob = in_array('image_blob', $cols, true);
    } catch (Throwable $e) { /* treat as un-migrated */ }

    $stmt = $pdo->query("
        SELECT raw_material_id, raw_material_name, description, unit,
                current_quantity, reorder_level, status, is_perishable, img_url, updated_at"
                . ($hasImageBlob ? ", image_blob" : "") . "
        FROM raw_materials
        ORDER BY raw_material_name ASC
    ");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($materials as &$mat) {
        $mat['available_batch_sum'] = hof_check_batch_total($pdo, (int)$mat['raw_material_id']);
    }
    unset($mat);

    // REQ-057: base64-encode image_blob so the dropdown/cards render data URIs.
    if ($hasImageBlob) {
        hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);
    }

    echo json_encode([
        'status' => 'success',
        'data' => $materials
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    error_log('get_materials error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}
