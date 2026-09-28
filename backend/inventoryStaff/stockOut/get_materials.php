<?php
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

$auth = authenticate(['Inventory Staff', 'Kitchen Staff', 'Supervisor', 'Admin']);

try {
    $stmt = $pdo->query("
        SELECT raw_material_id, raw_material_name, description, unit, 
               current_quantity, reorder_level, status, is_perishable, img_url, updated_at
        FROM raw_materials
        ORDER BY raw_material_name ASC
    ");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    foreach ($materials as &$mat) {
        $mat['available_batch_sum'] = hof_check_batch_total($pdo, (int)$mat['raw_material_id']);
    }
    unset($mat);

    $totalItems = count($materials);

    $stmtLow = $pdo->query("
        SELECT COUNT(*) 
        FROM raw_materials 
        WHERE current_quantity > 0 
        AND current_quantity <= reorder_level
    ");
    $lowStock = $stmtLow->fetchColumn();

    $stmtOut = $pdo->query("SELECT COUNT(*) FROM raw_materials WHERE current_quantity <= 0");
    $outStock = $stmtOut->fetchColumn();

    $stmtDamaged = $pdo->query("SELECT SUM(quantity_lost) FROM spoilage");
    $damagedTotal = $stmtDamaged->fetchColumn() ?: 0;

    echo json_encode([
        'status' => 'success',
        'data' => $materials,
        'stats' => [
            'total' => $totalItems,
            'low' => (int)$lowStock,
            'out' => (int)$outStock,
            'damaged' => (float)$damagedTotal
        ]
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    error_log('get_materials error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}
