<?php
/**
 * HOF Waiter API - Clear Table (set a table back to AVAILABLE)
 * Uses the shared state-consistency rule in table_state_helper.php, identical
 * to update_table_status.php, so every role behaves the same way.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../table_state_helper.php';
require_once __DIR__ . '/../debug_helper.php';

// RBAC aligned with update_table_status.php: floor staff (waiter) + oversight.
// Cashier is intentionally NOT allowed to free tables.
$auth = authenticate(['Waiter', 'Admin', 'Supervisor']);

$data = json_decode(file_get_contents('php://input'), true);
$tableId = (int)($data['table_id'] ?? 0);

if (!$tableId) {
    echo json_encode(['success' => false, 'status' => 'error', 'message' => 'table_id required.']);
    exit;
}

try {
    $pdo->beginTransaction();

    // Single shared rule (backend/table_state_helper.php) — identical to the
    // Admin / Waiter table-status endpoints so all roles behave the same.
    $activeOrder = hof_get_blocking_order_for_table($pdo, $tableId, true);

    if ($activeOrder) {
        $pdo->rollBack();
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'status'  => 'error',
            'error'   => 'TABLE_HAS_ACTIVE_ORDER',
            'message' => hof_table_block_message($activeOrder)
        ]);
        exit;
    }

    $stmt = $pdo->prepare("UPDATE restaurant_table SET status = 'AVAILABLE', updated_at = NOW() WHERE table_id = ? AND is_deleted = 0");
    $stmt->execute([$tableId]);

    $numStmt = $pdo->prepare("SELECT table_number FROM restaurant_table WHERE table_id = ?");
    $numStmt->execute([$tableId]);
    $tableNumber = $numStmt->fetchColumn();

    $pdo->commit();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'TABLE_CLEAR', "Cleared Table #{$tableNumber}", 'restaurant_table', $tableId);

    echo json_encode([
        'success' => true,
        'status' => 'success',
        'message' => 'Table cleared.'
    ]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('clear_table error: ' . $e->getMessage());
    echo json_encode(array_merge(
        ['success' => false, 'status' => 'error', 'message' => 'An error occurred while clearing the table.'],
        hof_debug_detail($e)
    ));
}