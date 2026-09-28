<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method Not Allowed.']);
    exit;
}

$auth = authenticate(['Admin']);

$current_time = date('Y-m-d H:i:s');
$inputData = json_decode(file_get_contents('php://input'), true);

if (!isset($inputData['return_ids']) || !is_array($inputData['return_ids']) || empty($inputData['return_ids'])) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'No return IDs provided.']);
    exit;
}

$return_ids = array_map('intval', $inputData['return_ids']);

try {
    $pdo->beginTransaction();

    $fetchStmt = $pdo->prepare("SELECT return_id, raw_material_id, quantity, unit_cost FROM return_items WHERE return_id = ? AND is_deleted = 0");
    $updateInventoryStmt = $pdo->prepare("UPDATE raw_materials SET current_quantity = current_quantity + ?, updated_at = NOW() WHERE raw_material_id = ?");
    $approveStmt = $pdo->prepare("
        UPDATE returns 
        SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = NOW()
        WHERE return_id = ? AND status = 'PENDING'
    ");

    $processedCount = 0;
    $touchedMaterialIds = [];

    foreach ($return_ids as $id) {
        $fetchStmt->execute([$id]);
        $items = $fetchStmt->fetchAll(PDO::FETCH_ASSOC);

        if (!empty($items)) {
            $stmtSI = $pdo->prepare("INSERT INTO stock_in
                (supplier_id, user_id, stock_in_date, total_cost, remarks, status, approved_by, created_at)
                VALUES (NULL, ?, CURDATE(), 0, CONCAT('RETURN #', ?), 'APPROVED', ?, NOW())");
            $stmtSI->execute([$auth['user_id'], $id, $auth['user_id']]);
            $stockInId = $pdo->lastInsertId();

            $stmtSII = $pdo->prepare("INSERT INTO stock_in_items
                (stock_in_id, raw_material_id, quantity, unit_cost, expiration_date, is_deleted)
                VALUES (?, ?, ?, ?, NULL, 0)");

            foreach ($items as $item) {
                $updateInventoryStmt->execute([$item['quantity'], $item['raw_material_id']]);
                $touchedMaterialIds[] = $item['raw_material_id'];

                $stmtSII->execute([$stockInId, $item['raw_material_id'], $item['quantity'], $item['unit_cost'] ?? 0]);
            }
            $approveStmt->execute([$auth['user_id'], $current_time, $id]);
            $processedCount++;
        }
    }

    if ($processedCount > 0) {
        $pdo->commit();

        logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
            'RETURN_APPROVED', "Approved {$processedCount} return(s)",
            'return');

        if (!empty($touchedMaterialIds)) {
            hof_check_low_stock($pdo, array_unique($touchedMaterialIds));
        }
        echo json_encode([
            'status' => 'success',
            'message' => "Successfully approved {$processedCount} return(s) and updated stock."
        ]);
    } else {
        $pdo->rollBack();
        echo json_encode([
            'status' => 'error',
            'message' => 'No pending returns could be approved.'
        ]);
    }
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) $pdo->rollBack();
    http_response_code(500);
    error_log('batch_approve_returns error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}