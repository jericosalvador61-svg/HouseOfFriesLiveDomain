<?php
/**
 * Admin Search API
 * Searches: orders, inventory, users, menu items
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
header('Content-Type: application/json');

authenticate(['Admin', 'Supervisor']);
$query = trim($_GET['q'] ?? '');
if (strlen($query) < 2) {
    echo json_encode(['success' => true, 'results' => []]);
    exit;
}

$results = [];
$searchTerm = "%{$query}%";

try {
    // Search Orders
    $stmt = $pdo->prepare("
        SELECT order_id as id, reference_number as name, 'Order' as category, status, 'orders.html' as url
        FROM orders 
        WHERE reference_number LIKE ? OR customer_name LIKE ?
        ORDER BY ordered_at DESC LIMIT 5
    ");
    $stmt->execute([$searchTerm, $searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    // Search Menu Items
    $stmt = $pdo->prepare("
        SELECT menu_item_id as id, item_name as name, category_name as category, price, 'manage_menu.html' as url
        FROM menu_items m
        LEFT JOIN menu_categories c ON m.category_id = c.category_id
        WHERE item_name LIKE ? OR description LIKE ?
        LIMIT 5
    ");
    $stmt->execute([$searchTerm, $searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    // Search Users
    $stmt = $pdo->prepare("
        SELECT user_id as id, CONCAT(first_name, ' ', last_name) as name, role_name as category, 'manage_users.html' as url
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.role_id
        WHERE (first_name LIKE ? OR last_name LIKE ? OR username LIKE ?) AND status = 'Active'
        LIMIT 5
    ");
    $stmt->execute([$searchTerm, $searchTerm, $searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    // Search Raw Materials
    $stmt = $pdo->prepare("
        SELECT raw_material_id as id, raw_material_name as name, 'Raw Material' as category, 'inventoryStaff_RawMaterials.html' as url
        FROM raw_materials
        WHERE raw_material_name LIKE ? AND status = 'ACTIVE'
        LIMIT 5
    ");
    $stmt->execute([$searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    echo json_encode(['success' => true, 'results' => $results]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}