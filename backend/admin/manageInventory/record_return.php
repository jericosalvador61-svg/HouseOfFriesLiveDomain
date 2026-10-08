<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['status' => 'error', 'message' => 'Invalid request method.']);
    exit;
}

// REQ-068: Admin + Supervisor record returns DIRECTLY (approved, stock restored now).
$auth = authenticate(['Admin', 'Supervisor']);

$return_date = $_POST['return_date'] ?? date('Y-m-d');
$reason      = $_POST['reason'] ?? '';
$return_type = $_POST['return_type'] ?? 'OTHER';
$ref_number  = 'RET-' . strtoupper(uniqid());

try {
    $pdo->beginTransaction();

    if (!isset($_POST['material_id']) || !is_array($_POST['material_id'])) {
        throw new Exception("No return items received.");
    }

    // Admin/Supervisor-recorded return = APPROVED immediately.
    $stmt = $pdo->prepare("
        INSERT INTO returns 
        (user_id, status, reference_number, return_date, reason, return_type, approved_by, approved_at, created_at)
        VALUES (?, 'APPROVED', ?, ?, ?, ?, ?, NOW(), NOW())
    ");
    $stmt->execute([$auth['user_id'], $ref_number, $return_date, $reason, $return_type, $auth['user_id']]);
    $return_id = $pdo->lastInsertId();

    $itemStmt = $pdo->prepare("
        INSERT INTO return_items (return_id, raw_material_id, quantity, unit_cost, created_at)
        VALUES (?, ?, ?, ?, NOW())
    ");
    $updateStock = $pdo->prepare("
        UPDATE raw_materials SET current_quantity = current_quantity + ?, updated_at = NOW()
        WHERE raw_material_id = ?
    ");

    foreach ($_POST['material_id'] as $index => $material_id) {
        $qty  = (float)($_POST['quantity'][$index] ?? 0);
        $cost = (float)($_POST['unit_cost'][$index] ?? 0);

        $itemStmt->execute([$return_id, $material_id, $qty, $cost]);
        // REQ-068: stock is restored immediately (no separate approval needed).
        $updateStock->execute([$qty, $material_id]);
    }

    $pdo->commit();

    $retParts = [];
    foreach ($_POST['material_id'] as $i => $mid) {
        $qty = (float)($_POST['quantity'][$i] ?? 0);
        $mnStmt = $pdo->prepare("SELECT raw_material_name FROM raw_materials WHERE raw_material_id = ?");
        $mnStmt->execute([$mid]);
        $mName = $mnStmt->fetchColumn();
        $retParts[] = "{$mName} x{$qty}";
    }
    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'RETURN', "Return: " . implode(', ', $retParts) . " (auto-approved)",
        'raw_material', (int)$_POST['material_id'][0]);

    echo json_encode(['status' => 'success', 'message' => 'Return recorded and stock restored.']);
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('record_return error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}
