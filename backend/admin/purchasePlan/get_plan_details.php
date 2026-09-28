<?php
// backend/get_plan_details.php
header("Content-Type: application/json");
require_once __DIR__ . '/../../db.php';

$plan_id = isset($_GET['plan_id']) ? intval($_GET['plan_id']) : 0;

if ($plan_id === 0) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid Plan ID provided."]);
    exit;
}

try {
    // 1. Fetch parent plan summary
    $planStmt = $pdo->prepare("SELECT * FROM purchase_plans WHERE plan_id = ?");
    $planStmt->execute([$plan_id]);
    $plan_data = $planStmt->fetch();

    if (!$plan_data) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Purchase plan records not found."]);
        exit;
    }

    // 2. Fetch all child line items joined with their descriptive names
    $itemsStmt = $pdo->prepare("
        SELECT i.*, m.raw_material_name, m.unit 
        FROM purchase_plan_items i 
        JOIN raw_materials m ON i.raw_material_id = m.raw_material_id 
        WHERE i.plan_id = ?
    ");
    $itemsStmt->execute([$plan_id]);
    $items = $itemsStmt->fetchAll();

    // Attach children list to master object array
    $plan_data['items'] = $items;

    echo json_encode($plan_data);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Database fetch failed: " . $e->getMessage()]);
}
