<?php
/**
 * HOF Supervisor API - Update Approval Status
 * Approves or rejects inventory adjustments, returns, voids, stock_in, stock_out, spoilage
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';

$auth = authenticate(['Supervisor', 'Admin']);
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
                    WHERE adjustment_id = ?
                ");
                $stmt->execute([$newStatus, $auth['user_id'], $requestId]);
                $pdo->commit();
            } else {
                $stmt = $pdo->prepare("
                    UPDATE adjustments 
                    SET status = ?, updated_at = NOW() 
                    WHERE adjustment_id = ?
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
                    WHERE return_id = ?
                ");
                $stmt->execute([$newStatus, $auth['user_id'], $requestId]);
            } else {
                $stmt = $pdo->prepare("
                    UPDATE returns 
                    SET status = ?, updated_at = NOW() 
                    WHERE return_id = ?
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            $pdo->commit();
            break;

        case 'void':
            // Voids — wrap in transaction for safety
            $pdo->beginTransaction();
            if ($newStatus === 'APPROVED') {
                $stmt = $pdo->prepare("
                    UPDATE voids 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE void_id = ?
                ");
                $stmt->execute([$newStatus, $auth['user_id'], $requestId]);
            } else {
                $stmt = $pdo->prepare("
                    UPDATE voids 
                    SET status = ?, updated_at = NOW() 
                    WHERE void_id = ?
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            $pdo->commit();
            break;

        case 'stock_in':
            if ($newStatus === 'APPROVED') {
                $pdo->beginTransaction();

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
                    WHERE stock_in_id = ?
                ");
                $stmt->execute([$newStatus, $auth['user_id'], $requestId]);
                $pdo->commit();
            } else {
                $stmt = $pdo->prepare("
                    UPDATE stock_in 
                    SET status = ?, updated_at = NOW() 
                    WHERE stock_in_id = ?
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            break;

        case 'stock_out':
            if ($newStatus === 'APPROVED') {
                $pdo->beginTransaction();

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
                    WHERE stock_out_id = ?
                ");
                $stmt->execute([$newStatus, $auth['user_id'], $requestId]);
                $pdo->commit();
            } else {
                $stmt = $pdo->prepare("
                    UPDATE stock_out 
                    SET status = ?, updated_at = NOW() 
                    WHERE stock_out_id = ?
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            break;

        case 'spoilage':
            // Spoilage — deduct from inventory when approved
            $pdo->beginTransaction();
            if ($newStatus === 'APPROVED') {
                // Deduct spoilage from raw material stock
                $spStmt = $pdo->prepare("
                    SELECT raw_material_id, quantity_lost 
                    FROM spoilage 
                    WHERE spoilage_id = ?
                ");
                $spStmt->execute([$requestId]);
                $spItem = $spStmt->fetch();

                if ($spItem) {
                    $updStmt = $pdo->prepare("
                        UPDATE raw_materials 
                        SET current_quantity = GREATEST(current_quantity - ?, 0),
                            updated_at = NOW()
                        WHERE raw_material_id = ?
                    ");
                    $updStmt->execute([$spItem['quantity_lost'], $spItem['raw_material_id']]);
                }

                $stmt = $pdo->prepare("
                    UPDATE spoilage 
                    SET status = ?, approved_at = NOW(), approved_by = ?, updated_at = NOW() 
                    WHERE spoilage_id = ?
                ");
                $stmt->execute([$newStatus, $auth['user_id'], $requestId]);
            } else {
                $stmt = $pdo->prepare("
                    UPDATE spoilage 
                    SET status = ?, updated_at = NOW() 
                    WHERE spoilage_id = ?
                ");
                $stmt->execute([$newStatus, $requestId]);
            }
            $pdo->commit();
            break;

        case 'purchase_plan':
            $stmt = $pdo->prepare("
                UPDATE purchase_plans 
                SET status = ?, approved_by = ?, updated_at = NOW() 
                WHERE plan_id = ?
            ");
            $stmt->execute([$newStatus, $auth['user_id'], $requestId]);
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