<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method Not Allowed. Use POST request.']);
    exit;
}

$auth = authenticate(['Admin']);

$current_time = date('Y-m-d H:i:s');

$inputData = json_decode(file_get_contents('php://input'), true);

if (!isset($inputData['spoilage_ids']) || !is_array($inputData['spoilage_ids']) || empty($inputData['spoilage_ids'])) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Invalid processing payload. No records checked.']);
    exit;
}

$spoilage_ids = array_map('intval', $inputData['spoilage_ids']);

try {
    $pdo->beginTransaction();

    $fetchStmt = $pdo->prepare("SELECT raw_material_id, quantity_lost FROM spoilage WHERE spoilage_id = ? AND status = 'Pending' FOR UPDATE");
    $updateInventoryStmt = $pdo->prepare("UPDATE raw_materials SET current_quantity = current_quantity - ?, updated_at = NOW() WHERE raw_material_id = ?");

    $approveStmt = $pdo->prepare("
        UPDATE spoilage 
        SET 
            status = 'Approved', 
            approved_by = ?, 
            approved_at = ?, 
            approval_remarks = 'Batch approved via administration control board dashboard panels.' 
        WHERE spoilage_id = ? AND status = 'Pending'
    ");

    $processedCount = 0;
    $touchedMaterialIds = [];

    foreach ($spoilage_ids as $id) {
        $fetchStmt->execute([$id]);
        $spoilageItem = $fetchStmt->fetch(PDO::FETCH_ASSOC);

        if ($spoilageItem) {
            $material_id = $spoilageItem['raw_material_id'];
            $qty_lost = floatval($spoilageItem['quantity_lost']);

            hof_deduct_fifo($pdo, $material_id, $qty_lost);

            $updateInventoryStmt->execute([$qty_lost, $material_id]);
            $touchedMaterialIds[] = $material_id;
            $approveStmt->execute([$auth['user_id'], $current_time, $id]);

            $processedCount++;
        }
    }

    if ($processedCount > 0) {
        $pdo->commit();

        logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
            'SPOILAGE_APPROVED', "Approved {$processedCount} spoilage record(s)",
            'spoilage');

        if (!empty($touchedMaterialIds)) {
            hof_check_low_stock($pdo, $touchedMaterialIds);
        }

        echo json_encode([
            'status' => 'success',
            'message' => "Successfully verified, approved, and tracked balance updates for {$processedCount} checked record(s)."
        ]);
    } else {
        $pdo->rollBack();
        echo json_encode([
            'status' => 'error',
            'message' => 'Selected records could not be verified or are already finalized.'
        ]);
    }
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }

    http_response_code(500);
    error_log('batch_approve_spoilage error: ' . $e->getMessage());
    echo json_encode([
        'status' => 'error',
        'message' => 'An unexpected database error occurred.'
    ]);
}