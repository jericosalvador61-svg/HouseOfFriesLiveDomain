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
    // UPDATED QUERY: Fixed table filters and added structural data safety rules
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
          AND sii.quantity > 0  -- 🌟 THE KEY FIX: Stops 0 stock rows from rendering inside your popup!
          AND (si.status = 'Approved' OR si.status = 'Completed' OR si.status = 'Received')
        ORDER BY sii.expiration_date ASC
    ");

    $stmt->execute(['material_id' => $materialId]);
    $batches = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode([
        'status' => 'success',
        'batches' => $batches
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Database query execution failure.',
        'debug' => $e->getMessage() // 🌟 HELPFUL: Displays the raw SQL error message in DevTools for easier debugging
    ]);
}
