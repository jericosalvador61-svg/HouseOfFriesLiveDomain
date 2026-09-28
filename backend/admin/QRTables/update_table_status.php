<?php
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../table_state_helper.php';
require_once __DIR__ . '/../../debug_helper.php';

$auth = authenticate(['Admin', 'Supervisor']);

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
    $status   = isset($input['status']) ? strtoupper(trim((string)$input['status'])) : (isset($_POST['status']) ? strtoupper(trim((string)$_POST['status'])) : null);
    $qr_code  = $input['qr_code'] ?? ($_POST['qr_code'] ?? null);

    if (!is_scalar($table_id) || !ctype_digit((string)$table_id) || (int)$table_id < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid or missing table ID']);
        exit;
    }
    $table_id = (int)$table_id;

    // If updating status, validate it
    if ($status !== null) {
        $validStatuses = ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE'];
        if (!in_array($status, $validStatuses, true)) {
            http_response_code(400);
            echo json_encode(['success' => false, 'error' => 'Invalid status']);
            exit;
        }
    }

    // If updating QR code, validate it's not empty
    if ($qr_code !== null && (!is_scalar($qr_code) || trim((string)$qr_code) === '')) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'QR code cannot be empty']);
        exit;
    }

    // QR regeneration is Admin-only. This endpoint also accepts Supervisor, so the
    // restriction must be enforced here and not only by hiding the button —
    // a Supervisor must never be able to repoint a table's QR code.
    if ($qr_code !== null && strtolower(trim((string)($auth['role'] ?? ''))) !== 'admin') {
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'Forbidden', 'message' => 'Only an Admin can change a table QR code.']);
        exit;
    }

    $getStmt = $pdo->prepare("SELECT table_number, status FROM restaurant_table WHERE table_id = :table_id AND is_deleted = 0");
    $getStmt->execute([':table_id' => $table_id]);
    $row = $getStmt->fetch();
    if (!$row) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Table not found']);
        exit;
    }

    // Build dynamic SET clause
    $setFields = [];
    $params = [':table_id' => $table_id];

    if ($status !== null) {
        // ── STATE CONSISTENCY GUARD (P0) ──
        // Freeing a table (AVAILABLE) is only legal once no order is
        // still open for it. Backend-enforced for Admin AND Supervisor.
        if ($status === 'AVAILABLE') {
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
        }

        $setFields[] = 'status = :status';
        $params[':status'] = $status;
    }
    if ($qr_code !== null) {
        $setFields[] = 'qr_code = :qr_code';
        $params[':qr_code'] = (string)$qr_code;
    }

    if (empty($setFields)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Nothing to update']);
        exit;
    }

    $setFields[] = 'updated_at = NOW()';

    $sql = "UPDATE restaurant_table SET " . implode(', ', $setFields) . " WHERE table_id = :table_id AND is_deleted = 0";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);

    $newStatus = $status ?? $row['status'];
    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'TABLE_STATUS', "Table #{$row['table_number']} -> {$newStatus}", 'restaurant_table', $table_id);

    echo json_encode(['success' => true, 'message' => 'Table updated successfully']);
} catch (PDOException $e) {
    error_log('update_table_status.php PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(array_merge(
        ['success' => false, 'error' => 'Database error occurred while updating table'],
        hof_debug_detail($e)
    ));
} catch (\Throwable $e) {
    error_log('update_table_status.php fatal error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(array_merge(
        ['success' => false, 'error' => 'An unexpected server error occurred'],
        hof_debug_detail($e)
    ));
}