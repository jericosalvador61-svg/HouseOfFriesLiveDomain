<?php
// backend/inventoryStaff/stockIn/add_stock_in.php
header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';

try {
    // ─── AUTHENTICATION ───
    $auth = authenticate(['Inventory Staff', 'Admin', 'Supervisor']);
    $user_id = (int)$auth['user_id'];

    // ─── DATA TRANSACTION CONTROLLER ───
    $input = json_decode(file_get_contents("php://input"), true);
    if (!$input) {
        throw new Exception("No data received.");
    }

    $supplier_id = !empty($input['supplier_id']) ? $input['supplier_id'] : null;
    $date        = $input['stock_in_date'] ?? null;
    $remarks     = !empty($input['remarks']) ? $input['remarks'] : '';
    $items       = $input['items'] ?? [];

    // VALIDATION
    if (!$date) {
        throw new Exception("Stock In Date is required.");
    }
    if (empty($items)) {
        throw new Exception("Please add at least one item to the list.");
    }

    $pdo->beginTransaction();

    // 1. Calculate Grand Total server-side (never trust client subtotal:
    // stock_in_items.subtotal is a GENERATED column = quantity * unit_cost)
    $total_cost = 0;
    foreach ($items as $item) {
        $qty = (float)($item['quantity'] ?? 0);
        $cost = (float)($item['unit_cost'] ?? 0);
        $total_cost += $qty * $cost;
    }

    // 2. Insert into stock_in table (STAFF REQUEST - PENDING ROUTE)
    $stmtStockIn = $pdo->prepare("
        INSERT INTO stock_in (
            supplier_id, user_id, stock_in_date, total_cost, 
            remarks, status
        )
        VALUES (
            :supplier_id, :user_id, :stock_in_date, :total_cost, 
            :remarks, 'PENDING'
        )
    ");

    $stmtStockIn->execute([
        ':supplier_id'   => $supplier_id,
        ':user_id'       => $user_id,
        ':stock_in_date' => $date,
        ':total_cost'    => $total_cost,
        ':remarks'       => $remarks
    ]);

    $stock_in_id = $pdo->lastInsertId();

    // 3. Prepare Item Batch Insert Statement
    // NOTE: subtotal is a GENERATED ALWAYS column (quantity * unit_cost) — never INSERT it.
    $stmtItem = $pdo->prepare("
        INSERT INTO stock_in_items (stock_in_id, raw_material_id, quantity, unit_cost, expiration_date)
        VALUES (:stock_in_id, :raw_material_id, :quantity, :unit_cost, :expiration_date)
    ");

    // 4. Loop through items and record structural lines
    foreach ($items as $item) {
        $stmtItem->execute([
            ':stock_in_id'      => $stock_in_id,
            ':raw_material_id'  => $item['material_id'],
            ':quantity'         => $item['quantity'],
            ':unit_cost'        => $item['unit_cost'],
            ':expiration_date'  => !empty($item['expiration_date']) ? $item['expiration_date'] : null
        ]);
    }

    $pdo->commit();

    // Notify Supervisor: stock in request awaiting approval
    hof_notify_roles($pdo, 'pending_approval', 'Stock In Approval Needed',
        "Stock In request #$stock_in_id is awaiting your approval.",
        ['Supervisor'], '/public/supervisor/supervisor_approvals.html');

    echo json_encode([
        "success" => true,
        "message" => "Stock In request submitted and waiting for admin approval."
    ]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo json_encode([
        "success" => false,
        "message" => $e->getMessage()
    ]);
}