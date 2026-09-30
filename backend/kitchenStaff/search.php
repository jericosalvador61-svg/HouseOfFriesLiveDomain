<?php
/**
 * Kitchen Staff Search API
 * Searches: active orders (by reference number, customer name, table number)
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
header('Content-Type: application/json');

authenticate(['Kitchen Staff', 'Admin', 'Supervisor']);
$query = trim($_GET['q'] ?? '');
if (strlen($query) < 2) {
    echo json_encode(['success' => true, 'results' => []]);
    exit;
}

$searchTerm = "%{$query}%";

try {
    // Search Orders (Cooking, In-Progress, Pending) with table number from restaurant_table
    $stmt = $pdo->prepare("
        SELECT o.order_id as id, o.reference_number as name, 
               o.status as category,
               CONCAT('Table ', rt.table_number) as table_number, o.order_type,
               'kitchen_dashboard.html' as url
        FROM orders o
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        WHERE (o.reference_number LIKE ? OR o.customer_name LIKE ? OR rt.table_number LIKE ?)
          AND o.status IN ('COOKING', 'IN-PROGRESS', 'PENDING')
        ORDER BY 
            CASE o.status WHEN 'COOKING' THEN 1 WHEN 'IN-PROGRESS' THEN 2 ELSE 3 END,
            o.ordered_at ASC
        LIMIT 10
    ");
    $stmt->execute([$searchTerm, $searchTerm, $searchTerm]);
    $results = $stmt->fetchAll();

    echo json_encode(['success' => true, 'results' => $results]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
