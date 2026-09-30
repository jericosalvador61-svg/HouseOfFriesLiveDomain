<?php
require_once "db.php";
require_once "secret.php";

header("Content-Type: application/json");

// Helper function to build a stateless base64url signed JWT
function generateJWT($payload, $secret) {
    $header = json_encode(['typ' => 'JWT', 'alg' => 'HS256']);

    $base64UrlHeader = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($header));
    $base64UrlPayload = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode(json_encode($payload)));

    $signature = hash_hmac('sha256', $base64UrlHeader . "." . $base64UrlPayload, $secret, true);
    $base64UrlSignature = str_replace(['+', '/', '='], ['-', '_', ''], base64_encode($signature));

    return $base64UrlHeader . "." . $base64UrlPayload . "." . $base64UrlSignature;
}

// Rate limiting configuration
define('MAX_ATTEMPTS', 5);
define('LOCK_DURATION_1', 5 * 60);   // 1st lock: 5 minutes
define('LOCK_DURATION_2', 10 * 60);  // 2nd lock: 10 minutes
define('LOCK_DURATION_3', 30 * 60);  // 3rd lock: 30 minutes

function getLockDuration($level) {
    $durations = [1 => LOCK_DURATION_1, 2 => LOCK_DURATION_2, 3 => LOCK_DURATION_3];
    return $durations[$level] ?? LOCK_DURATION_1;
}

function getClientIP() {
    $ipKeys = ['HTTP_CLIENT_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED', 'HTTP_X_CLUSTER_CLIENT_IP', 'HTTP_FORWARDED_FOR', 'HTTP_FORWARDED', 'REMOTE_ADDR'];
    foreach ($ipKeys as $key) {
        if (!empty($_SERVER[$key])) {
            $ips = explode(',', $_SERVER[$key]);
            return trim($ips[0]);
        }
    }
    return 'unknown';
}

function checkRateLimit($pdo, $username) {
    $stmt = $pdo->prepare("
        SELECT login_attempts, locked_until, lock_level
        FROM users
        WHERE username = ?
        LIMIT 1
    ");
    $stmt->execute([$username]);
    $record = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$record) {
        return ['allowed' => true, 'attempts' => 0, 'lock_level' => 0];
    }

    // Check if currently locked
    if ($record['locked_until'] && strtotime($record['locked_until']) > time()) {
        $remaining = strtotime($record['locked_until']) - time();
        return [
            'allowed' => false,
            'locked' => true,
            'remaining_seconds' => $remaining,
            'lock_level' => $record['lock_level'],
            'message' => "Too many failed attempts. Try again in " . ceil($remaining / 60) . " minute(s)."
        ];
    }

    // Lock expired - allow attempt but keep lock_level for escalation
    if ($record['locked_until'] && strtotime($record['locked_until']) <= time()) {
        return [
            'allowed' => true,
            'attempts' => $record['login_attempts'],
            'lock_level' => $record['lock_level']
        ];
    }

    return [
        'allowed' => true,
        'attempts' => $record['login_attempts'],
        'lock_level' => $record['lock_level']
    ];
}

