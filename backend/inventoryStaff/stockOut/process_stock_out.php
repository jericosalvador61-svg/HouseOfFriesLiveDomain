<?php
// backend/inventoryStaff/stockOut/process_stock_out.php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../secret.php';

try {
    $auth = authenticate(['Admin', 'Inventory Staff']);
    $userId = (int)$auth['user_id'];
    $username = $auth['username'] ?? 'unknown';
    $role = $auth['role'] ?? '';

    // ─── TRANSACTION PROCESSING ENGINE ───
    $data = json_decode(file_get_contents("php://input"), true);

    if (!$data || empty($data['items'])) {
        throw new Exception("No data received.");
    }

    $pdo->beginTransaction();

    // 1. Insert into stock_out table with PENDING status
    $stmt = $pdo->prepare("
        INSERT INTO stock_out (user_id, stock_out_date, remarks, status) 
        VALUES (?, ?, ?, 'PENDING')
    ");
    $stmt->execute([
        $userId,
        $data['date'],
        $data['remarks']
    ]);

    $stockOutId = $pdo->lastInsertId();

    // 2. Process each item requested for stock out using FIFO.
    // REQ-057: snapshot current cost_per_unit into stock_out_items.unit_cost.
    $stmtItem = $pdo->prepare("
        INSERT INTO stock_out_items (stock_out_id, raw_material_id, quantity, unit_cost) 
        VALUES (?, ?, ?, ?)
    ");
    $stmtUnitCost = $pdo->prepare("SELECT cost_per_unit FROM raw_materials WHERE raw_material_id = ?");

    foreach ($data['items'] as $item) {
        $materialId = $item['id'];
        $requestedQty = floatval($item['quantity']);

        // --- FIFO BATCH CALCULATION GATEWAY ---
        $stmtBatches = $pdo->prepare("
            SELECT sii.stock_in_item_id, sii.quantity, si.stock_in_date
            FROM stock_in_items sii
            JOIN stock_in si ON sii.stock_in_id = si.stock_in_id
            WHERE sii.raw_material_id = ? 
              AND sii.is_deleted = 0
              AND si.status = 'Approved'
              AND sii.quantity > 0
            ORDER BY si.stock_in_date ASC, si.stock_in_id ASC
        ");
        $stmtBatches->execute([$materialId]);
        $availableBatches = $stmtBatches->fetchAll(PDO::FETCH_ASSOC);

        $totalAvailableInBatches = array_sum(array_column($availableBatches, 'quantity'));
        if ($totalAvailableInBatches < $requestedQty) {
            throw new Exception("Insufficient stock in active batches for material ID {$materialId}. Requested: {$requestedQty}, Available: {$totalAvailableInBatches}");
        }

        $remainingToAllocate = $requestedQty;

        foreach ($availableBatches as $batch) {
            if ($remainingToAllocate <= 0) break;

            $batchId = $batch['stock_in_item_id'];
            $batchAvailableQty = floatval($batch['quantity']);
            $takeFromThisBatch = min($remainingToAllocate, $batchAvailableQty);

            $remainingToAllocate -= $takeFromThisBatch;
        }

        // REQ-057 unit-cost snapshot (gross-profit basis for REQ-056).
        $stmtUnitCost->execute([$materialId]);
        $unitCost = (float)$stmtUnitCost->fetchColumn();

        // Insert primary item record linked to this pending checkout request
        $stmtItem->execute([
            $stockOutId,
            $materialId,
            $requestedQty,
            $unitCost
        ]);
    }

    $pdo->commit();

    logActivity($pdo, $userId, $username, $role, 'STOCK_OUT',
        "Stock Out request #{$stockOutId} submitted",
        'stock_out', (int)$stockOutId, null, 'PENDING');

    // Notify Supervisor: stock out request awaiting approval
    hof_notify_roles($pdo, 'pending_approval', 'Stock Out Approval Needed',
        "Stock Out request #$stockOutId is awaiting your approval.",
        ['Supervisor'], '/public/supervisor/supervisor_approvals.html');

    echo json_encode(['status' => 'success', 'message' => 'Stock out request submitted sequentially (FIFO checked) and is now pending approval.']);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    error_log('process_stock_out error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}