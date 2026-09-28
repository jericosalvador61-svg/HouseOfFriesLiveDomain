<?php
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../table_state_helper.php';

$auth = authenticate(['Admin']);

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'error' => 'Method not allowed']);
    exit;
}

try {
    $rawBody = isset($GLOBALS['RAW_HTTP_BODY']) ? $GLOBALS['RAW_HTTP_BODY'] : file_get_contents('php://input');
    $json = json_decode($rawBody, true);
    $input = is_array($json) ? $json : $_POST;

    $table_id = $input['table_id'] ?? ($_POST['table_id'] ?? null);

    if (!is_scalar($table_id) || !ctype_digit((string)$table_id) || (int)$table_id < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid or missing table ID']);
        exit;
    }
    $table_id = (int)$table_id;

    $getStmt = $pdo->prepare("SELECT table_number FROM restaurant_table WHERE table_id = :table_id AND is_deleted = 0");
    $getStmt->execute([':table_id' => $table_id]);
    $tableRow = $getStmt->fetch();
    $tableNumber = $tableRow ? $tableRow['table_number'] : $table_id;

    // ── STATE CONSISTENCY GUARD (P0) ──
    // Deleting a table hides its QR. That must not be used as a shortcut to
    // "free" a table that still has a live order, so refuse while one exists.
    // (Cancel/complete the order first — this keeps history honest.)
    $blocking = hof_get_blocking_order_for_table($pdo, $table_id);
    if ($blocking) {
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'error'   => 'TABLE_HAS_ACTIVE_ORDER',
            'message' => hof_table_block_message($blocking)
        ]);
        exit;
    }

    $stmt = $pdo->prepare("
        UPDATE restaurant_table SET is_deleted = 1, deleted_at = NOW(), updated_at = NOW()
        WHERE table_id = :table_id AND is_deleted = 0
    ");
    $stmt->execute([':table_id' => $table_id]);

    if ($stmt->rowCount() === 0) {
        $chk = $pdo->prepare("SELECT is_deleted FROM restaurant_table WHERE table_id = ?");
        $chk->execute([$table_id]);
        $row = $chk->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Table not found']);
        } else {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Table is already deleted']);
        }
        exit;
    }

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'TABLE_DELETE', "Deleted Table #{$tableNumber}", 'restaurant_table', $table_id);

    echo json_encode(['success' => true, 'message' => 'Table soft-deleted successfully']);
} catch (PDOException $e) {
    error_log('delete_table.php PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database error occurred while deleting table']);
} catch (\Throwable $e) {
    error_log('delete_table.php fatal error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'An unexpected server error occurred']);
}
