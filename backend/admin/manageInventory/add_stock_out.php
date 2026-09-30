<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php'; // REQ-050

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['status' => 'error', 'message' => 'Method not allowed']);
    exit;
}

try {
    $auth = authenticate(['Admin']);

    $input = json_decode(file_get_contents("php://input"), true);

    if (!$input) {
        throw new Exception("No payload data received.");
    }

    $stock_out_date = $input['date'] ?? '';
    $remarks = $input['remarks'] ?? '';
    $items = $input['items'] ?? [];

    if ($stock_out_date === '' || empty($items)) {
        http_response_code(400);
        echo json_encode(['status' => 'error', 'message' => 'Date and at least one material item are required']);
        exit;
    }

    $ref = 'SO-' . date('YmdHis');

    $pdo->beginTransaction();

    $stmt = $pdo->prepare("
        INSERT INTO stock_out (user_id, stock_out_date, remarks, status)
        VALUES (:user_id, :stock_out_date, :remarks, 'APPROVED')
    ");
    $stmt->execute([
        ':user_id' => $auth['user_id'],
        ':stock_out_date' => $stock_out_date,
        ':remarks' => $remarks
    ]);

    $stock_out_id = $pdo->lastInsertId();

    $stmtItem = $pdo->prepare("
        INSERT INTO stock_out_items (stock_out_id, raw_material_id, quantity)
        VALUES (:stock_out_id, :mat_id, :qty)
    ");

    $stmtUpdate = $pdo->prepare("
        UPDATE raw_materials 
        SET current_quantity = current_quantity - :qty 
        WHERE raw_material_id = :mat_id
    ");

    foreach ($items as $item) {
        $mat_id = $item['id'] ?? null;
        $qty = floatval($item['quantity'] ?? 0);

        if (!$mat_id || $qty <= 0) continue;

        $stmtItem->execute([
            ':stock_out_id' => $stock_out_id,
            ':mat_id' => $mat_id,
            ':qty' => $qty
        ]);

        hof_deduct_fifo($pdo, $mat_id, $qty);

        $stmtUpdate->execute([
            ':qty' => $qty,
            ':mat_id' => $mat_id
        ]);
    }

    $pdo->commit();

    hof_check_low_stock($pdo, array_map(function ($i) { return intval($i['id'] ?? 0); }, $items));

    // REQ-050: log admin auto-approved stock out
    logActivity($pdo, (int)$auth['user_id'], $auth['username'] ?? 'admin', $auth['role'] ?? 'Admin', 'STOCK_OUT',
        "Stock out {$ref} recorded (auto-approved)",
        'stock_out', (int)$stock_out_id, $ref, 'APPROVED', null, "remarks " . ($remarks ?: 'none'));

    echo json_encode(['status' => 'success', 'message' => 'Stock Out recorded successfully']);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    error_log('add_stock_out error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}