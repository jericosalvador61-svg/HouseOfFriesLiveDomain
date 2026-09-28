<?php
/**
 * HOF Waiter API - Get Categories
 */
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Waiter', 'Admin', 'Supervisor']);
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

try {
    $stmt = $pdo->query("
        SELECT category_id, category_name, status
        FROM menu_categories
        WHERE status = 'Active'
        ORDER BY category_name ASC
    ");
    $categories = $stmt->fetchAll();

    echo json_encode(['success' => true, 'categories' => $categories]);
} catch (PDOException $e) {
    error_log('get_categories error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load categories.']);
}