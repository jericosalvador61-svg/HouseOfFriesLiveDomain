<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Inventory Staff', 'Admin', 'Supervisor']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    // 1. Get the list of materials
    $stmt = $pdo->query("
        SELECT raw_material_id, raw_material_name, description, unit, 
               current_quantity, reorder_level, status, is_perishable, img_url, updated_at
        FROM raw_materials
        ORDER BY raw_material_name ASC
    ");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 2. Get Stats for the 4 Cards
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

    // Damaged = COUNT of PENDING spoilage/waste/damage (shared KPI definition)
    $stmtDamaged = $pdo->query("SELECT COUNT(*) FROM spoilage WHERE status = 'PENDING' AND spoilage_type IN ('SPOILAGE','WASTE','DAMAGE')");
    $damagedTotal = (int)$stmtDamaged->fetchColumn();

    // 3. RECENT SPOILAGE FEED
    $stmtRecentSpoilage = $pdo->query("
        SELECT s.spoilage_date, r.raw_material_name, s.quantity_lost, r.unit, s.spoilage_type 
        FROM spoilage s
        JOIN raw_materials r ON s.raw_material_id = r.raw_material_id
        ORDER BY s.spoilage_date DESC, s.spoilage_id DESC 
        LIMIT 5
    ");
    $recentSpoilage = $stmtRecentSpoilage->fetchAll(PDO::FETCH_ASSOC);

    // ====================================================================
    // 4. BATCH EXPIRATION WATCHLIST (OPTIMIZED AND GROUP-FIXED)
    // ====================================================================
    $stmtExpiration = $pdo->query("
        SELECT 
            sii.raw_material_id,
            rm.raw_material_name,
            rm.unit,
            MIN(sii.expiration_date) AS expiration_date, -- 🌟 Finds the closest upcoming expiration date lot
            SUM(sii.quantity) AS total_batch_quantity,    -- 🌟 Combines active remaining stock values
            DATEDIFF(MIN(sii.expiration_date), CURDATE()) AS days_left
        FROM stock_in_items sii
        JOIN raw_materials rm ON sii.raw_material_id = rm.raw_material_id
        JOIN stock_in si ON sii.stock_in_id = si.stock_in_id
        WHERE rm.is_perishable = 1 
          AND sii.expiration_date IS NOT NULL 
          AND sii.is_deleted = 0
          AND sii.quantity > 0  -- Filters out dead, fully stocked-out entry line rows
          AND (si.status = 'Approved' OR si.status = 'Completed' OR si.status = 'Received')
          AND sii.expiration_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY sii.raw_material_id, rm.raw_material_name, rm.unit -- 🌟 REMOVED expiration_date from here!
        HAVING total_batch_quantity > 0 -- 🌟 DOUBLE SAFETY: Guarantees zeroed items drop completely
        ORDER BY days_left ASC
        LIMIT 5
    ");
    $expirationWatch = $stmtExpiration->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'status' => 'success',
        'data' => $materials,
        'recent_spoilage' => $recentSpoilage,
        'expiration_watchlist' => $expirationWatch,
        'stats' => [
            'total' => $totalItems,
            'low' => (int)$lowStock,
            'out' => (int)$outStock,
            'damaged' => (int)$damagedTotal
        ]
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Database operation trace failure.',
        'debug_details' => $e->getMessage()
    ]);
}
