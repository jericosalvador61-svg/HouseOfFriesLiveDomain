<?php
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

    if (!is_scalar($table_id) || !ctype_digit((string)$table_id) || (int)$table_id < 1) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid or missing table ID']);
        exit;
    }
    $table_id = (int)$table_id;

    // Fetch the table to restore
    $getStmt = $pdo->prepare("SELECT table_number, table_type, is_deleted FROM restaurant_table WHERE table_id = ?");
    $getStmt->execute([$table_id]);
    $table = $getStmt->fetch(PDO::FETCH_ASSOC);

    if (!$table) {
        http_response_code(404);
        echo json_encode(['success' => false, 'error' => 'Table not found']);
        exit;
    }

    if ((int)$table['is_deleted'] === 0) {
        echo json_encode(['success' => true, 'message' => 'Table is already active']);
        exit;
    }

    // Check if another table already uses this table_number
    $checkStmt = $pdo->prepare("
        SELECT table_id, is_deleted
        FROM restaurant_table
        WHERE table_number = ? AND table_id != ?
        ORDER BY is_deleted ASC
        LIMIT 1
    ");
    $checkStmt->execute([$table['table_number'], $table_id]);
    $duplicate = $checkStmt->fetch(PDO::FETCH_ASSOC);

    if ($duplicate) {
        $isDel = (int)$duplicate['is_deleted'] === 1;
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'error' => $isDel ? 'TABLE_EXISTS_DELETED' : 'TABLE_EXISTS',
            'message' => $isDel
                ? "Cannot restore: table '{$table['table_number']}' also exists as another Deleted table."
                : "Cannot restore: table '{$table['table_number']}' already exists as an Active table."
        ]);
        exit;
    }

    $stmt = $pdo->prepare("
        UPDATE restaurant_table 
        SET is_deleted = 0, deleted_at = NULL, updated_at = NOW()
        WHERE table_id = :table_id AND is_deleted = 1
    ");
    $stmt->execute([':table_id' => $table_id]);

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'TABLE_RESTORE', "Restored Table #{$table['table_number']}", 'restaurant_table', $table_id);

    echo json_encode(['success' => true, 'message' => 'Table restored successfully']);
} catch (PDOException $e) {
    error_log('restore_table.php PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database error occurred while restoring table']);
} catch (\Throwable $e) {
    error_log('restore_table.php fatal error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'An unexpected server error occurred']);
}