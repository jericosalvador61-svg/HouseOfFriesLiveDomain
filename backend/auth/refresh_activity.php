<?php
// backend/auth/refresh_activity.php
// Updates the last_activity timestamp in the JWT token

require_once __DIR__ . "/../db.php";
require_once __DIR__ . "/../secret.php";

header("Content-Type: application/json");

$token = $_POST['token'] ?? $_GET['token'] ?? '';

if (!$token) {
    // Try to get from Authorization header
    $headers = function_exists('getallheaders') ? getallheaders() : [];
    $authHeader = $headers['Authorization'] ?? $headers['authorization'] ?? '';
    if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
        $token = trim($matches[1]);
    }
    // Fallback for CGI/FastCGI (InfinityFree) where getallheaders() doesn't exist
    if (!$token && !empty($_SERVER['HTTP_AUTHORIZATION']) && preg_match('/Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'], $matches)) {
        $token = trim($matches[1]);
    }
}

if (!$token) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Token required"]);
    exit;
}

// Decode and validate JWT
$parts = explode('.', $token);
if (count($parts) !== 3) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Invalid token format"]);
    exit;
}

list($base64UrlHeader, $base64UrlPayload, $base64UrlSignature) = $parts;

$header = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlHeader), true);
$payload = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlPayload), true);
$signature = base64_decode(str_replace(['-', '_'], ['+', '/'], $base64UrlSignature), true);

if ($header === false || $payload === false || $signature === false) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Invalid token encoding"]);
    exit;
}

$expectedSignature = hash_hmac('sha256', $base64UrlHeader . '.' . $base64UrlPayload, JWT_SECRET, true);
if (!hash_equals($expectedSignature, $signature)) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Invalid token signature"]);
    exit;
}

$data = json_decode($payload, true);
if (!is_array($data) || !isset($data['user_id']) || !isset($data['exp']) || $data['exp'] < time()) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Token expired or invalid"]);
    exit;
}

// Check if user is customer (exempt from idle timeout)
$role = strtolower($data['role'] ?? '');
if ($role === 'customer') {
    echo json_encode([
        "success" => true,
        "message" => "Customer role - idle timeout not applicable",
        "exempt" => true
    ]);
    exit;
}

// Update last_activity to now
$data['last_activity'] = time();

// Generate new JWT with updated last_activity
function generateJWT($payload, $secret) {
    $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);
    $base64UrlHeader = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
    $base64UrlPayload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(json_encode($payload)));
    $signature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, $secret, true);
    $base64UrlSignature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));
    return $base64UrlHeader . "." . $base64UrlPayload . "." . $base64UrlSignature;
}

$newToken = generateJWT($data, JWT_SECRET);

echo json_encode([
    "success" => true,
    "message" => "Activity refreshed",
    "token" => $newToken,
    "last_activity" => $data['last_activity']
]);