<?php
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../log_activity_helper.php';

header("Content-Type: application/json");

// --- SECURE AUTHORIZATION CHECK ---
$auth = authenticate(['Admin']);
$admin_id = (int)$auth['user_id'];
$admin_username = $auth['username'] ?? 'Admin';
$admin_role = $auth['role'] ?? 'Admin';

// Retrieve raw request body input payload
$input = json_decode(file_get_contents("php://input"), true);
$stock_in_ids = $input['stock_in_ids'] ?? [];
$cost_updates = $input['cost_updates'] ?? [];

// REQ-056: optional cost-per-unit overrides {raw_material_id => new_cost}.
// Validate: must be a map of numeric positive values.
$cost_updates_clean = [];
if (is_array($cost_updates)) {
    foreach ($cost_updates as $mid => $cost) {
        $midVal = is_numeric($mid) ? (int)$mid : null;
        if ($midVal === null || $midVal <= 0) continue;
        $costVal = is_numeric($cost) ? (float)$cost : null;
        if ($costVal === null || $costVal <= 0) continue;
        $cost_updates_clean[$midVal] = $costVal;
    }
}

if (empty($stock_in_ids) || !is_array($stock_in_ids)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "No valid record selections received."]);
    exit;
}

try {
    $pdo->beginTransaction();

    $stmtGetItems = $pdo->prepare("SELECT raw_material_id, quantity FROM stock_in_items WHERE stock_in_id = ?");
    $stmtUpdateStock = $pdo->prepare("UPDATE raw_materials SET current_quantity = current_quantity + ? WHERE raw_material_id = ?");
    $stmtUpdateCost = $pdo->prepare("UPDATE raw_materials SET cost_per_unit = ? WHERE raw_material_id = ?");
    $stmtApproveMaster = $pdo->prepare("
        UPDATE stock_in 
        SET status = 'APPROVED', 
            approved_by = ?, 
            approved_at = NOW(), 
            approval_remarks = 'Batch approved via Admin Panel Dashboard Queue.' 
        WHERE stock_in_id = ? AND status = 'PENDING'
    ");

    $processedCount = 0;

    foreach ($stock_in_ids as $id) {
        $stmtApproveMaster->execute([$admin_id, $id]);

        if ($stmtApproveMaster->rowCount() > 0) {
            $processedCount++;

            $stmtGetItems->execute([$id]);
            $items = $stmtGetItems->fetchAll(PDO::FETCH_ASSOC);

            foreach ($items as $item) {
                $stmtUpdateStock->execute([$item['quantity'], $item['raw_material_id']]);

                // REQ-056: persist any unit-cost override provided by the approver
                // in the same transaction as the approval.
                if (isset($cost_updates_clean[$item['raw_material_id']])) {
                    $stmtUpdateCost->execute([$cost_updates_clean[$item['raw_material_id']], $item['raw_material_id']]);
                }
            }
        }
    }

    $pdo->commit();

    logActivity($pdo, $admin_id, $admin_username ?? 'Admin', $admin_role ?? 'Admin',
        'STOCK_IN_APPROVED', "Approved {$processedCount} stock-in record(s)",
        'stock_in', $processedCount > 0 ? $stock_in_ids[0] : null);

    echo json_encode([
        "success" => true,
        "message" => "Successfully processed and added inventory metrics for {$processedCount} records."
    ]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "Transaction Error: " . $e->getMessage()
    ]);
}