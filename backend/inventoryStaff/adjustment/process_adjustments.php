<?php
header('Content-Type: application/json; charset=utf-8');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../inventory_helpers.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';
require_once __DIR__ . '/../../secret.php';

try {
    $authHeader = '';
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        $authHeader = trim($_SERVER['HTTP_AUTHORIZATION']);
    } elseif (function_exists('apache_request_headers')) {
        $requestHeaders = apache_request_headers();
        $requestHeaders = array_combine(array_map('ucwords', array_keys($requestHeaders)), array_values($requestHeaders));
        if (isset($requestHeaders['Authorization'])) {
            $authHeader = trim($requestHeaders['Authorization']);
        }
    }

    if (empty($authHeader) || !preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        throw new Exception("Unauthorized access.");
    }

    $jwt = $matches[1];
    $tokenParts = explode('.', $jwt);
    if (count($tokenParts) !== 3) {
        throw new Exception("Unauthorized: Invalid authentication structure.");
    }

    list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $tokenParts;

    $signature = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlSignature));
    $expectedSignature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, JWT_SECRET, true);

    if (!hash_equals($signature, $expectedSignature)) {
        throw new Exception("Unauthorized: Crypto token verification failed.");
    }

    $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlPayload)), true);
    if (!$payload || ($payload['exp'] ?? 0) < time()) {
        throw new Exception("User session expired. Please log in again.");
    }

    $userId = (int)$payload['user_id'];

    $input = json_decode(file_get_contents('php://input'), true);

    if (!$input || empty($input['items'])) {
        throw new Exception('No adjustment data received.');
    }

    $pdo->beginTransaction();

    $adjType = $input['type'];
    $adjDate = $input['date'];
    $reason = $input['reason'];
    $items = $input['items'];

    $stmt = $pdo->prepare("INSERT INTO adjustments 
        (user_id, adjustment_type, reason, adjustment_date, status, created_at) 
        VALUES (?, ?, ?, ?, 'PENDING', NOW())");
    $stmt->execute([$userId, $adjType, $reason, $adjDate]);

    $adjustmentId = $pdo->lastInsertId();

    foreach ($items as $item) {
        $materialId = $item['raw_material_id'];
        $qty = floatval($item['quantity']);

        $stmtItem = $pdo->prepare("INSERT INTO adjustment_items 
            (adjustment_id, raw_material_id, quantity, created_at) 
            VALUES (?, ?, ?, NOW())");
        $stmtItem->execute([$adjustmentId, $materialId, $qty]);

        if (strtoupper(trim($adjType)) === 'ADD') {
            $stmtSI = $pdo->prepare("INSERT INTO stock_in 
                (supplier_id, user_id, stock_in_date, remarks, status, created_at)
                VALUES (NULL, ?, ?, CONCAT('ADJUSTMENT #', ?), 'Approved', NOW())");
            $stmtSI->execute([$userId, $adjDate, $adjustmentId]);
            $stockInId = $pdo->lastInsertId();

            $stmtSII = $pdo->prepare("INSERT INTO stock_in_items 
                (stock_in_id, raw_material_id, quantity, unit_cost, expiration_date, is_deleted)
                VALUES (?, ?, ?, 0, NULL, 0)");
            $stmtSII->execute([$stockInId, $materialId, $qty]);
        }
    }

    $pdo->commit();

    hof_notify_roles($pdo, 'pending_approval', 'Adjustment Approval Needed',
        "Inventory adjustment #$adjustmentId (" . strtoupper($adjType) . ") is awaiting your approval.",
        ['Supervisor'], '/public/supervisor/supervisor_approvals.html');

    echo json_encode([
        'status' => 'success',
        'success' => true,
        'message' => 'Adjustment logged and waiting for admin approval.'
    ]);
} catch (Exception $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('process_adjustments error: ' . $e->getMessage());
    echo json_encode([
        'status' => 'error',
        'success' => false,
        'message' => 'An unexpected database error occurred.'
    ]);
}