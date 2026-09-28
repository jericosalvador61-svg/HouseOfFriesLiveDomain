<?php
/**
 * Waiter Search API - Searches tables and orders.
 * LIKE wildcards in the query are escaped so a user cannot turn the search
 * box into a full table scan.
 */
header('Content-Type: application/json');

require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../rate_limit.php';

authenticate(['Waiter', 'Admin', 'Supervisor']);

hof_rate_limit('waiter_search', 60, 60);

$query = trim((string)($_GET['q'] ?? ''));
if (mb_strlen($query) < 2 || mb_strlen($query) > 100) {
    echo json_encode(['success' => true, 'results' => []]);
    exit;
}

// Escape LIKE metacharacters, then wrap for a contains-match.
$escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $query);
$searchTerm = '%' . $escaped . '%';

try {
    $results = [];

    // Search Tables
    $stmt = $pdo->prepare("
        SELECT table_id as id,
               CONCAT('Table ', table_number) as name,
               CONCAT(status, ' - ', table_type) as category,
               'tables.html' as url
        FROM restaurant_table
        WHERE is_deleted = 0
          AND (table_number LIKE ? OR table_type LIKE ? OR status LIKE ?)
        LIMIT 8
    ");
    $stmt->execute([$searchTerm, $searchTerm, $searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    // Search Orders
    $stmt = $pdo->prepare("
        SELECT o.order_id as id, o.reference_number as name,
               CONCAT(o.status, ' - Table ', COALESCE(rt.table_number, 'N/A')) as category,
               'orders.html' as url
        FROM orders o
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        WHERE o.reference_number LIKE ? OR o.customer_name LIKE ? OR rt.table_number LIKE ?
        ORDER BY o.ordered_at DESC LIMIT 8
    ");
    $stmt->execute([$searchTerm, $searchTerm, $searchTerm]);
    $results = array_merge($results, $stmt->fetchAll());

    echo json_encode(['success' => true, 'results' => $results]);
} catch (PDOException $e) {
    error_log('waiter search error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Search failed. Please try again.']);
}