<?php
/**
 * backend/waiter/get_takeout_table.php
 * Returns the first AVAILABLE takeout table id used as the take-out anchor.
 */
header('Content-Type: application/json');

require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../db.php';

authenticate(['Waiter', 'Admin', 'Supervisor']);

try {
    $stmt = $pdo->prepare("
        SELECT table_id
        FROM restaurant_table
        WHERE table_type = 'TAKEOUT' AND is_deleted = 0 AND status = 'AVAILABLE'
        ORDER BY table_id ASC
        LIMIT 1
    ");
    $stmt->execute();
    $table = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($table) {
        echo json_encode(['success' => true, 'table_id' => (int)$table['table_id']]);
    } else {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'No available takeout table is configured. Please ask an administrator.']);
    }
} catch (PDOException $e) {
    error_log('get_takeout_table error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to resolve a takeout table.']);
}