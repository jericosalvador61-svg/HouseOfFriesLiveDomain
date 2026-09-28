<?php
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/rate_limit.php';
require_once __DIR__ . '/../backend/log_activity_helper.php';

hof_rate_limit('occupy_table', 20, 60);

$rawBody = isset($GLOBALS['RAW_HTTP_BODY']) ? $GLOBALS['RAW_HTTP_BODY'] : file_get_contents('php://input');
$json = json_decode($rawBody, true);
$input = is_array($json) ? $json : $_POST;

$tableId   = $input['table_id'] ?? ($_POST['table_id'] ?? null);
$tableType = $input['type'] ?? ($_POST['type'] ?? null);

if (!is_scalar($tableId) || !ctype_digit((string)$tableId) || (int)$tableId < 1) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Invalid or missing table ID']);
    exit;
}
$tableId = (int)$tableId;

try {
    // 1. Look up by real DB primary key.
    //    is_deleted is NOT filtered here so we can answer "deleted" distinctly
    //    from "occupied" — a soft-deleted table must kill the QR, never
    //    present itself as merely busy.
    $checkStmt = $pdo->prepare("
        SELECT table_id, table_number, table_type, status, is_deleted
        FROM restaurant_table
        WHERE table_id = ?
    ");
    $checkStmt->execute([$tableId]);
    $table = $checkStmt->fetch(PDO::FETCH_ASSOC);

    // 2. Missing row OR soft-deleted row -> the QR is no longer valid.
    //    HTTP 410 Gone signals "this resource is intentionally retired".
    if (!$table || (int)$table['is_deleted'] === 1) {
        http_response_code(410);
        echo json_encode([
            'status'  => 'invalid',
            'code'    => 'DELETED',
            'message' => 'This QR code is invalid or has been removed. Please ask restaurant staff for assistance.'
        ]);
        exit;
    }

    $currentStatus = strtoupper(trim((string)$table['status']));

    // 3. Block MAINTENANCE tables — semantically DISTINCT from occupied.
    if ($currentStatus === 'MAINTENANCE') {
        echo json_encode([
            'status'  => 'maintenance',
            'code'    => 'MAINTENANCE',
            'message' => "Table {$table['table_number']} is currently under maintenance and cannot accept orders. Please choose another table or ask restaurant staff for assistance."
        ]);
        exit;
    }

    // 4. Block OCCUPIED tables
    if ($currentStatus === 'OCCUPIED') {
        echo json_encode([
            'status'  => 'occupied',
            'code'    => 'OCCUPIED',
            'message' => "Table {$table['table_number']} is currently occupied. Please choose another table or order at the counter."
        ]);
        exit;
    }

    // 4. Atomic update for DINE_IN tables — only AVAILABLE rows
    if (strtoupper($table['table_type']) === 'DINE_IN') {
        $updateStmt = $pdo->prepare("
            UPDATE restaurant_table 
            SET status = 'OCCUPIED', updated_at = NOW() 
            WHERE table_id = ? AND status = 'AVAILABLE' AND is_deleted = 0
        ");
        $updateStmt->execute([$tableId]);

        if ($updateStmt->rowCount() === 0) {
            echo json_encode(['status' => 'occupied', 'message' => 'Table was just taken. Please try another.']);
            exit;
        }
    }

    logActivity($pdo, null, 'GUEST', 'Customer', 'TABLE_OCCUPY', "Customer occupied Table #{$table['table_number']}", 'restaurant_table', $tableId);

    echo json_encode([
        'status' => 'success',
        'message' => 'Table verified',
        'table_id' => (int)$table['table_id'],
        'table_number' => (string)$table['table_number'],
        'table_type' => (string)$table['table_type']
    ]);

} catch (PDOException $e) {
    error_log('occupy_table.php PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Server error while verifying table. Please try again.']);
} catch (\Throwable $e) {
    error_log('occupy_table.php fatal error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'An unexpected server error occurred.']);
}