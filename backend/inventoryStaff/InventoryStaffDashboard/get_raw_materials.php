<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../inventory_helpers.php";
require_once __DIR__ . "/../../auth_middleware.php";

$auth = authenticate(['Inventory Staff', 'Kitchen Staff', 'Supervisor', 'Admin']);

try {
    require_once __DIR__ . '/../../image_blob_helper.php';
    $stmt = $pdo->query("SELECT raw_material_id, raw_material_name, current_quantity, unit, cost_per_unit, img_url, image_blob FROM raw_materials WHERE status='Active'");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);
    foreach ($materials as &$mat) {
        $mat['available_batch_sum'] = hof_check_batch_total($pdo, (int)$mat['raw_material_id']);
    }
    unset($mat);
    hof_encode_blob_columns($materials, ['image_blob' => 'image_blob']);
    echo json_encode($materials);
} catch (Exception $e) {
    echo json_encode([]);
}