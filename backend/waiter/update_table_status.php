<?php
/**
 * HOF Waiter API - Update Table Status
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../rate_limit.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../table_state_helper.php';
header('Content-Type: application/json');

$auth = authenticate(['Waiter', 'Admin', 'Supervisor']);

// Authenticate first, then rate limit (matches the rest of the waiter module).
hof_rate_limit('waiter_table_status', 30, 60);

try {
    $data = json_decode(file_get_contents('php://input'), true);
    $tableId = (int)($data['table_id'] ?? 0);
    $status = strtoupper(trim($data['status'] ?? ''));

    if (!$tableId || !$status) {
        echo json_encode(['success' => false, 'message' => 'Invalid input']);
        exit;
    }

    $validStatuses = ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE'];
    if (!in_array($status, $validStatuses)) {
        echo json_encode(['success' => false, 'message' => 'Invalid status']);
        exit;
    }

    $getStmt = $pdo->prepare("SELECT status, table_number FROM restaurant_table WHERE table_id = :table_id AND is_deleted = 0");
    $getStmt->execute([':table_id' => $tableId]);
    $row = $getStmt->fetch();
    $oldStatus = $row ? $row['status'] : null;
    $tableNumber = $row ? $row['table_number'] : '?';

    // ─ STATE CONSISTENCY GUARD (P0) ──
    // A table with a live order (pending / in kitchen / served) may not be
    // released to AVAILABLE by any role. Backend-enforced.
    if ($status === 'AVAILABLE') {
        // Wrap the block-check + update in a transaction with SELECT ... FOR
        // UPDATE so a concurrent new order cannot be placed between them and
        // get its table stomped back to AVAILABLE (TOCTOU hardening).
        $pdo->beginTransaction();
        try {
            $lockStmt = $pdo->prepare("
                SELECT status FROM restaurant_table
                WHERE table_id = ? AND is_deleted = 0
                FOR UPDATE
            ");
            $lockStmt->execute([$tableId]);

            $blocking = hof_get_blocking_order_for_table($pdo, $tableId);
            if ($blocking) {
                $pdo->rollBack();
                http_response_code(409);
                echo json_encode([
                    'success' => false,
                    'status'  => 'error',
                    'error'   => 'TABLE_HAS_ACTIVE_ORDER',
                    'message' => hof_table_block_message($blocking)
                ]);
                exit;
            }

            $stmt = $pdo->prepare("
                UPDATE restaurant_table 
                SET status = :status, updated_at = NOW()
                WHERE table_id = :table_id AND is_deleted = 0
            ");
            $stmt->execute(['status' => $status, 'table_id' => $tableId]);
            $pdo->commit();
        } catch (Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    } else {
        $stmt = $pdo->prepare("
            UPDATE restaurant_table 
            SET status = :status, updated_at = NOW()
            WHERE table_id = :table_id AND is_deleted = 0
        ");
        $stmt->execute(['status' => $status, 'table_id' => $tableId]);
    }

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'TABLE_STATUS', "Table #{$tableNumber} -> {$status}", 'restaurant_table', $tableId, (string)$tableNumber, (string)$status);

    echo json_encode(['success' => true, 'message' => 'Table updated']);
} catch (PDOException $e) {
    error_log('update_table_status error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to update the table.']);
}
