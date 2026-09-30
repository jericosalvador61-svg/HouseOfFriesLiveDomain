<?php
// backend/auth_middleware.php

require_once __DIR__ . '/secret.php';

// Idle timeout configuration
// These constants are defined in secret.php
// const IDLE_TIMEOUT = 30 * 60;
// const WARNING_THRESHOLD = 5 * 60;

function getBearerTokenFromRequest(): string
{
    // ALWAYS read and save php://input FIRST, before any early return.
    // This ensures $GLOBALS['RAW_HTTP_BODY'] is available to downstream
    // endpoints (like update_location.php) that need to re-read the body.
    $rawBody = file_get_contents('php://input');
    $GLOBALS['RAW_HTTP_BODY'] = $rawBody;

    // 1. Check Authorization header (standard)
    $rawHeaders = function_exists('getallheaders') ? getallheaders() : [];
    $headers = is_array($rawHeaders) ? $rawHeaders : [];
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';

    if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
        return trim($matches[1]);
    }

    if (!empty($_SERVER['HTTP_AUTHORIZATION']) && preg_match('/Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'], $matches)) {
        return trim($matches[1]);
    }

    // 2. Check cookie hof_token (set by login.js)
    if (!empty($_COOKIE['hof_token'])) {
        return trim((string) $_COOKIE['hof_token']);
    }

    // 3. Check request body {"token": "..."} - already in $GLOBALS['RAW_HTTP_BODY']
    if ($rawBody !== '') {
        $body = json_decode($rawBody, true);
        if (is_array($body) && !empty($body['token'])) {
            return trim((string) $body['token']);
        }
    }

    // 5. Check form data token=...
    if (!empty($_POST['token'])) {
        return trim((string) $_POST['token']);
    }

    return '';
}

/**
 * Decode and validate JWT token.
 * Returns payload array if valid, otherwise sends 401 and exits.
 * Also checks idle timeout (except for customer role).
 */
function authenticate(?array $allowedRoles = null)
{
    $token = getBearerTokenFromRequest();
    if ($token === '') {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Missing or invalid Authorization header.']);
        exit;
    }

    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Invalid token format.']);
        exit;
    }

    list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $parts;

    $header = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlHeader), true);
    $payload = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlPayload), true);
    $signature = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlSignature), true);

    if ($header === false || $payload === false || $signature === false) {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Invalid token encoding.']);
        exit;
    }

    $expectedSignature = hash_hmac('sha256', $base64UrlHeader . '.' . $base64UrlPayload, JWT_SECRET, true);
    if (!hash_equals($expectedSignature, $signature)) {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Invalid token signature.']);
        exit;
    }

    $data = json_decode($payload, true);
    if (!is_array($data) || !isset($data['exp']) || $data['exp'] < time()) {
        http_response_code(401);
        echo json_encode(['status' => 'error', 'message' => 'Token expired.']);
        exit;
    }

    // Check idle timeout (except customer role)
    $role = strtolower($data['role'] ?? '');
    if ($role !== 'customer' && isset($data['last_activity'])) {
        $idleTime = time() - $data['last_activity'];
        
        if ($idleTime >= IDLE_TIMEOUT) {
            http_response_code(401);
            echo json_encode([
                'status' => 'error', 
                'message' => 'Session expired due to inactivity. Please log in again.',
                'idle_timeout' => true
            ]);
            exit;
        }
        
        // Add warning info to response data for frontend
        $data['idle_warning'] = $idleTime >= (IDLE_TIMEOUT - WARNING_THRESHOLD);
        $data['idle_remaining'] = IDLE_TIMEOUT - $idleTime;
    }

    if (!empty($allowedRoles)) {
        $normalizedAllowed = array_map('strtolower', $allowedRoles);
        $normalizedRole = isset($data['role']) ? strtolower(trim((string) $data['role'])) : '';
        if (!in_array($normalizedRole, $normalizedAllowed, true)) {
            http_response_code(403);
            echo json_encode(['status' => 'error', 'message' => 'Access denied. Insufficient privileges.']);
            exit;
        }
    }

    return $data;
}