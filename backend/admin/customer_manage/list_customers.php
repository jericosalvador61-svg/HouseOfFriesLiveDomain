<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin', 'Supervisor']);
try {
    $stmt = $pdo->prepare("SELECT customer_id, phone_number, name, is_active, last_login_at, created_at, updated_at FROM customers ORDER BY created_at DESC");
    $stmt->execute();
    echo json_encode(['success' => true, 'customers' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load customers.']);
}
