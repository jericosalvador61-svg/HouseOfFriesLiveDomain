<?php
/**
 * Customer Search API
 * Searches: available menu items (public/guest access, no auth required)
 */
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

$query = trim($_GET['q'] ?? '');
if (strlen($query) < 2) {
    echo json_encode(['success' => true, 'results' => []]);
    exit;
}

$searchTerm = "%{$query}%";

try {
    // Search Menu Items
    $stmt = $pdo->prepare("
        SELECT m.menu_item_id as id, m.item_name as name, 
               c.category_name as category, m.price, m.image_url,
               'customer.html' as url
        FROM menu_items m
        LEFT JOIN menu_categories c ON m.category_id = c.category_id
        WHERE m.item_name LIKE ? AND m.status = 'Available'
        ORDER BY m.item_name
        LIMIT 10
    ");
    $stmt->execute([$searchTerm]);
    $results = $stmt->fetchAll();

    echo json_encode(['success' => true, 'results' => $results]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}