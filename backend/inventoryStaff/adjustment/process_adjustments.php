<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../secret.php';

try {
    $auth = authenticate(['Admin', 'Inventory Staff', 'Supervisor']);
    $userId = (int)$auth['user_id'];
    $username = $auth['username'] ?? 'unknown';
    $role = $auth['role'] ?? '';

    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input || empty($input['items'])) {
        throw new Exception('No adjustment data received.');
    }

    $pdo->beginTransaction();

    $adjType = $input['type'];
    $adjDate = $input['date'];
    $reason = $input['reason'];
    $items = $input['items'];

    $stmt = $pdo->prepare("INSERT INTO adjustments 
        (user_id, adjustment_type, reason, adjustment_date, status, created_at) 
        VALUES (?, ?, ?, ?, 'PENDING', NOW())");
    $stmt->execute([$userId, $adjType, $reason, $adjDate]);

    $adjustmentId = $pdo->lastInsertId();

    foreach ($items as $item) {
        $materialId = $item['raw_material_id'];
        $qty = floatval($item['quantity']);

        $stmtItem = $pdo->prepare("INSERT INTO adjustment_items 
            (adjustment_id, raw_material_id, quantity, created_at) 
            VALUES (?, ?, ?, NOW())");
        $stmtItem->execute([$adjustmentId, $materialId, $qty]);

        if (strtoupper(trim($adjType)) === 'ADD') {
            $stmtSI = $pdo->prepare("INSERT INTO stock_in 
                (supplier_id, user_id, stock_in_date, remarks, status, created_at)
                VALUES (NULL, ?, ?, CONCAT('ADJUSTMENT #', ?), 'Approved', NOW())");
            $stmtSI->execute([$userId, $adjDate, $adjustmentId]);
            $stockInId = $pdo->lastInsertId();

            $stmtSII = $pdo->prepare("INSERT INTO stock_in_items 
                (stock_in_id, raw_material_id, quantity, unit_cost, expiration_date, is_deleted)
                VALUES (?, ?, ?, 0, NULL, 0)");
            $stmtSII->execute([$stockInId, $materialId, $qty]);
        }
    }

    $pdo->commit();

    logActivity($pdo, $userId, $username, $role, 'ADJUSTMENT',
        "Inventory adjustment #{$adjustmentId} (" . strtoupper($adjType) . ") created",
        'adjustment', (int)$adjustmentId, null, 'PENDING');

    hof_notify_roles($pdo, 'pending_approval', 'Adjustment Approval Needed',
        "Inventory adjustment #$adjustmentId (" . strtoupper($adjType) . ") is awaiting your approval.",
        ['Supervisor'], '/public/supervisor/supervisor_approvals.html');

    echo json_encode([
        'status' => 'success',
        'success' => true,
        'message' => 'Adjustment logged and waiting for admin approval.'
    ]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('process_adjustments error: ' . $e->getMessage());
    echo json_encode([
        'status' => 'error',
        'success' => false,
        'message' => 'An unexpected database error occurred.'
    ]);
}