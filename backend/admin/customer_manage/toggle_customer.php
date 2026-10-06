<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin', 'Supervisor']);
$data = json_decode(file_get_contents("php://input"), true);
$id = (int)($data['customer_id'] ?? 0);
if ($id <= 0) { http_response_code(422); echo json_encode(['success' => false, 'message' => 'Invalid customer.']); exit; }
try {
    $stmt = $pdo->prepare("UPDATE customers SET is_active = 1 - is_active WHERE customer_id = ?");
    $stmt->execute([$id]);
    $chk = $pdo->prepare("SELECT is_active FROM customers WHERE customer_id = ?");
    $chk->execute([$id]);
    $active = (int)$chk->fetchColumn();
    echo json_encode(['success' => true, 'message' => $active ? 'Customer reactivated.' : 'Customer deactivated.']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Update failed.']);
}
