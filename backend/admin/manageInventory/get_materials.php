<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin', 'Supervisor', 'Inventory Staff']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    // NOTE: INACTIVE rows are soft-deleted materials. The Manage Inventory UI
    // filters by mat.status client-side, so both ACTIVE + INACTIVE are returned
    // here and stats below exclude INACTIVE to match the visible table.
    $stmt = $pdo->query("
        SELECT raw_material_id, raw_material_name, description, unit, 
               current_quantity, reorder_level, status, is_perishable, img_url, updated_at
        FROM raw_materials
        ORDER BY raw_material_name ASC
    ");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // Stats count ACTIVE rows only (INACTIVE = soft-deleted, hidden by default filter)
    $totalItems = count(array_filter($materials, fn($m) => ($m['status'] ?? '') === 'ACTIVE'));

    // Low Stock (ACTIVE only)
    $stmtLow = $pdo->query("
        SELECT COUNT(*) 
        FROM raw_materials 
        WHERE status = 'ACTIVE'
        AND current_quantity > 0 
        AND current_quantity <= reorder_level
    ");
    $lowStock = $stmtLow->fetchColumn();

    // Out of Stock (ACTIVE only)
    $stmtOut = $pdo->query("SELECT COUNT(*) FROM raw_materials WHERE status = 'ACTIVE' AND current_quantity <= 0");
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
