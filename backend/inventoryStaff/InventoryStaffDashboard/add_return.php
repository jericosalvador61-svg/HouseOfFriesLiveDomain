<?php
require_once __DIR__ . '/../../auth_middleware.php';
header('Content-Type: application/json');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../log_activity_helper.php'; // REQ-050

$auth = authenticate(['Inventory Staff', 'Admin', 'Supervisor']);
$user_id = (int)$auth['user_id'];

$data = json_decode(file_get_contents('php://input'), true);
if (!$data || empty($data['items'])) {
    echo json_encode(['success' => false, 'message' => 'No items data received']);
    exit;
}

$return_date = $data['return_date'] ?? date('Y-m-d');
$reason      = $data['reason'] ?? '';
$return_type = $data['return_type'] ?? 'OTHER';
$items       = $data['items'];
$ref_number  = 'RET-' . strtoupper(uniqid());

try {
    $pdo->beginTransaction();

    // Insert return header
    $stmt = $pdo->prepare("
        INSERT INTO returns 
        (user_id, status, reference_number, return_date, reason, return_type, created_at)
        VALUES (?, 'PENDING', ?, ?, ?, ?, NOW())
    ");
    $stmt->execute([$user_id, $ref_number, $return_date, $reason, $return_type]);
    $return_id = $pdo->lastInsertId();

    // Insert return items
    $itemStmt = $pdo->prepare("
        INSERT INTO return_items
        (return_id, raw_material_id, quantity, unit_cost, created_at)
        VALUES (?, ?, ?, ?, NOW())
    ");

    foreach ($items as $item) {
        if (!isset($item['raw_material_id'], $item['quantity'])) {
            throw new Exception("Invalid item data");
        }
        $itemStmt->execute([
            $return_id,
            (int)$item['raw_material_id'],
            (float)$item['quantity'],
            (float)($item['unit_cost'] ?? 0)
        ]);
    }

    $pdo->commit();

    // REQ-050: log return request (PENDING)
    logActivity($pdo, $user_id, $auth['username'] ?? 'inventory', $auth['role'] ?? 'Inventory Staff', 'RETURN',
        "Return request {$ref_number} submitted (pending approval)",
        'return', (int)$return_id, $ref_number, 'PENDING', null, "return_type " . ($return_type ?: 'OTHER'));

    echo json_encode([
        'success' => true,
        'message' => 'Return request submitted for approval',
        'reference_number' => $ref_number
    ]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}