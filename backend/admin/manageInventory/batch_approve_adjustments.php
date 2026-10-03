<?php
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header("Content-Type: application/json");

// --- SECURE AUTHORIZATION CHECK ---
$auth = authenticate(['Admin', 'Supervisor']);
$admin_id = (int)$auth['user_id'];
$admin_username = $auth['username'] ?? 'Admin';
$admin_role = $auth['role'] ?? 'Admin';

$input = json_decode(file_get_contents("php://input"), true);
$adjustment_ids = $input['adjustment_ids'] ?? [];

if (empty($adjustment_ids) || !is_array($adjustment_ids)) {
    echo json_encode(["status" => "error", "message" => "No valid record selections received."]);
    exit;
}

try {
    $pdo->beginTransaction();

    // 1. Prepare statements to dynamically change raw material stock levels
    $stmtAddStock = $pdo->prepare("UPDATE raw_materials SET current_quantity = current_quantity + ? WHERE raw_material_id = ?");
    $stmtSubtractStock = $pdo->prepare("UPDATE raw_materials SET current_quantity = current_quantity - ? WHERE raw_material_id = ?");

    // 2. Prepare master document status updating operations
    $stmtApproveMaster = $pdo->prepare("
        UPDATE adjustments 
        SET status = 'Approved', 
            approved_by = ?, 
            approved_at = NOW(), 
            approval_remarks = 'Batch approved via Admin Panel Adjustments Queue.' 
        WHERE adjustment_id = ? AND status = 'Pending'
    ");

    // 3. Query BOTH tables to get the master type alongside the raw material list breakdown
    $stmtGetDetails = $pdo->prepare("
        SELECT a.adjustment_type, ai.raw_material_id, ai.quantity 
        FROM adjustments a
        JOIN adjustment_items ai ON a.adjustment_id = ai.adjustment_id
        WHERE a.adjustment_id = ? AND ai.is_deleted = 0
    ");

    $processedCount = 0;
    $touchedMaterialIds = [];

    foreach ($adjustment_ids as $id) {
        $stmtGetDetails->execute([$id]);
        $items = $stmtGetDetails->fetchAll(PDO::FETCH_ASSOC);

        if (!empty($items)) {
            $stmtApproveMaster->execute([$admin_id, $id]);

            if ($stmtApproveMaster->rowCount() > 0) {
                $processedCount++;

                foreach ($items as $item) {
                    $materialId = $item['raw_material_id'];
                    $qty = floatval($item['quantity']);
                    $type = strtoupper(trim($item['adjustment_type']));

                    if ($type === 'ADD') {
                        $stmtAddStock->execute([$qty, $materialId]);
                    } else {
                        $stmtSubtractStock->execute([$qty, $materialId]);
                    }
                    $touchedMaterialIds[] = $materialId;
                }
            }
        }
    }

    $pdo->commit();

    logActivity($pdo, $admin_id, $admin_username ?? 'Admin', $admin_role ?? 'Admin',
        'ADJUSTMENT_APPROVED', "Approved {$processedCount} adjustment(s)",
        'adjustment', null, implode(',', $adjustment_ids), 'APPROVED');

    hof_check_low_stock($pdo, $touchedMaterialIds);

    echo json_encode([
        "status" => "success",
        "message" => "Successfully processed and compiled warehouse modifications for {$processedCount} adjustment records."
    ]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo json_encode([
        "status" => "error",
        "message" => "Transaction Error: " . $e->getMessage()
    ]);
}