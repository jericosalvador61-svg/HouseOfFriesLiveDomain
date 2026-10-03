<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin']);
require_once __DIR__ . "/../../log_activity_helper.php";
header("Content-Type: application/json");



$item_name   = trim($_POST['item_name'] ?? '');
$category_id = $_POST['category_id'] ?? '';
$price       = $_POST['price'] ?? '';
$description = trim($_POST['description'] ?? '');
$image       = $_FILES['image'] ?? null;
$prepTime    = isset($_POST['estimated_prep_time_minutes']) ? max(0, min(480, (int)$_POST['estimated_prep_time_minutes'])) : 0;

// REQ-057: BLOB image upload (base64 data URI) — takes precedence over the URL field.
$imgBlobRaw = $_POST['image_blob'] ?? '';
$image_blob = null;
if (is_string($imgBlobRaw) && trim($imgBlobRaw) !== '') {
    $b64 = $imgBlobRaw;
    if (strpos($b64, 'base64,') !== false) {
        $b64 = substr($b64, strpos($b64, 'base64,') + 7);
    }
    $decoded = base64_decode($b64, true);
    if ($decoded !== false && $decoded !== '') {
        $image_blob = $decoded;
    }
}

if (!$item_name || !$category_id || !$price) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Item name, category, and price are required"]);
    exit;
}

$imageUrl = null;
if ($image && $image['tmp_name']) {
    /** * PATH CORRECTION:
     * Based on your screenshot, the folder structure is:
     * HOF1/backend/admin/manageMenu/add_menu.php
     * HOF1/images/menu/
     * To get from add_menu.php to images/menu, we go up THREE levels.
     */
    $targetDir = __DIR__ . "/../../../images/menu/";

    if (!is_dir($targetDir)) {
        mkdir($targetDir, 0755, true);
    }

    // Remove spaces and special characters from the filename to prevent URL/server errors
    $cleanFileName = preg_replace('/[^A-Za-z0-9.\-_]/', '_', basename($image['name']));
    $imageName = uniqid() . "_" . $cleanFileName;
    $targetFile = $targetDir . $imageName;

    if (!move_uploaded_file($image['tmp_name'], $targetFile)) {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "Failed to upload image to: " . $targetDir]);
        exit;
    }

    // This is the URL the browser will use to show the image
    // We save it as an absolute path from the root so it's easy for JS to read
    $imageUrl = "/images/menu/" . $imageName;
}

try {
    $stmt = $pdo->prepare("
        INSERT INTO menu_items (item_name, description, category_id, price, image_url, image_blob, estimated_prep_time_minutes)
        VALUES (:item_name, :description, :category_id, :price, :image_url, :image_blob, :estimated_prep_time_minutes)
    ");
    $stmt->execute([
        ":item_name"   => $item_name,
        ":description" => $description,
        ":category_id" => $category_id,
        ":price"       => $price,
        ":image_url"   => $imageUrl,
        ":image_blob"  => $image_blob,
        ":estimated_prep_time_minutes" => $prepTime
    ]);

    $menuItemId = (int) $pdo->lastInsertId();
    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'MENU_ADD', "Added {$item_name} (₱{$price})",
        'menu_item', $menuItemId, (string)$menuItemId, 'Active');

    echo json_encode(["success" => true, "message" => "Menu added successfully"]);
} catch (PDOException $e) {
    error_log('add_menu error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Database error. Please try again."]);
}
