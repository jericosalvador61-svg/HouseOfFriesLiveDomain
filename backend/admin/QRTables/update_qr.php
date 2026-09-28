<?php
// update_qr.php — Regenerate a table's QR code (existing table)
// POST: table_id + qr_code (base64 data URI) -> UPDATE restaurant_table
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
require_once __DIR__ . '/../../log_activity_helper.php';

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
    $qr_code  = $input['qr_code'] ?? ($_POST['qr_code'] ?? null);

    if (!is_scalar($table_id) || !ctype_digit((string)$table_id) || (int)$table_id < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid or missing table ID']);
        exit;
    }
    $table_id = (int)$table_id;

    if (!is_scalar($qr_code) || trim((string)$qr_code) === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing or invalid QR data']);
        exit;
    }

    $getStmt = $pdo->prepare("SELECT table_number FROM restaurant_table WHERE table_id = :table_id AND is_deleted = 0");
    $getStmt->execute([':table_id' => $table_id]);
    $tableRow = $getStmt->fetch();
    $tableNumber = $tableRow ? $tableRow['table_number'] : $table_id;

    $stmt = $pdo->prepare("
        UPDATE restaurant_table 
        SET qr_code = :qr_code, updated_at = NOW()
        WHERE table_id = :table_id AND is_deleted = 0
    ");
    $success = $stmt->execute([
        ':qr_code'  => (string)$qr_code,
        ':table_id' => $table_id
    ]);

    if ($stmt->rowCount() === 0) {
        // Check if table exists
        $chk = $pdo->prepare("SELECT table_id FROM restaurant_table WHERE table_id = ? AND is_deleted = 0");
        $chk->execute([$table_id]);
        if (!$chk->fetch()) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Table not found']);
            exit;
        }
    }

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'TABLE_QR', "Updated QR for Table #{$tableNumber}", 'restaurant_table', $table_id);

    echo json_encode([
        'success'  => true,
        'affected' => $stmt->rowCount()
    ]);
} catch (PDOException $e) {
    error_log('update_qr.php PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database error occurred while updating QR code']);
} catch (\Throwable $e) {
    error_log('update_qr.php fatal error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'An unexpected server error occurred']);
}
