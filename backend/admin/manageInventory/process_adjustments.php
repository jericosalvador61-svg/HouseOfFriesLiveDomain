<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

try {
    $pdo->beginTransaction();

    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input || empty($input['items'])) {
        throw new Exception('No adjustment data received.');
    }

    $auth = authenticate(['Admin']);

    $adjType = strtoupper(trim($input['type']));
    $adjDate = $input['date'];
    $reason = $input['reason'];
    $items = $input['items'];

    $stmt = $pdo->prepare("INSERT INTO adjustments 
        (user_id, adjustment_type, reason, adjustment_date, status, approved_by, approved_at, approval_remarks, created_at) 
        VALUES (?, ?, ?, ?, 'APPROVED', ?, NOW(), 'Auto-approved via Admin Panel adjustment manager.', NOW())");
    $stmt->execute([$auth['user_id'], $adjType, $reason, $adjDate, $auth['user_id']]);

    $adjustmentId = $pdo->lastInsertId();

    $operator = ($adjType === 'ADD') ? "+" : "-";
    $updateStock = $pdo->prepare("UPDATE raw_materials 
        SET current_quantity = current_quantity $operator ?,
            updated_at = NOW() 
        WHERE raw_material_id = ?");

    foreach ($items as $item) {
        $materialId = $item['raw_material_id'];
        $qty = floatval($item['quantity']);

        $stmtItem = $pdo->prepare("INSERT INTO adjustment_items 
            (adjustment_id, raw_material_id, quantity, created_at) 
            VALUES (?, ?, ?, NOW())");
        $stmtItem->execute([$adjustmentId, $materialId, $qty]);

        if ($adjType === 'ADD') {
            $stmtSI = $pdo->prepare("INSERT INTO stock_in 
                (supplier_id, user_id, stock_in_date, remarks, status, created_at)
                VALUES (NULL, ?, ?, CONCAT('ADJUSTMENT #', ?), 'APPROVED', NOW())");
            $stmtSI->execute([$auth['user_id'], $adjDate, $adjustmentId]);
            $stockInId = $pdo->lastInsertId();

            $stmtSII = $pdo->prepare("INSERT INTO stock_in_items 
                (stock_in_id, raw_material_id, quantity, unit_cost, expiration_date, is_deleted)
                VALUES (?, ?, ?, 0, NULL, 0)");
            $stmtSII->execute([$stockInId, $materialId, $qty]);
        } else {
            hof_deduct_fifo($pdo, $materialId, $qty);
        }

        $updateStock->execute([$qty, $materialId]);
    }

    $pdo->commit();

    hof_check_low_stock($pdo, array_map(function ($i) { return $i['raw_material_id']; }, $items));

    // Compose description from all adjusted items
    $adjParts = [];
    foreach ($items as $item) {
        $matId = $item['raw_material_id'];
        $qty = floatval($item['quantity']);
        $matStmt = $pdo->prepare("SELECT raw_material_name FROM raw_materials WHERE raw_material_id = ?");
        $matStmt->execute([$matId]);
        $matName = $matStmt->fetchColumn();
        $adjParts[] = "{$matName} by {$qty}";
    }
    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'ADJUSTMENT', "Adjusted " . implode(', ', $adjParts),
        'raw_material', (int)$items[0]['raw_material_id']);

    echo json_encode([
        'status' => 'success',
        'message' => 'Inventory levels have been direct-adjusted successfully.'
    ]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    error_log('process_adjustments error: ' . $e->getMessage());
    echo json_encode([
        'status' => 'error',
        'message' => 'An unexpected database error occurred.'
    ]);
}