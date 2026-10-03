<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin']);
require_once __DIR__ . "/../../log_activity_helper.php";
header("Content-Type: application/json");

$input = json_decode(file_get_contents("php://input"), true);
$menu_item_id = $input['menu_item_id'] ?? '';

if (!$menu_item_id) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Menu item ID required"]);
    exit;
}

$stmtImg = $pdo->prepare("SELECT item_name, image_url FROM menu_items WHERE menu_item_id = ?");
$stmtImg->execute([$menu_item_id]);
$menu = $stmtImg->fetch(PDO::FETCH_ASSOC);
$itemName = $menu['item_name'] ?? 'Unknown';
$imageUrl = $menu['image_url'] ?? '';

try {
    $stmt = $pdo->prepare("DELETE FROM menu_items WHERE menu_item_id = ?");
    $stmt->execute([$menu_item_id]);

    if ($imageUrl && $imageUrl !== '') {
        // Stored image_url looks like "/images/menu/xxx.jpg" (leading slash).
        // Strip it, then resolve from the project root (one level above /backend).
        $relative = ltrim($imageUrl, '/');
        $absolute = realpath(__DIR__ . '/../../') . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        if ($absolute && file_exists($absolute)) {
            @unlink($absolute);
        }
    }

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'MENU_DELETE', "Deleted {$itemName}",
        'menu_item', $menu_item_id, (string)$menu_item_id, 'Inactive');

    echo json_encode(["success" => true, "message" => "Menu item deleted successfully"]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to delete menu item"]);
}
