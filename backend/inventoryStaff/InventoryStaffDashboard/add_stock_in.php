<?php
header('Content-Type: application/json');
error_reporting(0);
require_once __DIR__ . "/../../db.php";

$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data) {
    echo json_encode(['success' => false, 'message' => 'No data received']);
    exit;
}

$user_id       = $_SESSION['user_id'] ?? null;
$supplier_id   = $data['supplier_id'] ?? null;
$stock_in_date = $data['stock_in_date'] ?? date('Y-m-d');
$remarks       = $data['remarks'] ?? '';
$total_cost    = $data['total_cost'] ?? 0;
$items         = $data['items'] ?? [];

if (!$user_id || !$supplier_id || empty($items)) {
    echo json_encode(['success' => false, 'message' => 'Missing required fields']);
    exit;
}

try {
    $pdo->beginTransaction();

    $stmt = $pdo->prepare("
        INSERT INTO stock_in 
        (supplier_id, user_id, stock_in_date, total_cost, remarks, status, created_at)
        VALUES (:supplier_id, :user_id, :stock_in_date, :total_cost, :remarks, 'Pending', NOW())
    ");
    $stmt->execute([
        ':supplier_id'   => $supplier_id,
        ':user_id'       => $user_id,
        ':stock_in_date' => $stock_in_date,
        ':total_cost'    => $total_cost,
        ':remarks'       => $remarks
    ]);
    $stock_in_id = $pdo->lastInsertId();

    $stmt_item = $pdo->prepare("
        INSERT INTO stock_in_items
        (stock_in_id, raw_material_id, quantity, unit_cost)
        VALUES (:stock_in_id, :raw_material_id, :quantity, :unit_cost)
    ");

    $stmt_new_raw = $pdo->prepare("
        INSERT INTO raw_materials
        (raw_material_name, description, image_url, unit, current_quantity, reorder_level, is_perishable, status, created_at)
        VALUES (:name, :desc, :image, :unit, 0, 0, 'No', 'Inactive', NOW())
    ");

    foreach ($items as $item) {
        if (!isset($item['raw_material_id'], $item['qty'], $item['cost'])) {
            throw new Exception("Invalid item data");
        }

        $raw_material_id = $item['raw_material_id'];

        if ($raw_material_id === "new") {
            $stmt_new_raw->execute([
                ':name'  => $item['stockName'],
                ':desc'  => $item['desc'] ?? '',
                ':image' => '',
                ':unit'  => $item['unit'] ?? ''
            ]);
            $raw_material_id = (int)$pdo->lastInsertId();
        }

        $raw_material_id = (int)$raw_material_id;

        $stmt_item->execute([
            ':stock_in_id'     => $stock_in_id,
            ':raw_material_id' => $raw_material_id,
            ':quantity'        => $item['qty'],
            ':unit_cost'       => $item['cost']
        ]);
    }


    $pdo->commit();

    echo json_encode([
        'success' => true,
        'message' => 'Stock In submitted successfully',
        'stock_in_id' => $stock_in_id
    ]);
} catch (Exception $e) {
    $pdo->rollBack();
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}