<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

$auth = authenticate(['Admin', 'Inventory Staff']);
$userId = (int)$auth['user_id'];
$username = $auth['username'] ?? 'unknown';
$role = $auth['role'] ?? '';

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
    // Binary Image Upload Logic
    if (isset($_FILES['img_file']) && $_FILES['img_file']['error'] === UPLOAD_ERR_OK) {
        $file = $_FILES['img_file'];
        $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
        $newFileName = 'raw_' . $id . '_' . time() . '.' . $ext;

        $baseDir = realpath(__DIR__ . '/../../../');
        $targetDir = $baseDir . DIRECTORY_SEPARATOR . 'images' . DIRECTORY_SEPARATOR . 'inventory' . DIRECTORY_SEPARATOR;

        if (!is_dir($targetDir)) mkdir($targetDir, 0777, true);

        if (move_uploaded_file($file['tmp_name'], $targetDir . $newFileName)) {
            $imgUrl = 'images/inventory/' . $newFileName;
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

    logActivity($pdo, $userId, $username, $role, 'MATERIAL_UPDATE',
        "Updated raw material ID {$id}",
        'raw_material', (int)$id, (string)$id, 'Active');

    echo json_encode(['status' => 'success']);
} catch (Exception $e) {
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
