<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';

try {
    // Fetch active tables where is_deleted is 0
    $stmt = $pdo->query("SELECT table_id, table_number FROM restaurant_table WHERE is_deleted = 0 ORDER BY table_number ASC");
    $tables = $stmt->fetchAll();
    
    echo json_encode(['success' => true, 'tables' => $tables]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error: ' . $e->getMessage()]);
}
?>