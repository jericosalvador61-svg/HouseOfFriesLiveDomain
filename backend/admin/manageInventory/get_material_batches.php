<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin', 'Supervisor', 'Inventory Staff']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

if (!isset($_GET['raw_material_id'])) {
    echo json_encode(['status' => 'error', 'message' => 'Missing material ID parameter.']);
    exit;
}

$materialId = intval($_GET['raw_material_id']);

try {
    // 1. Fetch the actual live warehouse stock counter for reference
    $stockStmt = $pdo->prepare("SELECT current_quantity FROM raw_materials WHERE raw_material_id = :material_id");
    $stockStmt->execute(['material_id' => $materialId]);
    $currentLiveStock = floatval($stockStmt->fetchColumn());

    // If live total stock is 0 or less, don't show any active batches at all
    if ($currentLiveStock <= 0) {
        echo json_encode([
            'status' => 'success',
            'batches' => []
        ]);
        exit;
    }

    // 2. Fetch active records that actually contain physical inventory items left (quantity > 0)
    // Sorted by FIFO / Expiration rules so your display sequence matches your warehouse shelves
    $stmt = $pdo->prepare("
        SELECT 
            si.stock_in_id AS reference_number, 
            si.stock_in_date, 
            sii.quantity, 
            sii.expiration_date,
            DATEDIFF(sii.expiration_date, CURDATE()) AS days_left
        FROM stock_in_items sii
        JOIN stock_in si ON sii.stock_in_id = si.stock_in_id
        WHERE sii.raw_material_id = :material_id
          AND sii.is_deleted = 0
          AND sii.quantity > 0  -- 🌟 THE MAIN FIX: Drops depleted items completely before processing
          AND (si.status = 'Approved' OR si.status = 'Completed' OR si.status = 'Received')
        ORDER BY sii.expiration_date ASC, si.stock_in_date ASC, sii.stock_in_item_id ASC
    ");

    $stmt->execute(['material_id' => $materialId]);
    $batches = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 3. Output the true active rows directly
    echo json_encode([
        'status' => 'success',
        'batches' => $batches
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Database query execution failure.',
        'debug' => $e->getMessage()
    ]);
}
