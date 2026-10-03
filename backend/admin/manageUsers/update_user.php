<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin']);
require_once __DIR__ . "/../../log_activity_helper.php";

header("Content-Type: application/json");

$user_id        = $_POST['user_id'] ?? '';
$username       = trim($_POST['username'] ?? '');
$password       = trim($_POST['password'] ?? '');
$first_name     = trim($_POST['first_name'] ?? null);
$last_name      = trim($_POST['last_name'] ?? null);
$gender         = $_POST['gender'] ?? null;
$contact_number = trim($_POST['contact_number'] ?? null);
$email_address  = trim($_POST['email_address'] ?? null);
$social_account = trim($_POST['social_account'] ?? null);
$role_id        = $_POST['role_id'] ?? '';
$status         = $_POST['status'] ?? 'Active';

$first_name     = $first_name === '' ? null : $first_name;
$last_name      = $last_name === '' ? null : $last_name;
$gender         = $gender === '' ? null : $gender;
$contact_number = $contact_number === '' ? null : $contact_number;
$email_address  = $email_address === '' ? null : $email_address;
$social_account = $social_account === '' ? null : $social_account;


if (!$user_id || $username === '' || $role_id === '') {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "User ID, username, and role are required"
    ]);
    exit;
}

// Server-side email validation
if ($email_address !== null && $email_address !== '' && !filter_var($email_address, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "Invalid email format"
    ]);
    exit;
}

try {

    $check = $pdo->prepare("
        SELECT user_id
        FROM users
        WHERE username = :username AND user_id != :user_id
    ");
    $check->execute([
        ":username" => $username,
        ":user_id"  => $user_id
    ]);

    if ($check->fetch()) {
        http_response_code(400);
        echo json_encode([
            "success" => false,
            "message" => "Username already exists"
        ]);
        exit;
    }


    $hashedPassword = $password !== ''
        ? password_hash($password, PASSWORD_DEFAULT)
        : null;


    $fields = "
        username = :username,
        first_name = :first_name,
        last_name = :last_name,
        gender = :gender,
        contact_number = :contact_number,
        email_address = :email_address,
        social_account = :social_account,
        role_id = :role_id,
        status = :status
    ";

    // If password is being changed by admin, set must_change_password = 1
    // Requirement #70: store the plain code so admin can look it up until the user changes it
    $mustChangePassword = false;
    if ($hashedPassword) {
        $fields .= ", password = :password, must_change_password = 1, temp_code = :temp_code";
        $mustChangePassword = true;
    }

    $stmt = $pdo->prepare("UPDATE users SET $fields WHERE user_id = :user_id");

    $params = [
        ":username"       => $username,
        ":first_name"     => $first_name,
        ":last_name"      => $last_name,
        ":gender"         => $gender,
        ":contact_number" => $contact_number,
        ":email_address"  => $email_address,
        ":social_account" => $social_account,
        ":role_id"        => $role_id,
        ":status"         => $status,
        ":user_id"        => $user_id
    ];

    if ($hashedPassword) {
        $params[":password"] = $hashedPassword;
        $params[":temp_code"] = $password; // visible to admin until first-login change
    }


    $stmt->execute($params);

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'USER_UPDATE', "Updated {$username}",
        'user', $user_id, $username, $status ?: 'Active');

    echo json_encode([
        "success" => true,
        "message" => "User updated successfully",
        "must_change_password" => $mustChangePassword
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "message" => "Failed to update user",
    ]);
}