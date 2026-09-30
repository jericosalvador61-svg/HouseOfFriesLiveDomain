<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$user = authenticate(['Admin', 'Supervisor', 'Kitchen Staff']);

header("Content-Type: application/json");

try {
    $stmt = $pdo->prepare("SELECT * FROM menu_categories WHERE status = 'Active' ORDER BY category_name ASC");
    $stmt->execute();
    $categories = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($categories);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        "success" => false,
        "message" => "Failed to fetch categories",
        "error" => $e->getMessage()
    ]);
}
