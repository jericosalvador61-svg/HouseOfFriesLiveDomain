<?php
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../log_activity_helper.php';
header('Content-Type: application/json');

$auth = authenticate(['Admin']);

$data = json_decode(file_get_contents("php://input"), true);

if (!$data || empty($data['items'])) {
    echo json_encode(['status' => 'error', 'message' => 'No data received.']);
    exit;
}

try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare("
        INSERT INTO stock_out (user_id, stock_out_date, remarks, status, approved_by, approved_at) 
        VALUES (?, ?, ?, 'APPROVED', ?, NOW())
    ");
    $stmt->execute([
        $auth['user_id'],
        $data['date'],
        $data['remarks'],
        $auth['user_id']
    ]);

    $stockOutId = $pdo->lastInsertId();

    $stmtItem = $pdo->prepare("
        INSERT INTO stock_out_items (stock_out_id, raw_material_id, quantity) 
        VALUES (?, ?, ?)
    ");

    $stmtUpdateStock = $pdo->prepare("
        UPDATE raw_materials 
        SET current_quantity = current_quantity - ?, 
            updated_at = NOW() 
        WHERE raw_material_id = ?
    ");

    foreach ($data['items'] as $item) {
        $materialId = $item['id'];
        $qtyToDeduct = floatval($item['quantity']);

        $stmtItem->execute([
            $stockOutId,
            $materialId,
            $qtyToDeduct
        ]);

        hof_deduct_fifo($pdo, $materialId, $qtyToDeduct);

        $stmtUpdateStock->execute([
            $qtyToDeduct,
            $materialId
        ]);
    }

    $pdo->commit();

    $touchedIds = array_map(function ($i) { return $i['id']; }, $data['items']);
    hof_check_low_stock($pdo, $touchedIds);

    $soParts = [];
    foreach ($data['items'] as $item) {
        $mid = $item['id'];
        $qty = floatval($item['quantity']);
        $mnStmt = $pdo->prepare("SELECT raw_material_name FROM raw_materials WHERE raw_material_id = ?");
        $mnStmt->execute([$mid]);
        $mName = $mnStmt->fetchColumn();
        $soParts[] = "{$mName} x{$qty}";
    }
    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'STOCK_OUT', "Stock out " . implode(', ', $soParts),
        'raw_material', (int)$data['items'][0]['id']);

    echo json_encode(['status' => 'success', 'message' => 'Stock out processed and inventory updated via FIFO.']);
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(500);
    error_log('process_stock_out error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}
