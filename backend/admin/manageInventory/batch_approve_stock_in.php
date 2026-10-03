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

if (empty($stock_in_ids) || !is_array($stock_in_ids)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "No valid record selections received."]);
    exit;
}

try {
    $pdo->beginTransaction();

    $stmtGetItems = $pdo->prepare("SELECT raw_material_id, quantity FROM stock_in_items WHERE stock_in_id = ?");
    $stmtUpdateStock = $pdo->prepare("UPDATE raw_materials SET current_quantity = current_quantity + ? WHERE raw_material_id = ?");
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
            }
        }
    }

    $pdo->commit();

    logActivity($pdo, $admin_id, $admin_username ?? 'Admin', $admin_role ?? 'Admin',
        'STOCK_IN_APPROVED', "Approved {$processedCount} stock-in record(s)",
        'stock_in', $processedCount > 0 ? $stock_in_ids[0] : null, implode(',', $stock_in_ids), 'APPROVED');

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