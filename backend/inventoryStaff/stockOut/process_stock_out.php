<?php
// backend/inventoryStaff/stockOut/process_stock_out.php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../secret.php'; // Secret cryptographic key location

try {
    // ─── STATELESS JWT SECURITY BLOCK ───
    $authHeader = '';
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }
    if (empty($authHeader)) {
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $authHeader = trim($_SERVER['HTTP_AUTHORIZATION']);
        } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $authHeader = trim($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
        }
    }

    if (empty($authHeader) || !preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        throw new Exception("Unauthorized access. Token context not discovered.");
    }

    $jwt = $matches[1];
    $tokenParts = explode('.', $jwt);
    if (count($tokenParts) !== 3) {
        throw new Exception("Unauthorized: Invalid authentication structure.");
    }

    list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $tokenParts;

    // Validate Signature Match
    $signature = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlSignature));
    $expectedSignature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, JWT_SECRET, true);

    if (!hash_equals($signature, $expectedSignature)) {
        throw new Exception("Unauthorized: Token key verification failed.");
    }

    // Parse Payload and Verify Expiration
    $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlPayload)), true);
    if (!$payload || ($payload['exp'] ?? 0) < time()) {
        throw new Exception("User session expired. Please log in again.");
    }

    // Assign validated payload property to operation variable
    $userId = (int)$payload['user_id'];

    // ─── TRANSACTION PROCESSING ENGINE ───
    $data = json_decode(file_get_contents("php://input"), true);

    if (!$data || empty($data['items'])) {
        throw new Exception("No data received.");
    }

    $pdo->beginTransaction();

    // 1. Insert into stock_out table with PENDING status
    $stmt = $pdo->prepare("
        INSERT INTO stock_out (user_id, stock_out_date, remarks, status) 
        VALUES (?, ?, ?, 'PENDING')
    ");
    $stmt->execute([
        $userId,
        $data['date'],
        $data['remarks']
    ]);

    $stockOutId = $pdo->lastInsertId();

    // 2. Process each item requested for stock out using FIFO
    $stmtItem = $pdo->prepare("
        INSERT INTO stock_out_items (stock_out_id, raw_material_id, quantity) 
        VALUES (?, ?, ?)
    ");

    foreach ($data['items'] as $item) {
        $materialId = $item['id'];
        $requestedQty = floatval($item['quantity']);

        // --- FIFO BATCH CALCULATION GATEWAY ---
        $stmtBatches = $pdo->prepare("
            SELECT sii.stock_in_item_id, sii.quantity, si.stock_in_date
            FROM stock_in_items sii
            JOIN stock_in si ON sii.stock_in_id = si.stock_in_id
            WHERE sii.raw_material_id = ? 
              AND sii.is_deleted = 0
              AND si.status = 'Approved'
              AND sii.quantity > 0
            ORDER BY si.stock_in_date ASC, si.stock_in_id ASC
        ");
        $stmtBatches->execute([$materialId]);
        $availableBatches = $stmtBatches->fetchAll(PDO::FETCH_ASSOC);

        $totalAvailableInBatches = array_sum(array_column($availableBatches, 'quantity'));
        if ($totalAvailableInBatches < $requestedQty) {
            throw new Exception("Insufficient stock in active batches for material ID {$materialId}. Requested: {$requestedQty}, Available: {$totalAvailableInBatches}");
        }

        $remainingToAllocate = $requestedQty;

        foreach ($availableBatches as $batch) {
            if ($remainingToAllocate <= 0) break;

            $batchId = $batch['stock_in_item_id'];
            $batchAvailableQty = floatval($batch['quantity']);
            $takeFromThisBatch = min($remainingToAllocate, $batchAvailableQty);

            $remainingToAllocate -= $takeFromThisBatch;
        }

        // Insert primary item record linked to this pending checkout request
        $stmtItem->execute([
            $stockOutId,
            $materialId,
            $requestedQty
        ]);
    }

    $pdo->commit();

    // Notify Supervisor: stock out request awaiting approval
    hof_notify_roles($pdo, 'pending_approval', 'Stock Out Approval Needed',
        "Stock Out request #$stockOutId is awaiting your approval.",
        ['Supervisor'], '/public/supervisor/supervisor_approvals.html');

    echo json_encode(['status' => 'success', 'message' => 'Stock out request submitted sequentially (FIFO checked) and is now pending approval.']);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    http_response_code(400);
    error_log('process_stock_out error: ' . $e->getMessage());
    echo json_encode(['status' => 'error', 'message' => 'An unexpected database error occurred.']);
}