<?php
header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
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

    $table_number = $input['table_number'] ?? ($_POST['table_number'] ?? null);
    $table_type   = $input['table_type'] ?? ($_POST['table_type'] ?? null);
    $qr_code      = $input['qr_code'] ?? ($_POST['qr_code'] ?? null);

    $table_number = is_scalar($table_number) ? trim(strip_tags((string)$table_number)) : '';
    $table_type   = is_scalar($table_type) ? strtoupper(trim(strip_tags((string)$table_type))) : '';
    $qr_code      = is_scalar($qr_code) ? trim((string)$qr_code) : null;

    if ($table_number === '' || $table_type === '') {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Missing required fields']);
        exit;
    }

    if (!in_array($table_type, ['DINE_IN', 'TAKEOUT'], true)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Invalid table type']);
        exit;
    }

    if (strlen($table_number) > 20) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Table name must be 20 characters or fewer']);
        exit;
    }

    if ($table_type === 'DINE_IN' && (!ctype_digit($table_number) || (int)$table_number < 1)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Dine-in table number must be a positive number']);
        exit;
    }

    // Table numbers/names are globally unique, including soft-deleted rows.
    $checkStmt = $pdo->prepare("
        SELECT table_id, table_type, is_deleted
        FROM restaurant_table
        WHERE table_number = :table_number
        ORDER BY is_deleted ASC
        LIMIT 1
    ");
    $checkStmt->execute([':table_number' => $table_number]);
    $existingTable = $checkStmt->fetch(PDO::FETCH_ASSOC);

    if ($existingTable) {
        $isDeleted = (int)$existingTable['is_deleted'] === 1;
        http_response_code(409);
        echo json_encode([
            'success' => false,
            'error' => $isDeleted ? 'TABLE_EXISTS_DELETED' : 'TABLE_EXISTS',
            'message' => $isDeleted
                ? "Table '{$table_number}' already exists in Deleted tables. Restore that table or choose a different label."
                : "Table '{$table_number}' already exists in Active tables. Choose a different label.",
            'existing_table_id' => (int)$existingTable['table_id'],
            'existing_table_type' => $existingTable['table_type'],
            'is_deleted' => $isDeleted
        ]);
        exit;
    }

    $stmt = $pdo->prepare("
        INSERT INTO restaurant_table (table_number, table_type, qr_code, status, is_deleted)
        VALUES (:table_number, :table_type, :qr_code, 'AVAILABLE', 0)
    ");
    $stmt->execute([
        ':table_number' => $table_number,
        ':table_type'   => $table_type,
        ':qr_code'      => $qr_code
    ]);
    $new_id = (int)$pdo->lastInsertId();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'], 'TABLE_ADD', "Added Table #{$table_number}", 'restaurant_table', $new_id, (string)$table_number, 'Active');

    http_response_code(201);
    echo json_encode(['success' => true, 'table_id' => $new_id]);
} catch (PDOException $e) {
    error_log('add_table.php PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'Database error occurred while adding table']);
} catch (\Throwable $e) {
    error_log('add_table.php fatal error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'error' => 'An unexpected error occurred while adding table']);
}