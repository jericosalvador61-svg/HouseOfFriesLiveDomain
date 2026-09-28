<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Inventory Staff', 'Admin', 'Supervisor']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

if (!isset($_GET['raw_material_id'])) {
    echo json_encode(['status' => 'error', 'message' => 'Missing material ID parameter.']);
    exit;
}

$materialId = intval($_GET['raw_material_id']);

try {
    // 1. Get the ACTUAL current warehouse balance first
    $stockStmt = $pdo->prepare("SELECT current_quantity FROM raw_materials WHERE raw_material_id = :material_id");
    $stockStmt->execute(['material_id' => $materialId]);
    $currentLiveStock = floatval($stockStmt->fetchColumn());

    // If live total stock is 0, don't show any active batches at all
    if ($currentLiveStock <= 0) {
        echo json_encode([
            'status' => 'success',
            'batches' => []
        ]);
        exit;
    }

    // 2. Fetch active records chronologically by expiration date
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
          AND sii.quantity > 0
          AND (si.status = 'Approved' OR si.status = 'Completed' OR si.status = 'Received')
        ORDER BY sii.expiration_date ASC, si.stock_in_date ASC
    ");

    $stmt->execute(['material_id' => $materialId]);
    $rawBatches = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $validBatches = [];
    $runningStockCounter = $currentLiveStock;

    // 3. Match historical batches against the true available stock
    foreach ($rawBatches as $batch) {
        if ($runningStockCounter <= 0) {
            break; // Stop including older rows as soon as our live balance runs out
        }

        $batchQty = floatval($batch['quantity']);

        if ($runningStockCounter >= $batchQty) {
            // The remaining live stock covers this entire batch row
            $validBatches[] = $batch;
            $runningStockCounter -= $batchQty;
        } else {
            // This batch is only partially left in stock
            $batch['quantity'] = $runningStockCounter;
            $validBatches[] = $batch;
            $runningStockCounter = 0; // All live stock allocated
        }
    }

    echo json_encode([
        'status' => 'success',
        'batches' => $validBatches
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Database query execution failure.',
        'debug' => $e->getMessage()
    ]);
}
