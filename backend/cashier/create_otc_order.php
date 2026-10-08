<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../pusher_helper.php';

$auth = authenticate(['Cashier', 'Admin']);

// 1. Get the raw POST data payload from the fetch body
$data = json_decode(file_get_contents('php://input'), true);

// 2. Extract configurations with safe fallback defaults
$orderType    = isset($data['order_type']) ? $data['order_type'] : 'TAKE_OUT';
$tableId      = (!empty($data['table_id'])) ? $data['table_id'] : null;
$customerName = (!empty($data['customer_name'])) ? trim($data['customer_name']) : null; // Extract customer name safely

// TAKE_OUT orders require customer name
if (strtoupper(trim($orderType)) === 'TAKE_OUT' && ($customerName === null || $customerName === '')) {
    http_response_code(400);
    echo json_encode(['success' => false, 'blocked' => 'CUSTOMER_NAME', 'message' => 'Customer name required for takeout orders.']);
    exit;
}

try {
    $currentYear = date('Y');
    $prefix = "HOF" . $currentYear;

    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $pdo->beginTransaction();

        // REQ-068 M4-1: MAX+1 so refs never repeat when cancelled rows are
        // hard-deleted; COUNT+1 fallback when MAX is NULL. The 23000 retry loop
        // below is the collision backstop.
        $stmt = $pdo->prepare("SELECT COALESCE(MAX(CAST(SUBSTRING(reference_number, 8) AS UNSIGNED)), 0) FROM orders WHERE YEAR(created_at) = ?");
        $stmt->execute([$currentYear]);
        $count = (int)$stmt->fetchColumn() + 1;
        $newReference = $prefix . str_pad($count, 5, '0', STR_PAD_LEFT);

        $insertStmt = $pdo->prepare("
            INSERT INTO orders (reference_number, order_type, table_id, customer_name, subtotal_amount, total_amount, status, created_at) 
            VALUES (:reference_number, :order_type, :table_id, :customer_name, 0.00, 0.00, 'PENDING', NOW())
        ");

        try {
            $insertStmt->execute([
                'reference_number' => $newReference,
                'order_type'       => $orderType,
                'table_id'         => $tableId,
                'customer_name'    => $customerName
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() == 23000) {
                $pdo->rollBack();
                if ($attempt >= 3) {
                    throw $e;
                }
                continue;
            }
            throw $e;
        }

        $newOrderId = $pdo->lastInsertId();

        logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
            'ORDER_CREATED', "OTC {$orderType}" . ($customerName ? " for {$customerName}" : ''),
            'order', $newOrderId, $newReference);

        $pdo->commit();

        if (function_exists('broadcastOrderUpdate')) {
            broadcastOrderUpdate($newOrderId, "New Order #$newReference");
        }

        echo json_encode([
            'success' => true,
            'order_id' => $newOrderId,
            'reference_number' => $newReference
        ]);
        exit;
    } // end for
    throw new Exception('Failed to generate unique reference number after 3 attempts.');
} catch (PDOException $e) {
    error_log('create_otc_order error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}
