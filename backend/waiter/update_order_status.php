<?php
/**
 * HOF Waiter API - Update Order Status
 * Note: Kitchen controls PENDING -> IN-PROGRESS -> COOKING -> COMPLETED
 * Waiter can update: COMPLETED -> SERVED
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../pusher_helper.php';
require_once __DIR__ . '/../rate_limit.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
header('Content-Type: application/json');

// Rate limit: 20 status updates per 60 seconds per IP
hof_rate_limit('waiter_update_status', 20, 60);
$auth = authenticate(['Waiter', 'Admin', 'Supervisor', 'Cashier']);

try {
    $data = json_decode(file_get_contents('php://input'), true);
    $orderId = (int)($data['order_id'] ?? 0);
    $status = strtoupper(trim($data['status'] ?? ''));
    
    if (!$orderId || !$status) {
        echo json_encode(['success' => false, 'message' => 'Invalid input']);
        exit;
    }

    // Validate allowed transitions for waiter
    $validTransitions = [
        'COMPLETED' => 'SERVED'
    ];

    $stmt = $pdo->prepare("SELECT status FROM orders WHERE order_id = :order_id");
    $stmt->execute(['order_id' => $orderId]);
    $order = $stmt->fetch();

    if (!$order) {
        echo json_encode(['success' => false, 'message' => 'Order not found']);
        exit;
    }

    $currentStatus = $order['status'];
    $allowedNext = $validTransitions[$currentStatus] ?? null;

    if ($status !== $allowedNext) {
        echo json_encode(['success' => false, 'message' => "Cannot change status from $currentStatus to $status"]);
        exit;
    }

    // Update status. completed_at is stamped on the first transition to SERVED
    // (order_history reads it, so it must not be left NULL).
    $updateStmt = $pdo->prepare("
        UPDATE orders
        SET status = :status,
            completed_at = CASE WHEN :status2 = 'SERVED' THEN NOW() ELSE completed_at END,
            updated_at = NOW()
        WHERE order_id = :order_id
    ");
    $updateStmt->execute(['status' => $status, 'status2' => $status, 'order_id' => $orderId]);

    $refStmt = $pdo->prepare("SELECT reference_number, table_id FROM orders WHERE order_id = ?");
    $refStmt->execute([$orderId]);
    $orderRow = $refStmt->fetch(PDO::FETCH_ASSOC);
    $ref      = $orderRow['reference_number'] ?? ('#' . $orderId);
    $tableId  = $orderRow['table_id'] ?? null;

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'ORDER_STATUS', "Order #{$ref} -> {$status}", 'order', $orderId, $ref, (string)$status);

    // When served, free the table ONLY if no other live order still needs it.
    // The shared helper in table_state_helper.php is the single source of truth
    // for which statuses block a table from being freed. The check + free are
    // wrapped in a transaction with SELECT ... FOR UPDATE so a concurrent new
    // order cannot slip in between the COUNT and the UPDATE (TOCTOU).
    if ($status === 'SERVED' && $tableId) {
        $pdo->beginTransaction();
        try {
            // Lock the table row so the still-busy check + free UPDATE are atomic.
            $lockStmt = $pdo->prepare("
                SELECT status FROM restaurant_table
                WHERE table_id = ? AND is_deleted = 0
                FOR UPDATE
            ");
            $lockStmt->execute([$tableId]);

            $stillBusy = $pdo->prepare("
                SELECT COUNT(*) FROM orders
                WHERE table_id = ?
                  AND order_id <> ?
                  AND status IN ('PENDING', 'IN-PROGRESS', 'COOKING')
            ");
            $stillBusy->execute([$tableId, $orderId]);

            if ((int)$stillBusy->fetchColumn() === 0) {
                $free = $pdo->prepare("
                    UPDATE restaurant_table
                    SET status = 'AVAILABLE', updated_at = NOW()
                    WHERE table_id = ? AND is_deleted = 0 AND status = 'OCCUPIED'
                ");
                $free->execute([$tableId]);
            }
            $pdo->commit();
        } catch (Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    // Broadcast update via Pusher (both events so tracker lights instantly)
    $message = "Order status updated to $status";
    broadcastOrderUpdate($orderId, $message, $status);

    echo json_encode(['success' => true, 'message' => 'Order updated']);
} catch (PDOException $e) {
    error_log('update_order_status error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to update the order.']);
}