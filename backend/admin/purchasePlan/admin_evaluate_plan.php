<?php
// backend/admin/purchasePlan/admin_evaluate_plan.php
header("Content-Type: application/json; charset=utf-8");
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../secret.php'; // Contains your JWT_SECRET configuration string

try {
    // ─── AUTHENTICATION ───
    $auth = authenticate(['Admin', 'Supervisor']);
    $adminUserId = (int)$auth['user_id'];

    // ─── TRANSACTION PROCESSING ENGINE ───
    // Read incoming JSON payload from JS fetch
    $input = json_decode(file_get_contents("php://input"), true);

    if (!$input || empty($input['plan_id']) || empty($input['status'])) {
        echo json_encode(["success" => false, "message" => "Incomplete request parameters."]);
        exit;
    }

    $plan_id = intval($input['plan_id']);
    $status = $input['status']; // Will receive either 'Approved' or 'Rejected'
    $admin_remarks = trim($input['admin_remarks'] ?? '');

    // Strict status variation guardrail 
    if (!in_array($status, ['Approved', 'Rejected'])) {
        echo json_encode(["success" => false, "message" => "Invalid status modification value."]);
        exit;
    }

    // Begin database transaction block
    $pdo->beginTransaction();

    // 💰 FINANCIAL SNAPSHOT ENGINE: If approved, capture live item costs right now
    if ($status === 'Approved') {
        $calculated_grand_total = 0;

        // Fetching structural table entries targeted by unique auto-incremental ids
        $itemsStmt = $pdo->prepare("SELECT id, raw_material_id, suggested_quantity FROM purchase_plan_items WHERE plan_id = ?");
        $itemsStmt->execute([$plan_id]);
        $items = $itemsStmt->fetchAll();

        $updateItemCostStmt = $pdo->prepare("UPDATE purchase_plan_items SET snapshot_unit_cost = ? WHERE id = ?");

        foreach ($items as $item) {
            // Get the live catalog cost per unit matching materials inventory index profiles
            $priceLookup = $pdo->prepare("SELECT cost_per_unit FROM raw_materials WHERE raw_material_id = ?");
            $priceLookup->execute([$item['raw_material_id']]);
            $price_data = $priceLookup->fetch();

            $latest_unit_cost = $price_data ? floatval($price_data['cost_per_unit']) : 0.00;
            $subtotal = floatval($item['suggested_quantity']) * $latest_unit_cost;
            $calculated_grand_total += $subtotal;

            // Pass the item's unique primary key context safely to save snapshot data
            $updateItemCostStmt->execute([$latest_unit_cost, $item['id']]);
        }

        // Update parent table status, manager evaluation notes, AND total calculated budget constraints
        $sql = "UPDATE purchase_plans 
                SET status = :status, total_cost = :total_cost, admin_remarks = :admin_remarks 
                WHERE plan_id = :plan_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':status'        => $status,
            ':total_cost'    => $calculated_grand_total,
            ':admin_remarks' => empty($admin_remarks) ? null : $admin_remarks,
            ':plan_id'       => $plan_id
        ]);
    } else {
        // If Rejected, update state parameters and reasons cleanly without rewriting initial estimations
        $sql = "UPDATE purchase_plans 
                SET status = :status, admin_remarks = :admin_remarks 
                WHERE plan_id = :plan_id";
        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            ':status'        => $status,
            ':admin_remarks' => empty($admin_remarks) ? null : $admin_remarks,
            ':plan_id'       => $plan_id
        ]);
    }

    // If everything maps perfectly, write database modifications securely
    $pdo->commit();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'PURCHASE_PLAN_EVALUATE', "Evaluated plan #{$plan_id} -> {$status}",
        'purchase_plan', $plan_id, (string)$plan_id, $status);

    // Notify Inventory Staff: plan evaluation result
    hof_notify_roles($pdo, 'purchase_plan', 'Purchase Plan ' . ucfirst(strtolower($status)),
        "Purchase plan #$plan_id was " . strtolower($status) . " during evaluation.",
        ['Inventory Staff'], '/public/inventoryStaff/inventoryStaff_PurchasePlan.html');

    echo json_encode(["success" => true, "message" => "Purchase plan processed successfully."]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Database processing failed: " . $e->getMessage()]);
}