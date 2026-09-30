<?php
// backend/auth/change_password_first_login.php
// Handles first-time password change for new users or admin-reset passwords

require_once __DIR__ . "/../db.php";
require_once __DIR__ . "/../secret.php"; // JWT_SECRET used to verify temp tokens & sign new ones
require_once __DIR__ . "/../log_activity_helper.php"; // REQ-050

header("Content-Type: application/json");

$data = json_decode(file_get_contents("php://input"), true);

$token = $data['token'] ?? '';
$newPassword = $data['new_password'] ?? '';
$confirmPassword = $data['confirm_password'] ?? '';

if (!$token) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Token is required"]);
    exit;
}

if (!$newPassword || !$confirmPassword) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "New password and confirmation are required"]);
    exit;
}

if ($newPassword !== $confirmPassword) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Passwords do not match"]);
    exit;
}

// Validate password strength (Requirement #70: 8 -> 6 length standard)
function validatePasswordStrength($password) {
    $errors = [];
    if (strlen($password) < 6) {
        $errors[] = "at least 6 characters";
    }
    if (!preg_match('/[A-Z]/', $password)) {
        $errors[] = "one uppercase letter";
    }
    if (!preg_match('/[0-9]/', $password)) {
        $errors[] = "one number";
    }
    if (!preg_match('/[^A-Za-z0-9]/', $password)) {
        $errors[] = "one special character";
    }
    return $errors;
}

$strengthErrors = validatePasswordStrength($newPassword);
if (!empty($strengthErrors)) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "Password must contain: " . implode(", ", $strengthErrors)
    ]);
    exit;
}

// Decode and validate JWT token
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

$userData = json_decode($payload, true);
if (!is_array($userData) || !isset($userData['user_id']) || !isset($userData['exp']) || $userData['exp'] < time()) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Token expired or invalid"]);
    exit;
}

$userId = $userData['user_id'];

try {
    // Check if user actually needs to change password
    $stmt = $pdo->prepare("SELECT must_change_password FROM users WHERE user_id = ?");
    $stmt->execute([$userId]);
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "User not found"]);
        exit;
    }

    if (!$user['must_change_password']) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Password change not required"]);
        exit;
    }

    // Hash new password, update user, and clear the visible temp code
    $hashedPassword = password_hash($newPassword, PASSWORD_DEFAULT);
    $stmt = $pdo->prepare("UPDATE users SET password = ?, must_change_password = 0, temp_code = NULL WHERE user_id = ?");
    $stmt->execute([$hashedPassword, $userId]);

    // REQ-050: log password change (actor derived from validated temp token, server-side)
    logActivity($pdo, (int)$userId, $userData['username'] ?? 'unknown', $userData['role'] ?? 'User',
        'USER_PASSWORD_CHANGE', "User " . ($userData['username'] ?? '') . " changed password (first login)",
        'users', (int)$userId, $userData['username'] ?? null, 'COMPLETED');

    // Generate new JWT token with updated payload
    $newPayload = [
        "user_id" => $userData['user_id'],
        "username" => $userData['username'],
        "first_name" => $userData['first_name'],
        "last_name" => $userData['last_name'],
        "role" => $userData['role'],
        "exp" => time() + (60 * 60 * 8) // Valid for 8 hours
    ];

    $newToken = generateJWT($newPayload, JWT_SECRET);

    // Determine redirect based on role
    $role = strtolower($userData['role']);
    if ($role === 'admin') {
        $redirect = '/public/admin/admin_dashboard.html';
    } elseif ($role === 'cashier') {
        $redirect = '/public/cashier/cashier_dashboard.html';
    } elseif ($role === 'inventory staff') {
        $redirect = '/public/inventoryStaff/inventoryStaff_dashboard.html';
    } elseif ($role === 'kitchen staff') {
        $redirect = '/public/kitchenStaff/kitchen_dashboard.html';
    } elseif ($role === 'supervisor') {
        $redirect = '/public/supervisor/supervisor_dashboard.html';
    } elseif ($role === 'waiter') {
        $redirect = '/public/waiter/waiter_dashboard.html';
    } else {
        $redirect = '/index.html';
    }

    echo json_encode([
        "success" => true,
        "message" => "Password changed successfully",
        "token" => $newToken,
        "redirect" => $redirect
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Server error: " . $e->getMessage()]);
}

// Helper function to generate JWT (copied from login.php)
function generateJWT($payload, $secret) {
    $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);

    $base64UrlHeader = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
    $base64UrlPayload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(json_encode($payload)));

    $signature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, $secret, true);
    $base64UrlSignature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));

    return $base64UrlHeader . "." . $base64UrlPayload . "." . $base64UrlSignature;
}