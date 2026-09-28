<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin', 'Supervisor']);

$stmt = $pdo->prepare("
    SELECT
        u.user_id,
        u.username,
        u.first_name,
        u.last_name,
        u.gender,
        u.contact_number,
        u.email_address,
        u.social_account,
        u.role_id,
        u.status,
        u.must_change_password,
        CASE WHEN u.must_change_password = 1 THEN u.temp_code ELSE NULL END AS temp_code,
        r.role_name
    FROM users u
    INNER JOIN roles r ON u.role_id = r.role_id
    ORDER BY u.created_at ASC
");

$stmt->execute();
$users = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode($users);
