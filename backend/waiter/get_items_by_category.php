<?php
/**
 * HOF Waiter API - Get Items by Category
 */
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Waiter', 'Admin', 'Supervisor']);
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../image_helper.php';
header('Content-Type: application/json');

try {
    $categoryId = $_GET['category_id'] ?? '';

    $sql = "
        SELECT 
            mi.menu_item_id,
            mi.item_name,
            mi.description,
            mi.price,
            mi.status,
            mi.image_url,
            mc.category_name
        FROM menu_items mi
        JOIN menu_categories mc ON mi.category_id = mc.category_id
        WHERE mi.status = 'Available'
    ";

    $params = [];
    if ($categoryId) {
        $sql .= " AND mi.category_id = :category_id";
        $params[':category_id'] = $categoryId;
    }

    $sql .= " ORDER BY mc.category_name, mi.item_name ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $items = $stmt->fetchAll();

    // Normalize legacy image paths for root deployment
    hof_normalize_menu_images($items);

    echo json_encode(['success' => true, 'items' => $items]);
} catch (PDOException $e) {
    error_log('get_items_by_category error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load items.']);
}