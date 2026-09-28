<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../image_helper.php";
header("Content-Type: application/json");

try {
    $stmt = $pdo->prepare("
        SELECT m.menu_item_id, m.item_name, m.description, m.price, m.image_url, m.category_id, m.status, m.estimated_prep_time_minutes,
               c.category_name
        FROM menu_items m
        LEFT JOIN menu_categories c ON m.category_id = c.category_id
        ORDER BY c.category_name, m.item_name 
    ");
    $stmt->execute();
    $menus = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Normalize legacy image paths (e.g. /HOF1/images/...) to root-absolute /images/menu/...
    hof_normalize_menu_images($menus);

    echo json_encode($menus);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to fetch menus"]);
}