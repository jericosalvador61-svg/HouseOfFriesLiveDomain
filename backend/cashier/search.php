<?php
/**
 * Cashier Search API
 * Searches: orders, products/menu items
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
header('Content-Type: application/json');

authenticate(['Cashier', 'Admin']);
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
        SELECT order_id as id, reference_number as name, status as category, 'orders.html' as url
        FROM orders 
        WHERE reference_number LIKE ? OR customer_name LIKE ?
        ORDER BY ordered_at DESC LIMIT 8
    ");
    $stmt->execute([$searchTerm, $searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    // Search Menu Items
    $stmt = $pdo->prepare("
        SELECT menu_item_id as id, item_name as name, category_name as category, price, 'new_order.html' as url
        FROM menu_items m
        LEFT JOIN menu_categories c ON m.category_id = c.category_id
        WHERE item_name LIKE ? AND m.status = 'Available'
        LIMIT 8
    ");
    $stmt->execute([$searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    echo json_encode(['success' => true, 'results' => $results]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}