<?php
require_once __DIR__ . '/../../db.php'; // PDO instance
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../auth_middleware.php';

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
    exit;
}

// REQ-057 RBAC: Admin + Supervisor manage raw materials (staff read-only).
$auth = authenticate(['Admin', 'Supervisor']);

$names = $_POST['raw_material_name'] ?? [];
$units = $_POST['unit'] ?? [];

if (!is_array($names) || count($names) === 0) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'No materials to add']);
    exit;
}

$descriptions      = $_POST['description'] ?? [];
$current_qtys      = $_POST['current_quantity'] ?? [];
$reorder_levels    = $_POST['reorder_level'] ?? [];
$costs             = $_POST['cost_per_unit'] ?? [];
$statuses          = $_POST['status'] ?? [];
$exp_trackings     = $_POST['expiration_tracking'] ?? [];
$is_perishables    = $_POST['is_perishable'] ?? [];
$img_urls          = $_POST['img_url'] ?? [];

$img_files         = $_FILES['img_file'] ?? null;

$img_blobs         = $_POST['image_blob'] ?? []; // REQ-057: base64 data-URI upload
$added = [];
$skipped = [];

try {
    $pdo->beginTransaction();

    $stmtCheck = $pdo->prepare("SELECT COUNT(*) FROM raw_materials WHERE raw_material_name = :name");
    $stmtInsert = $pdo->prepare("
        INSERT INTO raw_materials 
        (raw_material_name, description, unit, current_quantity, reorder_level, cost_per_unit, status, expiration_tracking, is_perishable, img_url, image_blob)
        VALUES
        (:name, :description, :unit, :current_qty, :reorder_level, :cost_per_unit, :status, :expiration_tracking, :is_perishable, :img_url, :image_blob)
    ");

    foreach ($names as $i => $name) {
        $name = trim($name);
        if ($name === '') continue;

        $stmtCheck->execute([':name' => $name]);
        if ($stmtCheck->fetchColumn() > 0) {
            $skipped[] = $name;
            continue;
        }

        $unit           = $units[$i] ?? '';
        $description    = $descriptions[$i] ?? '';
        $current_qty    = floatval($current_qtys[$i] ?? 0);
        $reorder_level  = floatval($reorder_levels[$i] ?? 0);
        $cost_per_unit  = floatval($costs[$i] ?? 0);
        $status         = $statuses[$i] ?? 'ACTIVE';

        // Correctly capture the checkbox/boolean values from JS
        $expiration_tracking = (isset($exp_trackings[$i]) && ($exp_trackings[$i] == 1 || $exp_trackings[$i] === 'Yes')) ? 1 : 0;
        $is_perishable       = (isset($is_perishables[$i]) && ($is_perishables[$i] == 1 || $is_perishables[$i] === 'Yes')) ? 1 : 0;

        $img_url = $img_urls[$i] ?? '';

        // FIX: Handle PHP's nested $_FILES array for batch uploads
        if ($img_files && isset($img_files['name'][$i]) && $img_files['error'][$i] === UPLOAD_ERR_OK) {
            $uploadDir = $_SERVER['DOCUMENT_ROOT'] . '/images/rawMaterials/';
            if (!is_dir($uploadDir)) mkdir($uploadDir, 0755, true);

            $ext = pathinfo($img_files['name'][$i], PATHINFO_EXTENSION);
            $filename = time() . '_' . $i . '_' . uniqid() . '.' . $ext;

            if (move_uploaded_file($img_files['tmp_name'][$i], $uploadDir . $filename)) {
                $img_url = 'images/rawMaterials/' . $filename;
            }
        }

        // REQ-057: BLOB image (base64 data URI) takes precedence over the paste-URL field.
        $image_blob = null;
        if (isset($img_blobs[$i]) && is_string($img_blobs[$i]) && trim($img_blobs[$i]) !== '') {
            $b64 = $img_blobs[$i];
            if (strpos($b64, 'base64,') !== false) {
                $b64 = substr($b64, strpos($b64, 'base64,') + 7);
            }
            $decoded = base64_decode($b64, true);
            if ($decoded !== false && $decoded !== '') {
                $image_blob = $decoded;
            }
        }

        $stmtInsert->execute([
            ':name' => $name,
            ':description' => $description,
            ':unit' => $unit,
            ':current_qty' => $current_qty,
            ':reorder_level' => $reorder_level,
            ':cost_per_unit' => $cost_per_unit,
            ':status' => $status,
            ':expiration_tracking' => $expiration_tracking,
            ':is_perishable' => $is_perishable,
            ':img_url' => $img_url,

            ':image_blob' => $image_blob
        ]);

        $added[] = $name;
    }

    $pdo->commit();

    $addedNames = implode(', ', $added);
    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'MATERIAL_ADD',
        "Added {$addedNames}",
        'raw_material', $pdo->lastInsertId());

    $msg = "Successfully added " . count($added) . " item(s).";
    if (count($skipped) > 0) {
        $msg .= " (" . count($skipped) . " duplicates skipped).";
    }

    echo json_encode(['status' => 'success', 'message' => $msg]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => "Database Error: " . $e->getMessage()]);
}