function recordFailedAttempt($pdo, $username) {
    $stmt = $pdo->prepare("
        SELECT login_attempts, lock_level
        FROM users
        WHERE username = ?
        LIMIT 1
    ");
    $stmt->execute([$username]);
    $record = $stmt->fetch(PDO::FETCH_ASSOC);

    $newAttemptCount = ($record ? $record['login_attempts'] : 0) + 1;
    $currentLockLevel = $record ? $record['lock_level'] : 0;

    // Determine if we should escalate lock level
    $newLockLevel = $currentLockLevel;
    $lockedUntil = null;

    if ($newAttemptCount >= MAX_ATTEMPTS) {
            $newLockLevel = min($currentLockLevel + 1, 4); // Cap at 4 (permanent lock)

            if ($newLockLevel >= 4) {
                // Level 4: permanently lock the account — set to Inactive
                $lockedUntil = null;
            } else {
                $duration = getLockDuration($newLockLevel);
                $lockedUntil = date('Y-m-d H:i:s', time() + $duration);
            }
        }

        // Build UPDATE query — include status = 'Inactive' for level 4
        $updateSql = "UPDATE users SET login_attempts = ?, lock_level = ?, locked_until = ?, last_failed_attempt = CURRENT_TIMESTAMP";
        $updateParams = [$newAttemptCount, $newLockLevel, $lockedUntil];

        if ($newLockLevel >= 4) {
            $updateSql .= ", status = 'Inactive'";
        }

        $updateSql .= " WHERE username = ?";
        $updateParams[] = $username;

        $stmt = $pdo->prepare($updateSql);
        $stmt->execute($updateParams);

        $remainingAttempts = max(0, MAX_ATTEMPTS - $newAttemptCount);
    
        if ($newLockLevel >= 4) {
            return [
                'locked' => true,
                'lock_level' => 4,
                'lock_minutes' => null,
                'inactive' => true,
                'message' => 'Your account has been deactivated due to repeated failed login attempts. Please contact an administrator to reactivate your account.'
            ];
        }

        if ($newLockLevel > $currentLockLevel) {
            $lockMinutes = getLockDuration($newLockLevel) / 60;
        return [
            'locked' => true,
            'lock_level' => $newLockLevel,
            'lock_minutes' => $lockMinutes,
            'message' => "Too many failed attempts. Account locked for {$lockMinutes} minute(s)."
        ];
    }

    return [
        'locked' => false,
        'remaining_attempts' => $remainingAttempts,
        'message' => "Invalid username or password. {$remainingAttempts} attempt(s) remaining before lockout."
    ];
}

function clearAttempts($pdo, $username) {
    $stmt = $pdo->prepare("
        UPDATE users
        SET login_attempts = 0, lock_level = 0, locked_until = NULL, last_failed_attempt = NULL
        WHERE username = ?
    ");
    $stmt->execute([$username]);
}

$data = json_decode(file_get_contents("php://input"), true);
$username = trim($data['username'] ?? '');
$password = trim($data['password'] ?? '');

if (!$username || !$password) {
    echo json_encode(["success" => false, "message" => "Username and password required."]);
    exit;
}

try {
    // Check rate limit BEFORE validating credentials
    $rateLimit = checkRateLimit($pdo, $username);
    
    if (!$rateLimit['allowed']) {
        // Generate new captcha for locked state too
        $num1 = rand(0, 9);
        $num2 = rand(0, 9);
        echo json_encode([
            "success" => false,
            "message" => $rateLimit['message'],
            "locked" => true,
            "lock_level" => $rateLimit['lock_level'],
            "remaining_seconds" => $rateLimit['remaining_seconds'],
            "captcha" => ["num1" => $num1, "num2" => $num2, "answer" => $num1 + $num2]
        ]);
        exit;
    }

    $stmt = $pdo->prepare("
        SELECT u.user_id, u.username, u.password, u.first_name, u.last_name, u.must_change_password, u.status, r.role_name
        FROM users u
        JOIN roles r ON u.role_id = r.role_id
        WHERE u.username = ?
        LIMIT 1
    ");
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    // Check if account is deactivated (permanently locked or admin-disabled)
    if ($user && $user['status'] === 'Inactive') {
        echo json_encode([
            "success" => false,
            "message" => "Your account has been deactivated due to multiple failed login attempts. Please contact an administrator to reactivate your account.",
            "inactive" => true
        ]);
        exit;
    }

    if (!$user || !password_verify($password, $user['password'])) {
        // Record failed attempt
        $failResult = recordFailedAttempt($pdo, $username);
        
        // Generate new captcha for next attempt
        $num1 = rand(0, 9);
        $num2 = rand(0, 9);
        
        $response = [
            "success" => false,
            "message" => $failResult['message'],
            "captcha" => ["num1" => $num1, "num2" => $num2, "answer" => $num1 + $num2]
        ];
        
        if ($failResult['locked']) {
            $response["locked"] = true;
            $response["lock_level"] = $failResult['lock_level'];
            $response["lock_minutes"] = $failResult['lock_minutes'];
        } else {
            $response["remaining_attempts"] = $failResult['remaining_attempts'];
        }
        
        echo json_encode($response);
        exit;
    }

    // Check if user must change password (first login or admin reset)
        if ($user['must_change_password']) {
            // Generate a temporary token for password change flow
            $tempPayload = [
                "user_id" => $user['user_id'],
                "username" => $user['username'],
                "first_name" => $user['first_name'],
                "last_name" => $user['last_name'],
                "role" => $user['role_name'],
                "exp" => time() + (60 * 30) // Valid for 30 minutes for password change
            ];

            $tempToken = generateJWT($tempPayload, JWT_SECRET);

            // Clear attempts on successful auth (even if must change password)
            clearAttempts($pdo, $username);

            echo json_encode([
                "success" => true,
                "must_change_password" => true,
                "token" => $tempToken,
                "redirect" => "/index.html", // Frontend login.js reads data.token, never the URL
                "captcha" => ["num1" => rand(0,9), "num2" => rand(0,9), "answer" => rand(0,9) + rand(0,9)]
            ]);
            exit;
        }

    // Successful login - clear attempts
        clearAttempts($pdo, $username);

        // Log successful login to activity_logs
        require_once __DIR__ . '/log_activity_helper.php';
        logActivity($pdo, $user['user_id'], $user['username'], $user['role_name'], 'LOGIN_SUCCESS',
            "User {$user['username']} ({$user['role_name']}) logged in successfully",
            'users', $user['user_id'], $user['username'], 'COMPLETED');

        // Embed user information directly inside the token payload
        $payload = [
        "user_id" => $user['user_id'],
        "username" => $user['username'],
        "first_name" => $user['first_name'],
        "last_name" => $user['last_name'],
        "role" => $user['role_name'],
        "exp" => time() + (60 * 60 * 8), // Valid for 8 hours
        "last_activity" => time() // For idle timeout tracking
    ];

    // Build the secure token string
    $token = generateJWT($payload, JWT_SECRET);

    // Dynamic routing paths matching your public/ folder layouts
        // HARDCODED for InfinityFree (web root) — paths start with /public/
        $roleRedirect = strtolower($user['role_name']);
        if ($roleRedirect === 'admin') {
            $redirect = '/public/admin/admin_dashboard.html';
        } elseif ($roleRedirect === 'cashier') {
            $redirect = '/public/cashier/cashier_dashboard.html';
        } elseif ($roleRedirect === 'inventory staff') {
            $redirect = '/public/inventoryStaff/inventoryStaff_dashboard.html';
        } elseif ($roleRedirect === 'kitchen staff') {
            $redirect = '/public/kitchenStaff/kitchen_dashboard.html';
        } elseif ($roleRedirect === 'supervisor') {
            $redirect = '/public/supervisor/supervisor_dashboard.html';
        } elseif ($roleRedirect === 'waiter') {
            $redirect = '/public/waiter/waiter_dashboard.html';
        } else {
            $redirect = '/index.html';
        }

    // Generate new captcha for next session
    $num1 = rand(0, 9);
    $num2 = rand(0, 9);

    echo json_encode([
        "success" => true,
        "token" => $token,
        "username" => $user['username'],
        "first_name" => $user['first_name'],
        "last_name" => $user['last_name'],
        "role" => $user['role_name'],
        "redirect" => $redirect,
        "captcha" => ["num1" => $num1, "num2" => $num2, "answer" => $num1 + $num2]
    ]);
} catch (Exception $e) {
    echo json_encode(["success" => false, "message" => "Server error: " . $e->getMessage()]);
}