<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin', 'Supervisor']);

$stmt = $pdo->prepare("
    SELECT role_id, role_name 
    FROM roles 
    ORDER BY role_name
");

$stmt->execute();
$roles = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo json_encode($roles);
