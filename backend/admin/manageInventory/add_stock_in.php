<?php
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../db.php';        // Provides the $pdo instance

header("Content-Type: application/json");

try {
    // Get JSON input
    $input = json_decode(file_get_contents("php://input"), true);

    if (!$input) {
        throw new Exception("No data received.");
    }

    // Extract fields
    $supplier_id = !empty($input['supplier_id']) ? $input['supplier_id'] : null;
    $date        = $input['stock_in_date'] ?? null;
    $remarks     = !empty($input['remarks']) ? $input['remarks'] : '';
    $items       = $input['items'] ?? [];

    // --- SECURE AUTHORIZATION CHECK ---
    $auth = authenticate(['Admin']);
    $user_id = (int)$auth['user_id'];

    // VALIDATION
    if (!$date) {
        throw new Exception("Stock In Date is required.");
    }
    if (empty($items)) {
        throw new Exception("Please add at least one item to the list.");
    }
    if (!$user_id) {
        http_response_code(401);
        throw new Exception("User session expired or invalid token. Please log in again.");
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

    // 2. Insert into stock_in table (ADMIN AUTO-APPROVAL)
    $stmtStockIn = $pdo->prepare("
        INSERT INTO stock_in (
            supplier_id, user_id, stock_in_date, total_cost, 
            remarks, status, approved_by, approved_at
        )
        VALUES (
            :supplier_id, :user_id, :stock_in_date, :total_cost, 
            :remarks, 'APPROVED', :approved_by, NOW()
        )
    ");

    $stmtStockIn->execute([
        ':supplier_id'   => $supplier_id,
        ':user_id'       => $user_id,
        ':stock_in_date' => $date,
        ':total_cost'    => $total_cost,
        ':remarks'       => $remarks,
        ':approved_by'   => $user_id
    ]);

    $stock_in_id = $pdo->lastInsertId();

    // 3. Prepare Item and Inventory Update statements
    // NOTE: subtotal is a GENERATED ALWAYS column (quantity * unit_cost) — never INSERT it.
    $stmtItem = $pdo->prepare("
        INSERT INTO stock_in_items (stock_in_id, raw_material_id, quantity, unit_cost, expiration_date)
        VALUES (:stock_in_id, :raw_material_id, :quantity, :unit_cost, :expiration_date)
    ");

    $stmtUpdateMat = $pdo->prepare("
        UPDATE raw_materials 
        SET current_quantity = current_quantity + :qty, 
            cost_per_unit = :cost, 
            updated_at = NOW() 
        WHERE raw_material_id = :id
    ");

    // 4. Loop through items
    foreach ($items as $item) {
        $cleanQty = isset($item['quantity']) ? (float)$item['quantity'] : 0.0;
        $cleanCost = isset($item['unit_cost']) ? (float)$item['unit_cost'] : 0.0;

        // Insert into stock_in_items (subtotal auto-computed by GENERATED column)
        $stmtItem->execute([
            ':stock_in_id'      => $stock_in_id,
            ':raw_material_id'  => $item['material_id'],
            ':quantity'         => $cleanQty,
            ':unit_cost'        => $cleanCost,
            ':expiration_date'  => !empty($item['expiration_date']) ? $item['expiration_date'] : null
        ]);

        // Update raw_materials inventory volumes
        $stmtUpdateMat->execute([
            ':qty'  => $cleanQty,
            ':cost' => $cleanCost,
            ':id'   => $item['material_id']
        ]);
    }

    $pdo->commit();

    echo json_encode([
        "success" => true,
        "message" => "Stock In recorded and auto-approved successfully."
    ]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    if (http_response_code() === 200) {
        http_response_code(400);
    }
    echo json_encode([
        "success" => false,
        "message" => "Error: " . $e->getMessage()
    ]);
}