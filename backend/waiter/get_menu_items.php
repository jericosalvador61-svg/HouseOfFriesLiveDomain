<?php
/**
 * HOF Waiter API - Full menu list for the Create Order page
 * Shape matches createOrder.js: { success, menu: [{id,name,description,image,price,status}] }
 * Image paths are normalized for root deployment (/images/menu/<file>).
 */
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Waiter', 'Admin', 'Supervisor']);
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../image_helper.php';

try {
    // Only orderable items are returned - an Unavailable item must never be
    // addable to a cart. (menu_items has no is_deleted column.)
    $stmt = $pdo->query("
        SELECT menu_item_id, item_name, description, image_url, price, status
        FROM menu_items
        WHERE status = 'Available'
        ORDER BY item_name ASC
    ");
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $menu = array_map(function ($item) {
        return [
            'id'          => (int)$item['menu_item_id'],
            'name'        => $item['item_name'],
            'description' => $item['description'],
            'image'       => hof_normalize_image($item['image_url'], 'menu'),
            'price'       => (float)$item['price'],
            'status'      => $item['status']
        ];
    }, $items);

    echo json_encode(['success' => true, 'menu' => $menu]);
} catch (PDOException $e) {
    error_log('get_menu_items error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load the menu.']);
}