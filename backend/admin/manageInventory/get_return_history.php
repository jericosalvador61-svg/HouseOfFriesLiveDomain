<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin', 'Supervisor', 'Inventory Staff']);
header('Content-Type: application/json');
require_once __DIR__ . '/../../db.php';

try {
    $stmt = $pdo->query("
        SELECT 
            r.return_id,
            r.reference_number,
            r.return_date,
            r.return_type,
            r.reason,
            r.status,
            r.created_at,
            CONCAT(u.first_name, ' ', u.last_name) AS submitted_by,
            ri.return_item_id,
            ri.raw_material_id,
            rm.raw_material_name,
            rm.unit,
            ri.quantity,
            ri.unit_cost
        FROM returns r
        JOIN users u ON r.user_id = u.user_id
        LEFT JOIN return_items ri ON r.return_id = ri.return_id AND ri.is_deleted = 0
        LEFT JOIN raw_materials rm ON ri.raw_material_id = rm.raw_material_id
        ORDER BY r.created_at DESC
    ");
    $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Group items by return_id
    $returns = [];
    foreach ($rows as $row) {
        $rid = $row['return_id'];
        if (!isset($returns[$rid])) {
            $returns[$rid] = [
                'return_id'       => $rid,
                'reference_number'=> $row['reference_number'],
                'return_date'     => $row['return_date'],
                'return_type'     => $row['return_type'],
                'reason'          => $row['reason'],
                'status'          => $row['status'],
                'created_at'      => $row['created_at'],
                'submitted_by'    => $row['submitted_by'],
                'items'           => []
            ];
        }
        if ($row['raw_material_id']) {
            $returns[$rid]['items'][] = [
                'item_id'    => $row['return_item_id'],
                'material_id'=> $row['raw_material_id'],
                'material'   => $row['raw_material_name'],
                'unit'       => $row['unit'],
                'quantity'   => $row['quantity'],
                'unit_cost'  => $row['unit_cost']
            ];
        }
    }

    echo json_encode(['success' => true, 'data' => array_values($returns)]);
} catch (Exception $e) {
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}