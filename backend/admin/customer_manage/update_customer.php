<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin', 'Supervisor']);
$data = json_decode(file_get_contents("php://input"), true);
$id = (int)($data['customer_id'] ?? 0);
$name = trim($data['name'] ?? '');
$phone = trim($data['phone_number'] ?? '');
if ($id <= 0 || $name === '' || $phone === '') { http_response_code(422); echo json_encode(['success' => false, 'message' => 'Name and phone number are required.']); exit; }
try {
    $chk = $pdo->prepare("SELECT customer_id FROM customers WHERE phone_number = ? AND customer_id <> ?");
    $chk->execute([$phone, $id]);
    if ($chk->fetch()) { http_response_code(409); echo json_encode(['success' => false, 'message' => 'Phone number already registered.']); exit; }
    $stmt = $pdo->prepare("UPDATE customers SET name = ?, phone_number = ? WHERE customer_id = ?");
    $stmt->execute([$name, $phone, $id]);
    echo json_encode(['success' => true, 'message' => 'Customer updated.']);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Could not update the customer.']);
}
