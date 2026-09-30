<?php
/**
 * Cashier endpoint: list active discount types for the counter discount modal (REQ-049).
 * Auth: Cashier, Admin.
 * Returns only is_active = 1 types (id, name, percent).
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';

authenticate(['Cashier', 'Admin']);

try {
    $stmt = $pdo->prepare("
        SELECT discount_type_id, name, percent
        FROM discount_types
        WHERE is_active = 1
        ORDER BY discount_type_id ASC
    ");
    $stmt->execute();
    echo json_encode([
        'success' => true,
        'types'   => $stmt->fetchAll(PDO::FETCH_ASSOC)
    ]);
} catch (Exception $e) {
    error_log('get_discount_types error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}
