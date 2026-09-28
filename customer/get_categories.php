<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../backend/db.php";

try {
    // Fetch categories that are marked as 'Active'
    $stmt = $pdo->prepare("SELECT category_id, category_name FROM menu_categories WHERE status = 'Active' ORDER BY category_id ASC");
    $stmt->execute();
    $categories = $stmt->fetchAll();

    echo json_encode($categories);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => $e->getMessage()]);
}
