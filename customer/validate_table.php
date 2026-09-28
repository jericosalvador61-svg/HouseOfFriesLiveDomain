<?php
/**
 * ============================================================
 * validate_table.php — QR Table Validation (PUBLIC endpoint)
 * ------------------------------------------------------------
 * Single source of truth for "can this QR still be used?".
 *
 * The QR code encodes customer/customer.html?table_id=<DB id>&type=<DINE_IN|TAKEOUT>
 * so `table_id` is the ONLY identity that matters (table_number is a
 * display label only).
 *
 * Soft-deleted tables MUST NOT be able to open an ordering session.
 * This endpoint, plus the authoritative re-check inside place_order.php,
 * guarantees that even a stale/harvested QR string cannot resurrect a
 * deleted table.
 *
 * Request : GET/POST  table_id=<int>
 * Response:
 *   {
 *     success: true,
 *     valid: bool,
 *     code: AVAILABLE|OCCUPIED|MAINTENANCE|DELETED,
 *     message: string,            // customer-safe wording
 *     table_id, table_number, table_type
 *   }
 * ============================================================
 */

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/rate_limit.php';

hof_rate_limit('validate_table', 60, 60);

$rawBody = isset($GLOBALS['RAW_HTTP_BODY']) ? $GLOBALS['RAW_HTTP_BODY'] : file_get_contents('php://input');
$json = json_decode($rawBody, true);
$input = is_array($json) ? $json : $_REQUEST;

$tableId = $input['table_id'] ?? null;

/** Shared, customer-safe messages so wording stays consistent everywhere. */
if (!defined('HOF_QR_DELETED_MSG')) {
    define('HOF_QR_DELETED_MSG', 'This QR code is invalid or has been removed. Please ask restaurant staff for assistance.');
    define('HOF_QR_MAINTENANCE_MSG', 'This table is currently under maintenance and cannot accept orders. Please choose another table or ask restaurant staff for assistance.');
    define('HOF_QR_OCCUPIED_MSG', 'This table is currently occupied. Please choose another table or order at the counter.');
    define('HOF_QR_NOT_FOUND_MSG', 'Table QR is no longer available. Please ask restaurant staff for assistance.');
}

if (!is_scalar($tableId) || !ctype_digit((string)$tableId) || (int)$tableId < 1) {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'valid'   => false,
        'code'    => 'DELETED',
        'message' => HOF_QR_NOT_FOUND_MSG,
    ]);
    exit;
}
$tableId = (int)$tableId;

try {
    // NOTE: is_deleted is intentionally NOT filtered here — we need to tell
    // the difference between "never existed / removed hard" and "soft deleted".
    $stmt = $pdo->prepare("
        SELECT table_id, table_number, table_type, status, is_deleted
        FROM restaurant_table
        WHERE table_id = ?
        LIMIT 1
    ");
    $stmt->execute([$tableId]);
    $table = $stmt->fetch(PDO::FETCH_ASSOC);

    // 1. Row missing entirely, or soft-deleted -> QR is dead. Hard stop.
    if (!$table || (int)$table['is_deleted'] === 1) {
        http_response_code(410);
        echo json_encode([
            'success' => true,
            'valid'   => false,
            'code'    => 'DELETED',
            'message' => HOF_QR_DELETED_MSG,
        ]);
        exit;
    }

    $status = strtoupper(trim((string)$table['status']));

    // 2. MAINTENANCE must stay semantically distinct from OCCUPIED.
    if ($status === 'MAINTENANCE') {
        echo json_encode([
            'success'      => true,
            'valid'        => false,
            'code'         => 'MAINTENANCE',
            'message'      => HOF_QR_MAINTENANCE_MSG,
            'table_id'     => (int)$table['table_id'],
            'table_number' => (string)$table['table_number'],
            'table_type'   => (string)$table['table_type'],
        ]);
        exit;
    }

    // 3. Occupied tables cannot start a new ordering session.
    if ($status === 'OCCUPIED') {
        echo json_encode([
            'success'      => true,
            'valid'        => false,
            'code'         => 'OCCUPIED',
            'message'      => HOF_QR_OCCUPIED_MSG,
            'table_id'     => (int)$table['table_id'],
            'table_number' => (string)$table['table_number'],
            'table_type'   => (string)$table['table_type'],
        ]);
        exit;
    }

    // 4. AVAILABLE -> valid.
    echo json_encode([
        'success'      => true,
        'valid'        => true,
        'code'         => 'AVAILABLE',
        'message'      => 'Table verified.',
        'table_id'     => (int)$table['table_id'],
        'table_number' => (string)$table['table_number'],
        'table_type'   => (string)$table['table_type'],
        'status'       => $status,
    ]);
} catch (PDOException $e) {
    error_log('validate_table.php PDO error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'valid'   => false,
        'code'    => 'ERROR',
        'message' => 'We could not verify this table right now. Please try again.',
    ]);
} catch (\Throwable $e) {
    error_log('validate_table.php fatal error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'valid'   => false,
        'code'    => 'ERROR',
        'message' => 'We could not verify this table right now. Please try again.',
    ]);
}
