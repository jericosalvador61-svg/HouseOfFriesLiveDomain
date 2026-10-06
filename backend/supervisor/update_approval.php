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
// Option A: approver may correct qty/cost before Approve
$correctedQty = isset($data['quantity']) ? (float)$data['quantity'] : null;
$costUpdates = (isset($data['cost_updates']) && is_array($data['cost_updates'])) ? $data['cost_updates'] : [];
// Reject reason is shown to staff via activity log (never silent)
$rejectReason = trim((string)($data['reject_reason'] ?? ''));
$rejectSuffix = ($rejectReason !== '') ? (" — Reason: " . mb_substr($rejectReason, 0, 200)) : '';

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
                    // Option A: approver-corrected qty applies to single-line adjustments
                    $useQty = ($correctedQty !== null && count($items) === 1 && $correctedQty > 0) ? $correctedQty : (float)$adj['quantity'];
                    if ($correctedQty !== null && count($items) === 1 && $correctedQty > 0) {
                        $fixStmt = $pdo->prepare("UPDATE adjustment_items SET quantity = ? WHERE adjustment_id = ?");
                        $fixStmt->execute([$useQty, $requestId]);
                    }
                    // Update raw material stock
                    $change = ($adj['adjustment_type'] === 'ADD' ? 1 : -1) * $useQty;
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
                    'ADJUSTMENT_APPROVED', "Inventory adjustment #{$requestId} approved by {$userName}",
                    'adjustment', $requestId, null, 'APPROVED', 'PENDING', 'APPROVED');
            } else {
                $stmt = $pdo->prepare("
                    UPDATE adjustments 
                    SET status = ?, updated_at = NOW() 
                    WHERE adjustment_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
                // REQ-050 / Cline N1: only log when the UPDATE actually matched a PENDING row
                if ($stmt->rowCount() > 0) {
                    logActivity($pdo, $userId, $userName, $userRole,
                        'ADJUSTMENT_REJECTED', "Inventory adjustment #{$requestId} rejected by {$userName}{$rejectSuffix}",
                        'adjustment', $requestId, null, 'REJECTED', 'PENDING', 'REJECTED');
                }
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
                if ($stmt->rowCount() > 0) {
                    logActivity($pdo, $userId, $userName, $userRole,
                        'RETURN_REJECTED', "Return request #{$requestId} rejected by {$userName}{$rejectSuffix}",
                        'return', $requestId, null, 'REJECTED', 'PENDING', 'REJECTED');
                }
            }
            $pdo->commit();
            if ($newStatus === 'APPROVED') {
                logActivity($pdo, $userId, $userName, $userRole,
                    'RETURN_APPROVED', "Return request #{$requestId} approved by {$userName}",
                    'return', $requestId, null, 'APPROVED', 'PENDING', 'APPROVED');
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
                if ($stmt->rowCount() > 0) {
                    logActivity($pdo, $userId, $userName, $userRole,
                        'VOID_REJECTED', "Void request #{$requestId} rejected by {$userName}{$rejectSuffix}",
                        'void', $requestId, null, 'REJECTED', 'PENDING', 'REJECTED');
                }
            }
            $pdo->commit();
            if ($newStatus === 'APPROVED') {
                logActivity($pdo, $userId, $userName, $userRole,
                    'VOID_APPROVED', "Void request #{$requestId} approved by {$userName}",
                    'void', $requestId, null, 'APPROVED', 'PENDING', 'APPROVED');
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

                // Option A: approver cost corrections persist as new cost_per_unit
                foreach ($costUpdates as $mid => $newCost) {
                    $mid = (int)$mid; $newCost = (float)$newCost;
                    if ($mid > 0 && $newCost >= 0) {
                        $cStmt = $pdo->prepare("UPDATE raw_materials SET cost_per_unit = ?, updated_at = NOW() WHERE raw_material_id = ?");
                        $cStmt->execute([$newCost, $mid]);
                    }
                }

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
                    'STOCK_IN_APPROVED', "Stock-in #{$requestId} approved by {$userName}",
                    'stock_in', $requestId, null, 'APPROVED', 'PENDING', 'APPROVED');
            } else {
                $stmt = $pdo->prepare("
                    UPDATE stock_in 
                    SET status = ?, updated_at = NOW() 
                    WHERE stock_in_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
                if ($stmt->rowCount() > 0) {
                    logActivity($pdo, $userId, $userName, $userRole,
                        'STOCK_IN_REJECTED', "Stock-in #{$requestId} rejected by {$userName}{$rejectSuffix}",
                        'stock_in', $requestId, null, 'REJECTED', 'PENDING', 'REJECTED');
                }
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
                    'STOCK_OUT_APPROVED', "Stock-out #{$requestId} approved by {$userName}",
                    'stock_out', $requestId, null, 'APPROVED', 'PENDING', 'APPROVED');
            } else {
                $stmt = $pdo->prepare("
                    UPDATE stock_out 
                    SET status = ?, updated_at = NOW() 
                    WHERE stock_out_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
                if ($stmt->rowCount() > 0) {
                    logActivity($pdo, $userId, $userName, $userRole,
                        'STOCK_OUT_REJECTED', "Stock-out #{$requestId} rejected by {$userName}{$rejectSuffix}",
                        'stock_out', $requestId, null, 'REJECTED', 'PENDING', 'REJECTED');
                }
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

                // Option A: approver-corrected qty
                $useQty = ($correctedQty !== null && $correctedQty > 0) ? $correctedQty : (float)$spItem['quantity_lost'];
                if ($correctedQty !== null && $correctedQty > 0) {
                    $fixStmt = $pdo->prepare("UPDATE spoilage SET quantity_lost = ? WHERE spoilage_id = ? AND status = 'PENDING'");
                    $fixStmt->execute([$useQty, $requestId]);
                }

                // Deduct spoilage from raw material stock
                $updStmt = $pdo->prepare("
                    UPDATE raw_materials 
                    SET current_quantity = GREATEST(current_quantity - ?, 0),
                        updated_at = NOW()
                    WHERE raw_material_id = ?
                ");
                $updStmt->execute([$useQty, $spItem['raw_material_id']]);

                $stmt = $pdo->prepare("
                    UPDATE spoilage 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE spoilage_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $userId, $requestId]);
                $spoilApplied = $stmt->rowCount() > 0;
            } else {
                $stmt = $pdo->prepare("
                    UPDATE spoilage 
                    SET status = ?, updated_at = NOW() 
                    WHERE spoilage_id = ? AND status = 'PENDING'
                ");
                $stmt->execute([$newStatus, $requestId]);
                // REQ-050 / Cline N1: only log when the UPDATE actually matched a PENDING row
                $spoilApplied = $stmt->rowCount() > 0;
            }
            $pdo->commit();
            if ($newStatus === 'APPROVED') {
                logActivity($pdo, $userId, $userName, $userRole,
                    'SPOILAGE_APPROVED', "Spoilage report #{$requestId} approved by {$userName}",
                    'spoilage', $requestId, null, 'APPROVED', 'PENDING', 'APPROVED');
            } else if ($spoilApplied) {
                logActivity($pdo, $userId, $userName, $userRole,
                    'SPOILAGE_REJECTED', "Spoilage report #{$requestId} rejected by {$userName}{$rejectSuffix}",
                    'spoilage', $requestId, null, 'REJECTED', 'PENDING', 'REJECTED');
            }
            break;

        case 'purchase_plan':
            // purchase_plans.status uses TITLE CASE ('Pending','Approved','Rejected','Cancelled')
            // and has NO approved_by column — audit attribution goes to activity_logs only
            $ppStatus = ($newStatus === 'APPROVED') ? 'Approved' : 'Rejected';
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
            if ($newStatus === 'APPROVED') {
                logActivity($pdo, $userId, $userName, $userRole,
                    'PURCHASE_PLAN_APPROVED', "Purchase plan #{$requestId} approved by {$userName}",
                    'purchase_plan', $requestId, null, 'Approved', 'Pending', 'Approved');
            } else {
                logActivity($pdo, $userId, $userName, $userRole,
                    'PURCHASE_PLAN_REJECTED', "Purchase plan #{$requestId} rejected by {$userName}{$rejectSuffix}",
                    'purchase_plan', $requestId, null, 'Rejected', 'Pending', 'Rejected');
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