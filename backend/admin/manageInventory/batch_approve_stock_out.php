<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';

header("Content-Type: application/json");

$auth = authenticate(['Admin']);

$input = json_decode(file_get_contents("php://input"), true);
$stock_out_ids = $input['stock_out_ids'] ?? [];

if (empty($stock_out_ids) || !is_array($stock_out_ids)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "No valid record selections received."]);
    exit;
}

try {
    $pdo->beginTransaction();

    $stmtUpdateStock = $pdo->prepare("UPDATE raw_materials SET current_quantity = current_quantity - ? WHERE raw_material_id = ?");

    $stmtApproveMaster = $pdo->prepare("
        UPDATE stock_out 
        SET status = 'Approved', 
            approved_by = ?, 
            approved_at = NOW(), 
            approval_remarks = 'Batch approved via Admin Panel Stock Out Queue.' 
        WHERE stock_out_id = ? AND status = 'Pending'
    ");

    $stmtGetRowItems = $pdo->prepare("SELECT raw_material_id, quantity FROM stock_out_items WHERE stock_out_id = ? AND is_deleted = 0");

    // REQ-057: fill unit_cost snapshot on approve for rows created before the
    // unit_cost column existed (pending records may carry 0.00).
    $stmtUnitCost = $pdo->prepare("SELECT cost_per_unit FROM raw_materials WHERE raw_material_id = ?");
    $stmtUpdateUnitCost = $pdo->prepare("
        UPDATE stock_out_items SET unit_cost = ? 
        WHERE stock_out_id = ? AND raw_material_id = ? AND is_deleted = 0 AND (unit_cost = 0 OR unit_cost IS NULL)
    ");

    $processedCount = 0;
    $touchedMaterialIds = [];

    foreach ($stock_out_ids as $id) {
        $stmtApproveMaster->execute([$auth['user_id'], $id]);

        if ($stmtApproveMaster->rowCount() > 0) {
            $processedCount++;

            $stmtGetRowItems->execute([$id]);
            $items = $stmtGetRowItems->fetchAll(PDO::FETCH_ASSOC);

            foreach ($items as $item) {
                $materialId = $item['raw_material_id'];
                $qtyToDeduct = floatval($item['quantity']);

                hof_deduct_fifo($pdo, $materialId, $qtyToDeduct);

                $stmtUpdateStock->execute([$qtyToDeduct, $materialId]);

                // REQ-057: snapshot the current cost_per_unit when the stored
                // value is still 0 (legacy/pre-column records).
                $stmtUnitCost->execute([$materialId]);
                $unitCost = (float)$stmtUnitCost->fetchColumn();
                $stmtUpdateUnitCost->execute([$unitCost, $id, $materialId]);

                $touchedMaterialIds[] = $materialId;
            }
        }
    }

    $pdo->commit();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'STOCK_OUT_APPROVED', "Approved {$processedCount} stock-out record(s)",
        'stock_out', null, implode(',', $stock_out_ids), 'APPROVED');

    if (!empty($touchedMaterialIds)) {
        hof_check_low_stock($pdo, $touchedMaterialIds);
    }

    echo json_encode([
        "status" => "success",
        "message" => "Successfully processed and released stock allocations for {$processedCount} records."
    ]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    error_log('batch_approve_stock_out error: ' . $e->getMessage());
    echo json_encode([
        "status" => "error",
        "message" => "An unexpected database error occurred."
    ]);
}