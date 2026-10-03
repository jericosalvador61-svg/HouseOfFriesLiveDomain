<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin']);
require_once __DIR__ . "/temp_code_helper.php";
require_once __DIR__ . "/../../log_activity_helper.php";

$username       = trim($_POST['username'] ?? '');
$password       = trim($_POST['password'] ?? '');
$first_name     = trim($_POST['first_name'] ?? '');
$last_name      = trim($_POST['last_name'] ?? '');
$gender         = $_POST['gender'] ?? '';
$contact_number = trim($_POST['contact_number'] ?? '');
$email_address  = trim($_POST['email_address'] ?? '');
$social_account = trim($_POST['social_account'] ?? '');
$role_id        = $_POST['role_id'] ?? '';
$status         = $_POST['status'] ?? 'Active';


if ($username === '' || $role_id === '') {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "Username and role are required"
    ]);
    exit;
}

// Server-side email validation
if ($email_address !== '' && !filter_var($email_address, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode([
        "success" => false,
        "message" => "Invalid email format"
    ]);
    exit;
}


if ($password === '') {
    // Requirement #70: system generates a 6-character code
    $tempPassword = hof_generate_temp_code(8);
} else {
    // Admin typed their own code/password - keep it as-is
    $tempPassword = $password;
}
$hashedPassword = password_hash($tempPassword, PASSWORD_DEFAULT);


try {
    $stmt = $pdo->prepare("
        INSERT INTO users
        (username, password, first_name, last_name, gender, contact_number, email_address, social_account, role_id, status, must_change_password, temp_code)
        VALUES
        (:username, :password, :first_name, :last_name, :gender, :contact_number, :email_address, :social_account, :role_id, :status, 1, :temp_code)
    ");

    $stmt->execute([
        ":username"       => $username,
        ":password"       => $hashedPassword,
        ":first_name"     => $first_name,
        ":last_name"      => $last_name,
        ":gender"         => $gender,
        ":contact_number" => $contact_number,
        ":email_address"  => $email_address,
        ":social_account" => $social_account,
        ":role_id"        => $role_id,
        ":status"         => $status,
        ":temp_code"      => $tempPassword
    ]);

    $userId = (int) $pdo->lastInsertId();
    $stmtRole = $pdo->prepare("SELECT role_name FROM roles WHERE role_id = ?");
    $stmtRole->execute([$role_id]);
    $roleName = $stmtRole->fetchColumn() ?: 'Unknown';
    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'USER_ADD', "Created {$username} as {$roleName}",
        'user', $userId, $username, 'Active');

    echo json_encode([
        "success"       => true,
        "temp_password" => $tempPassword,
        "must_change_password" => true
    ]);
} catch (PDOException $e) {
    if ($e->getCode() == 23000) {
        http_response_code(409);
        echo json_encode([
            "success" => false,
            "message" => "Username or Email already exists"
        ]);
    } else {
        http_response_code(500);
        echo json_encode([
            "success" => false,
            "message" => "Failed to add user"
        ]);
    }
}
