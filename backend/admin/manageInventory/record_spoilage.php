<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['status' => 'error', 'message' => 'Invalid request method.']);
    exit;
}

$auth = authenticate(['Admin']);

$spoilage_date = $_POST['spoilage_date'] ?? date('Y-m-d');
$general_remarks = $_POST['remarks'] ?? '';
$ref_number = 'REF-' . strtoupper(uniqid());

// REQ-057: required proof photo (SPOILAGE/WASTE/DAMAGE) stored as BLOB.
// Client sends a compressed JPEG data-URI (no scheme prefix) via FormData.
$photo_raw = '';
if (!empty($_POST['photo']) && is_string($_POST['photo'])) {
    $photo = $_POST['photo'];
    if (strpos($photo, 'base64,') !== false) {
        $photo = substr($photo, strpos($photo, 'base64,') + 7);
    }
    $decoded = base64_decode($photo, true);
    if ($decoded !== false) {
        $photo_raw = $decoded;
    }
}

try {
    $pdo->beginTransaction();

    if (!isset($_POST['material_id']) || !is_array($_POST['material_id'])) {
        throw new Exception("No valid spoilage entry lines received.");
    }

    foreach ($_POST['material_id'] as $index => $material_id) {
        $qty = (float) ($_POST['quantity'][$index] ?? 0);
        $type = $_POST['type'][$index];
        $source = $_POST['source'][$index];

        $stmt = $pdo->prepare("
            INSERT INTO spoilage (
                user_id, raw_material_id, spoilage_type, quantity_lost, 
                source, status, approved_by, approved_at, 
                reference_number, remarks, spoilage_date, photo
            ) VALUES (?, ?, ?, ?, ?, 'APPROVED', ?, NOW(), ?, ?, ?, ?)
        ");
        $stmt->execute([
            $auth['user_id'],
            $material_id,
            $type,
            $qty,
            $source,
            $auth['user_id'],
            $ref_number,
            $general_remarks,
            $spoilage_date,
            $photo_raw !== '' ? $photo_raw : null
        ]);

        if ($source === 'RAW') {
            hof_deduct_fifo($pdo, (int)$material_id, $qty);

            $updateStock = $pdo->prepare("
                UPDATE raw_materials 
                SET current_quantity = current_quantity - ?,
                    updated_at = NOW()
                WHERE raw_material_id = ?
            ");
            $updateStock->execute([$qty, $material_id]);

            $check = $pdo->prepare("SELECT raw_material_name, current_quantity FROM raw_materials WHERE raw_material_id = ?");
            $check->execute([$material_id]);
            $item = $check->fetch();

            if ($item['current_quantity'] < 0) {
                throw new Exception("Insufficient stock for " . $item['raw_material_name']);
            }
        }
    }

    $pdo->commit();

    hof_check_low_stock($pdo, array_map('intval', $_POST['material_id']));

    $spParts = [];
    foreach ($_POST['material_id'] as $i => $mid) {
        $qty = (float)($_POST['quantity'][$i] ?? 0);
        $mnStmt = $pdo->prepare("SELECT raw_material_name FROM raw_materials WHERE raw_material_id = ?");
        $mnStmt->execute([$mid]);
        $mName = $mnStmt->fetchColumn();
        $spParts[] = "{$mName} x{$qty}";
    }
    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'SPOILAGE', "Spoilage: " . implode(', ', $spParts) . ($photo_raw !== '' ? ' (photo attached)' : ''),
        'raw_material', (int)$_POST['material_id'][0]);

    echo json_encode(['status' => 'success', 'message' => 'Spoilage recorded and stock updated successfully.']);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('record_spoilage error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}