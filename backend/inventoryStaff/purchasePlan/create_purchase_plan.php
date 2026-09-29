<?php
// backend/inventoryStaff/purchasePlan/create_purchase_plan.php
header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../secret.php';

$auth = authenticate(['Admin', 'Inventory Staff', 'Supervisor']);
$userId = (int)$auth['user_id'];
$username = $auth['username'] ?? 'unknown';
$role = $auth['role'] ?? '';
$created_by = $userId;

// ─── TRANSACTION PROCESSING ENGINE ───
$input = json_decode(file_get_contents("php://input"), true);

if (!$input || empty($input['items'])) {
    echo json_encode(["success" => false, "message" => "No items provided for the purchase plan."]);
    exit;
}

$remarks = $input['remarks'] ?? '';

try {
    $pdo->beginTransaction();

    $calculated_grand_total = 0;
    $compiled_items = [];

    foreach ($input['items'] as $item) {
        $mat_id = intval($item['raw_material_id']);
        $suggested_qty = floatval($item['suggested_quantity']);

        $matLookup = $pdo->prepare("SELECT current_quantity, reorder_level, cost_per_unit FROM raw_materials WHERE raw_material_id = ?");
        $matLookup->execute([$mat_id]);
        $mat_data = $matLookup->fetch();

        $current_qty = $mat_data ? floatval($mat_data['current_quantity']) : 0;
        $reorder_lvl = $mat_data ? floatval($mat_data['reorder_level']) : 0;
        $unit_cost   = $mat_data ? floatval($mat_data['cost_per_unit']) : 0.00;

        $subtotal = $suggested_qty * $unit_cost;
        $calculated_grand_total += $subtotal;

        $compiled_items[] = [
            'id' => $mat_id,
            'qty' => $suggested_qty,
            'current_qty' => $current_qty,
            'reorder_lvl' => $reorder_lvl,
            'unit_cost' => $unit_cost
        ];
    }

    // 1. Insert parent plan record
    $insertPlanSql = "INSERT INTO purchase_plans (created_by, remarks, total_cost, status) 
                      VALUES (:created_by, :remarks, :total_cost, 'Pending')";
    $stmt = $pdo->prepare($insertPlanSql);
    $stmt->execute([
        ':created_by' => $created_by,
        ':remarks'    => $remarks,
        ':total_cost' => $calculated_grand_total
    ]);

    $plan_id = $pdo->lastInsertId();

    // 2. Prepare statement for child itemization entries
    $insertItemSql = "INSERT INTO purchase_plan_items (plan_id, raw_material_id, current_quantity, snapshot_unit_cost, reorder_level, suggested_quantity) 
                      VALUES (:plan_id, :raw_material_id, :current_quantity, :snapshot_unit_cost, :reorder_level, :suggested_quantity)";
    $itemStmt = $pdo->prepare($insertItemSql);

    // 3. Loop through staged compiled items array block and write entries
    foreach ($compiled_items as $ci) {
        $itemStmt->execute([
            ':plan_id'            => $plan_id,
            ':raw_material_id'    => $ci['id'],
            ':current_quantity'   => $ci['current_qty'],
            ':snapshot_unit_cost' => $ci['unit_cost'],
            ':reorder_level'      => $ci['reorder_lvl'],
            ':suggested_quantity' => $ci['qty']
        ]);
    }

    $pdo->commit();

    logActivity($pdo, $userId, $username, $role, 'PURCHASE_PLAN_CREATE',
        "Created purchase plan #{$plan_id}",
        'purchase_plan', (int)$plan_id, (string)$plan_id, 'Pending');

    echo json_encode(["success" => true, "message" => "Purchase plan submitted to Admin successfully!"]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Transaction failed: " . $e->getMessage()]);
}