<?php
// backend/get_purchase_plans.php
header("Content-Type: application/json");
require_once __DIR__ . '/../../db.php';

try {
    // REQ-057 pagination: 10 plans/page, server-side LIMIT/OFFSET.
    $page = max(1, (int)($_GET['page'] ?? 1));
    $limit = 10;
    $offset = ($page - 1) * $limit;

    $total = (int)$pdo->query("SELECT COUNT(*) FROM purchase_plans")->fetchColumn();

    // 🧑‍🍳 CONCAT combines the first name and last name into a single string with a space in between
    $sql = "SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS staff_name, COUNT(i.id) as total_items 
            FROM purchase_plans p 
            INNER JOIN users u ON p.created_by = u.user_id 
            LEFT JOIN purchase_plan_items i ON p.plan_id = i.plan_id 
            GROUP BY p.plan_id, p.created_at, u.first_name, u.last_name 
            ORDER BY p.created_at DESC
            LIMIT :limit OFFSET :offset";

    $stmt = $pdo->prepare($sql);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    $stmt->execute();
    $plans = $stmt->fetchAll();

    echo json_encode([
        'plans' => $plans,
        'pagination' => [
            'total' => $total,
            'page' => $page,
            'per_page' => $limit,
            'total_pages' => (int)ceil($total / $limit)
        ]
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Error fetching purchase plans: " . $e->getMessage()]);
}
