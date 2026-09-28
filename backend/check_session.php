<?php
// backend/check_session.php

require_once __DIR__ . '/auth_middleware.php';

// Authenticate and decode token. This now accepts both the Bearer header and the JSON token body.
$user = authenticate();

http_response_code(200);
echo json_encode([
    'loggedIn' => true,
    'user_id' => $user['user_id'] ?? null,
    'first_name' => $user['first_name'] ?? '',
    'last_name' => $user['last_name'] ?? '',
    'role' => $user['role'] ?? ''
]);
exit;