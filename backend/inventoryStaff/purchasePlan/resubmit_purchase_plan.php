<?php
// backend/resubmit_purchase_plan.php
header("Content-Type: application/json");
require_once __DIR__ . '/../../db.php';

$input = json_decode(file_get_contents("php://input"), true);

if (!$input || empty($input['plan_id']) || empty($input['items'])) {
    echo json_encode(["success" => false, "message" => "Invalid resubmission payload data."]);
    exit;
}

$plan_id = intval($input['plan_id']);
$remarks = $input['remarks'] ?? '';

try {
    // Start a safe PDO Transaction
    $pdo->beginTransaction();

    // 💰 FINANCIAL TRACKING STAGE: Calculate new costs and totals before writing to tables
    $calculated_grand_total = 0;
    $compiled_items = [];

    foreach ($input['items'] as $item) {
        $mat_id = intval($item['raw_material_id']);
        $suggested_qty = floatval($item['suggested_quantity']);

        // 🔍 FETCH: Live balances AND cost_per_unit
        $matStmt = $pdo->prepare("SELECT current_quantity, reorder_level, cost_per_unit FROM raw_materials WHERE raw_material_id = ?");
        $matStmt->execute([$mat_id]);
        $mat_data = $matStmt->fetch();

        $current_qty = $mat_data ? floatval($mat_data['current_quantity']) : 0;
        $reorder_lvl = $mat_data ? floatval($mat_data['reorder_level']) : 0;
        $unit_cost   = $mat_data ? floatval($mat_data['cost_per_unit']) : 0.00;

        // Subtotal calculations
        $subtotal = $suggested_qty * $unit_cost;
        $calculated_grand_total += $subtotal;

        // Stage details in memory
        $compiled_items[] = [
            'id' => $mat_id,
            'qty' => $suggested_qty,
            'current_qty' => $current_qty,
            'reorder_lvl' => $reorder_lvl,
            'unit_cost' => $unit_cost
        ];
    }

    // 1. Update parent plan status back to 'Pending', clear old admin notes, and SAVE new total_cost
    $updatePlanSql = "UPDATE purchase_plans 
                      SET remarks = :remarks, total_cost = :total_cost, status = 'Pending', admin_remarks = NULL 
                      WHERE plan_id = :plan_id";
    $stmt = $pdo->prepare($updatePlanSql);
    $stmt->execute([
        ':remarks'    => $remarks,
        ':total_cost' => $calculated_grand_total,
        ':plan_id'    => $plan_id
    ]);

    // 2. Clear out old snapshot line items for this specific plan
    $deleteItemsSql = "DELETE FROM purchase_plan_items WHERE plan_id = :plan_id";
    $stmt = $pdo->prepare($deleteItemsSql);
    $stmt->execute([':plan_id' => $plan_id]);

    // 3. Insert new modified quantities requested by staff (✨ NOW SAVES: snapshot_unit_cost)
    $insertItemSql = "INSERT INTO purchase_plan_items (plan_id, raw_material_id, current_quantity, snapshot_unit_cost, reorder_level, suggested_quantity) 
                      VALUES (:plan_id, :raw_material_id, :current_quantity, :snapshot_unit_cost, :reorder_level, :suggested_quantity)";
    $insertStmt = $pdo->prepare($insertItemSql);

    foreach ($compiled_items as $ci) {
        $insertStmt->execute([
            ':plan_id'            => $plan_id,
            ':raw_material_id'    => $ci['id'],
            ':current_quantity'   => $ci['current_qty'],
            ':snapshot_unit_cost' => $ci['unit_cost'], // Preserves standard cost benchmarking data
            ':reorder_level'      => $ci['reorder_lvl'],
            ':suggested_quantity' => $ci['qty']
        ]);
    }

    // Save everything permanently if all loops succeed
    $pdo->commit();
    echo json_encode(["success" => true, "message" => "Purchase plan updated with new totals and resubmitted!"]);
} catch (Exception $e) {
    // Undo everything if an error occurs midway
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Database processing failure: " . $e->getMessage()]);
}
