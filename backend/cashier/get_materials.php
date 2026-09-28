<?php
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Cashier', 'Admin']);
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

try {
    // 1. Get the list of materials (Keep ORDER BY raw_material_name ASC so your main table stays clean!)
    $stmt = $pdo->query("
        SELECT raw_material_id, raw_material_name, description, unit, 
               current_quantity, reorder_level, status, is_perishable, img_url, updated_at
        FROM raw_materials
        ORDER BY raw_material_name ASC
    ");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 2. Get Stats for the 4 Cards
    $totalItems = count($materials);

    // Low Stock
    $stmtLow = $pdo->query("
        SELECT COUNT(*) 
        FROM raw_materials 
        WHERE current_quantity > 0 
        AND current_quantity <= reorder_level
    ");
    $lowStock = $stmtLow->fetchColumn();

    // Out of Stock
    $stmtOut = $pdo->query("SELECT COUNT(*) FROM raw_materials WHERE current_quantity <= 0");
    $outStock = $stmtOut->fetchColumn();

    // --- Damaged/Spoilage Stat ---
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
    echo json_encode(['status' => 'error', 'message' => $e->getMessage()]);
}
