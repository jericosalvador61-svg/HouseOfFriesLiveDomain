<?php
// backend/get_purchase_plans.php
header("Content-Type: application/json");
require_once __DIR__ . '/../../db.php';

try {
    // 🧑‍🍳 CONCAT combines the first name and last name into a single string with a space in between
    $sql = "SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS staff_name, COUNT(i.id) as total_items 
            FROM purchase_plans p 
            INNER JOIN users u ON p.created_by = u.user_id 
            LEFT JOIN purchase_plan_items i ON p.plan_id = i.plan_id 
            GROUP BY p.plan_id 
            ORDER BY p.created_at DESC";

    $stmt = $pdo->query($sql);
    $plans = $stmt->fetchAll();

    echo json_encode($plans);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Error fetching purchase plans: " . $e->getMessage()]);
}
