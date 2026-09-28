<?php
// backend/cashier/auth_helper.php
require_once __DIR__ . '/../secret.php';

function validateBearerToken()
{
    // 1. Intercept the Authorization Header safely across all server environments (Apache, FastCGI, Nginx)
    $authHeader = '';
    
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    }
    
    // Fallback if getallheaders() is missing or didn't catch it
    if (empty($authHeader)) {
        if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
            $authHeader = trim($_SERVER['HTTP_AUTHORIZATION']);
        } elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $authHeader = trim($_SERVER['REDIRECT_HTTP_AUTHORIZATION']);
        } elseif (function_exists('apache_request_headers')) {
            $requestHeaders = apache_request_headers();
            $requestHeaders = array_combine(array_map('ucwords', array_keys($requestHeaders)), array_values($requestHeaders));
            if (isset($requestHeaders['Authorization'])) {
                $authHeader = trim($requestHeaders['Authorization']);
            }
        }
    }

    if (empty($authHeader) || !preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
        http_response_code(401);
        echo json_encode(['status' => 'ERROR', 'success' => false, 'message' => 'Unauthorized: Missing or malformed token.']);
        exit;
    }

    $jwt = $matches[1];
    $tokenParts = explode('.', $jwt);
    if (count($tokenParts) !== 3) {
        http_response_code(401);
        echo json_encode(['status' => 'ERROR', 'success' => false, 'message' => 'Unauthorized: Invalid token structure.']);
        exit;
    }

    list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $tokenParts;

    // 2. Perform the exact cryptographic verification signature check matching login.php
    $signature = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlSignature));
    $expectedSignature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, JWT_SECRET, true);

    if (!hash_equals($signature, $expectedSignature)) {
        http_response_code(401);
        echo json_encode(['status' => 'ERROR', 'success' => false, 'message' => 'Unauthorized: Token signature verification failed.']);
        exit;
    }

    // 3. Extract payload array values and check expiration constraints
    $payload = json_decode(base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlPayload)), true);

    if (!$payload || ($payload['exp'] ?? 0) < time()) {
        http_response_code(401);
        echo json_encode(['status' => 'ERROR', 'success' => false, 'message' => 'Unauthorized: Token has expired.']);
        exit;
    }

    return $payload; // Securely hands back user_id, username, role, etc.
}