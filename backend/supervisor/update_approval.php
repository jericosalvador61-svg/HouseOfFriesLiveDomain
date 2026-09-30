<?php
/**
 * HOF Supervisor API - Update Approval Status
 * Approves or rejects inventory adjustments, returns, voids, stock_in, stock_out, spoilage
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';

$auth = authenticate(['Supervisor', 'Admin']);
$userId = $auth['user_id'];
$userName = $auth['username'] ?? 'Supervisor';
$userRole = $auth['role'] ?? 'Supervisor';
header('Content-Type: application/json');

$data = json_decode(file_get_contents('php://input'), true);
$type = $data['type'] ?? '';
$requestId = (int)($data['request_id'] ?? 0);
$newStatus = $data['status'] ?? '';

if (!$type || !$requestId || !in_array($newStatus, ['APPROVED', 'REJECTED'])) {
    echo json_encode(['success' => false, 'message' => 'Invalid parameters.']);
    exit;
}

try {
    switch ($type) {
        case 'inv':
            // Inventory adjustments
            if ($newStatus === 'APPROVED') {
                $pdo->beginTransaction();

                // Lock the parent row and verify it is still PENDING
                $lockStmt = $pdo->prepare("
                    SELECT adjustment_id FROM adjustments 
                    WHERE adjustment_id = ? AND status = 'PENDING' FOR UPDATE
                ");
                $lockStmt->execute([$requestId]);
                if (!$lockStmt->fetch()) {
                    $pdo->rollBack();
                    echo json_encode(['success' => false, 'message' => 'Request is not pending approval.']);
                    exit;
                }

                // Get ALL adjustment items (not just one)
                $adjStmt = $pdo->prepare("
                    SELECT ai.raw_material_id, ai.quantity, a.adjustment_type 
                    FROM adjustments a
                    JOIN adjustment_items ai ON a.adjustment_id = ai.adjustment_id
                    WHERE a.adjustment_id = ?
                ");
                $adjStmt->execute([$requestId]);
                $items = $adjStmt->fetchAll(); // fetchAll, not fetch

                foreach ($items as $adj) {
                    // Update raw material stock
                    $change = ($adj['adjustment_type'] === 'ADD' ? 1 : -1) * (float)$adj['quantity'];
                    $updStmt = $pdo->prepare("
                        UPDATE raw_materials 
                        SET current_quantity = GREATEST(current_quantity + ?, 0),
                            updated_at = NOW()
                        WHERE raw_material_id = ?
                    ");
                    $updStmt->execute([$change, $adj['raw_material_id']]);
                }

                $stmt = $pdo->prepare("
                    UPDATE adjustments 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE adjustment_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $userId, $requestId]);
                $pdo->commit();
                logActivity($pdo, $userId, $userName, $userRole,
                    'ADJUSTMENT_APPROVED', "Approved inventory adjustment #{$requestId}",
                    'adjustment', $requestId);
            } else {
                $stmt = $pdo->prepare("
                    UPDATE adjustments 
                    SET status = ?, updated_at = NOW() 
                    WHERE adjustment_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            break;

        case 'ret':
            // Returns — wrap in transaction for safety
            $pdo->beginTransaction();
            if ($newStatus === 'APPROVED') {
                $stmt = $pdo->prepare("
                    UPDATE returns 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE return_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $userId, $requestId]);
                if ($stmt->rowCount() === 0) {
                    $pdo->rollBack();
                    echo json_encode(['success' => false, 'message' => 'Request is not pending approval.']);
                    exit;
                }
            } else {
                $stmt = $pdo->prepare("
                    UPDATE returns 
                    SET status = ?, updated_at = NOW() 
                    WHERE return_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            $pdo->commit();
            if ($newStatus === 'APPROVED') {
                logActivity($pdo, $userId, $userName, $userRole,
                    'RETURN_APPROVED', "Approved return request #{$requestId}",
                    'return', $requestId);
            }
            break;

        case 'void':
            // Voids — wrap in transaction for safety
            $pdo->beginTransaction();
            if ($newStatus === 'APPROVED') {
                $stmt = $pdo->prepare("
                    UPDATE voids 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE void_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $userId, $requestId]);
                if ($stmt->rowCount() === 0) {
                    $pdo->rollBack();
                    echo json_encode(['success' => false, 'message' => 'Request is not pending approval.']);
                    exit;
                }
            } else {
                $stmt = $pdo->prepare("
                    UPDATE voids 
                    SET status = ?, updated_at = NOW() 
                    WHERE void_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            $pdo->commit();
            if ($newStatus === 'APPROVED') {
                logActivity($pdo, $userId, $userName, $userRole,
                    'VOID_APPROVED', "Approved void request #{$requestId}",
                    'void', $requestId);
            }
            break;

        case 'stock_in':
            if ($newStatus === 'APPROVED') {
                $pdo->beginTransaction();

                // Lock the parent row and verify it is still PENDING
                $lockStmt = $pdo->prepare("
                    SELECT stock_in_id FROM stock_in 
                    WHERE stock_in_id = ? AND status = 'PENDING' FOR UPDATE
                ");
                $lockStmt->execute([$requestId]);
                if (!$lockStmt->fetch()) {
                    $pdo->rollBack();
                    echo json_encode(['success' => false, 'message' => 'Request is not pending approval.']);
                    exit;
                }

                // Get stock_in items and update raw materials
                $siStmt = $pdo->prepare("
                    SELECT raw_material_id, quantity 
                    FROM stock_in_items 
                    WHERE stock_in_id = ? AND is_deleted = 0
                ");
                $siStmt->execute([$requestId]);
                $items = $siStmt->fetchAll();

                foreach ($items as $item) {
                    $updStmt = $pdo->prepare("
                        UPDATE raw_materials 
                        SET current_quantity = current_quantity + ?,
                            updated_at = NOW()
                        WHERE raw_material_id = ?
                    ");
                    $updStmt->execute([$item['quantity'], $item['raw_material_id']]);
                }

                $stmt = $pdo->prepare("
                    UPDATE stock_in 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE stock_in_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $userId, $requestId]);
                $pdo->commit();
                logActivity($pdo, $userId, $userName, $userRole,
                    'STOCK_IN_APPROVED', "Approved stock-in #{$requestId}",
                    'stock_in', $requestId);
            } else {
                $stmt = $pdo->prepare("
                    UPDATE stock_in 
                    SET status = ?, updated_at = NOW() 
                    WHERE stock_in_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            break;

        case 'stock_out':
            if ($newStatus === 'APPROVED') {
                $pdo->beginTransaction();

                // Lock the parent row and verify it is still PENDING
                $lockStmt = $pdo->prepare("
                    SELECT stock_out_id FROM stock_out 
                    WHERE stock_out_id = ? AND status = 'PENDING' FOR UPDATE
                ");
                $lockStmt->execute([$requestId]);
                if (!$lockStmt->fetch()) {
                    $pdo->rollBack();
                    echo json_encode(['success' => false, 'message' => 'Request is not pending approval.']);
                    exit;
                }

                $soStmt = $pdo->prepare("
                    SELECT raw_material_id, quantity 
                    FROM stock_out_items 
                    WHERE stock_out_id = ? AND is_deleted = 0
                ");
                $soStmt->execute([$requestId]);
                $items = $soStmt->fetchAll();

                foreach ($items as $item) {
                    $updStmt = $pdo->prepare("
                        UPDATE raw_materials 
                        SET current_quantity = GREATEST(current_quantity - ?, 0),
                            updated_at = NOW()
                        WHERE raw_material_id = ?
                    ");
                    $updStmt->execute([$item['quantity'], $item['raw_material_id']]);
                }

                $stmt = $pdo->prepare("
                    UPDATE stock_out 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE stock_out_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $userId, $requestId]);
                $pdo->commit();
                logActivity($pdo, $userId, $userName, $userRole,
                    'STOCK_OUT_APPROVED', "Approved stock-out #{$requestId}",
                    'stock_out', $requestId);
            } else {
                $stmt = $pdo->prepare("
                    UPDATE stock_out 
                    SET status = ?, updated_at = NOW() 
                    WHERE stock_out_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            break;

        case 'spoilage':
            // Spoilage — deduct from inventory when approved
            $pdo->beginTransaction();
            if ($newStatus === 'APPROVED') {
                // Lock the parent row and verify it is still PENDING
                $spStmt = $pdo->prepare("
                    SELECT raw_material_id, quantity_lost 
                    FROM spoilage 
                    WHERE spoilage_id = ? AND status = 'PENDING' FOR UPDATE
                ");
                $spStmt->execute([$requestId]);
                $spItem = $spStmt->fetch();

                if (!$spItem) {
                    $pdo->rollBack();
                    echo json_encode(['success' => false, 'message' => 'Request is not pending approval.']);
                    exit;
                }

                // Deduct spoilage from raw material stock
                $updStmt = $pdo->prepare("
                    UPDATE raw_materials 
                    SET current_quantity = GREATEST(current_quantity - ?, 0),
                        updated_at = NOW()
                    WHERE raw_material_id = ?
                ");
                $updStmt->execute([$spItem['quantity_lost'], $spItem['raw_material_id']]);

                $stmt = $pdo->prepare("
                    UPDATE spoilage 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE spoilage_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $userId, $requestId]);
            } else {
                $stmt = $pdo->prepare("
                    UPDATE spoilage 
                    SET status = ?, updated_at = NOW() 
                    WHERE spoilage_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            $pdo->commit();
            if ($newStatus === 'APPROVED') {
                logActivity($pdo, $userId, $userName, $userRole,
                    'SPOILAGE_APPROVED', "Approved spoilage report #{$requestId}",
                    'spoilage', $requestId);
            }
            break;

        case 'purchase_plan':
            // purchase_plans.status uses TITLE CASE ('Pending','Approved','Rejected','Cancelled')
            // and has NO approved_by column — audit attribution goes to activity_logs only
            $ppStatus = ($newStatus === 'APPROVED') ? 'Approved' : 'Rejected';
            if ($newStatus === 'APPROVED') {
                $stmt = $pdo->prepare("
                    UPDATE purchase_plans 
                    SET status = ?, updated_at = NOW() 
                    WHERE plan_id = ? AND status = 'Pending'
                ");
                $stmt->execute([$ppStatus, $requestId]);
                if ($stmt->rowCount() === 0) {
                    echo json_encode(['success' => false, 'message' => 'Request is not pending approval.']);
                    exit;
                }
                logActivity($pdo, $userId, $userName, $userRole,
                    'PURCHASE_PLAN_EVALUATE', "Approved purchase plan #{$requestId}",
                    'purchase_plan', $requestId);
            } else {
                $stmt = $pdo->prepare("
                    UPDATE purchase_plans 
                    SET status = ?, updated_at = NOW() 
                    WHERE plan_id = ? AND status = 'Pending'
                ");
                $stmt->execute([$ppStatus, $requestId]);
                if ($stmt->rowCount() === 0) {
                    echo json_encode(['success' => false, 'message' => 'Request is not pending approval.']);
                    exit;
                }
            }
            break;

        default:
            echo json_encode(['success' => false, 'message' => 'Invalid approval type.']);
            exit;
    }

    echo json_encode(['success' => true, 'message' => "Request $newStatus successfully."]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('update_approval error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'error' => 'An unexpected server error occurred.']);
}