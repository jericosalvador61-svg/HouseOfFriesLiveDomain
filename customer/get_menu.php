<?php
// get_menu.php
header('Content-Type: application/json');
require_once __DIR__ . "/../backend/db.php";
require_once __DIR__ . "/../backend/image_helper.php";

try {
    // UPDATED: Added 'status' to the SELECT fields and removed the WHERE restriction
    $stmt = $pdo->prepare("SELECT menu_item_id, item_name, description, image_url, category_id, price, status 
                           FROM menu_items 
                           ORDER BY item_name ASC");
    $stmt->execute();
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC); // Fetching as associative array cleanly

    // Normalize legacy image paths (e.g. /HOF1/images/...) to root-absolute /images/menu/...
    hof_normalize_menu_images($items);

    echo json_encode($items);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => $e->getMessage()]);
}
