<?php
/**
 * Generate Temp Code API
 * Returns a random 8-character temporary code for first-login users.
 * Called by javascript/admin/manage_users.js generateCode()
 */
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/temp_code_helper.php';
header('Content-Type: application/json');
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';
$auth = authenticate(['Admin']);

$code = hof_generate_temp_code(8);

logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
    'USER_TEMP_CODE', "Generated temp code for {$auth['username']}",
    'user', 0, $auth['username']);

echo json_encode(['success' => true, 'code' => $code]);