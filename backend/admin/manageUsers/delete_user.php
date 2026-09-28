<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin']);
require_once __DIR__ . "/../../log_activity_helper.php";

$data = json_decode(file_get_contents("php://input"), true);
$user_id = $data['user_id'] ?? '';

if (!$user_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "User ID is required"]);
    exit;
}

try {
    $stmtUser = $pdo->prepare("SELECT username FROM users WHERE user_id = ?");
    $stmtUser->execute([$user_id]);
    $deleteUsername = $stmtUser->fetchColumn() ?: 'Unknown';

    $stmt = $pdo->prepare("UPDATE users SET status='Inactive' WHERE user_id=:user_id");
    $stmt->execute([":user_id" => $user_id]);

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'USER_DELETE', "Deleted {$deleteUsername}",
        'user', $user_id, null);

    echo json_encode(["success" => true]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to deactivate user"]);
}
