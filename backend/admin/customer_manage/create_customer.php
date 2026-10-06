<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin', 'Supervisor']);
$data = json_decode(file_get_contents("php://input"), true);
$name = trim($data['name'] ?? '');
$phone = trim($data['phone_number'] ?? '');
if ($name === '' || $phone === '') { http_response_code(422); echo json_encode(['success' => false, 'message' => 'Name and phone number are required.']); exit; }
try {
    $chk = $pdo->prepare("SELECT customer_id FROM customers WHERE phone_number = ?");
    $chk->execute([$phone]);
    if ($chk->fetch()) { http_response_code(409); echo json_encode(['success' => false, 'message' => 'Phone number already registered.']); exit; }
    $hash = password_hash(bin2hex(random_bytes(4)), PASSWORD_DEFAULT);
    $stmt = $pdo->prepare("INSERT INTO customers (phone_number, name, password_hash, is_active) VALUES (?, ?, ?, 1)");
    $stmt->execute([$phone, $name, $hash]);
    echo json_encode(['success' => true, 'message' => 'Customer created. Generate a reset code so they can set a password.', 'customer_id' => (int)$pdo->lastInsertId()]);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Could not create the customer.']);
}
