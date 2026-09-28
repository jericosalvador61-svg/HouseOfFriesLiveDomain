<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../auth_middleware.php';
header('Content-Type: application/json');

$id         = $_POST['raw_material_id'] ?? null;
$name       = $_POST['raw_material_name'] ?? null;
$desc       = $_POST['description'] ?? null;
$unit       = $_POST['unit'] ?? null;
$reorder    = $_POST['reorder_level'] ?? 0;
$cost       = $_POST['cost_per_unit'] ?? 0;
$imgUrl     = $_POST['img_url'] ?? '';

// CONVERSION: Map "Yes"/"No" to 1/0 for the database
$expTrack   = ($_POST['expiration_tracking'] === 'Yes') ? 1 : 0;
$perishable = ($_POST['is_perishable'] === 'Yes') ? 1 : 0;

if (!$id) {
    echo json_encode(['status' => 'error', 'message' => 'Material ID is missing']);
    exit;
}

try {
    $auth = authenticate(['Admin']);
    // Binary Image Upload Logic
    if (isset($_FILES['img_file']) && $_FILES['img_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['img_file'];
        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $newFileName = 'raw_' . $id . '_' . time() . '.' . $ext;

        // Use DOCUMENT_ROOT to match your working add_raw_material.php setup
        $targetDir = $_SERVER['DOCUMENT_ROOT'] . '/images/rawMaterials/';

        if (!is_dir($targetDir)) {
            mkdir($targetDir, 0755, true);
        }

        if (move_uploaded_file($file['tmp_name'], $targetDir . $newFileName)) {
            // Save matching web path format
            $imgUrl = 'images/rawMaterials/' . $newFileName;
        }
    }

    $sql = "UPDATE raw_materials 
            SET raw_material_name = ?, 
                description = ?, 
                unit = ?, 
                reorder_level = ?, 
                cost_per_unit = ?, 
                expiration_tracking = ?, 
                is_perishable = ?, 
                img_url = ?, 
                updated_at = NOW() 
            WHERE raw_material_id = ?";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        $name,
        $desc,
        $unit,
        $reorder,
        $cost,
        $expTrack,
        $perishable,
        $imgUrl,
        $id
    ]);

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'MATERIAL_UPDATE',
        "Updated {$name}",
        'raw_material', (int)$id);

    echo json_encode(['status' => 'success']);
} catch (Exception $e) {
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}