<?php
// update_menu.php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin']);
require_once __DIR__ . "/../../log_activity_helper.php";
header("Content-Type: application/json");

// Note: In your HTML modal, the input hidden ID uses name="menu_id"
$menu_item_id = $_POST['menu_id'] ?? '';
$item_name    = trim($_POST['item_name'] ?? '');
$category_id  = $_POST['category_id'] ?? '';
$price        = $_POST['price'] ?? '';
$status       = $_POST['status'] ?? 'Available';
$image        = $_FILES['image'] ?? null;
$prepTime     = isset($_POST['estimated_prep_time_minutes']) ? max(0, min(480, (int)$_POST['estimated_prep_time_minutes'])) : 0;

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

if (!$menu_item_id || !$item_name || !$category_id || !$price) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "All fields are required"]);
    exit;
}

$stmtCheck = $pdo->prepare("SELECT image_url, image_blob FROM menu_items WHERE menu_item_id = ?");
$stmtCheck->execute([$menu_item_id]);
$menu = $stmtCheck->fetch(PDO::FETCH_ASSOC);
if (!$menu) {
    http_response_code(404);
    echo json_encode(["success" => false, "message" => "Menu item not found"]);
    exit;
}

$imageUrl = $menu['image_url'];
if ($image_blob === null) {
    // Preserve the existing blob when no new image was uploaded.
    $image_blob = $menu['image_blob'];
}

if ($image && $image['tmp_name']) {
    $targetDir = __DIR__ . "/../../../images/menu/";
    // Remove spaces and special characters from the filename to prevent URL/server errors
    $cleanFileName = preg_replace('/[^A-Za-z0-9.\-_]/', '_', basename($image['name']));
    $imageName = uniqid() . "_" . $cleanFileName;
    $targetFile = $targetDir . $imageName;

    if (!move_uploaded_file($image['tmp_name'], $targetFile)) {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "Failed to upload new image"]);
        exit;
    }

    if ($imageUrl && $imageUrl !== '') {
        // Stored image_url looks like "/images/menu/xxx.jpg" (leading slash).
        // Strip it, then resolve from the project root (one level above /backend).
        $relative = ltrim($imageUrl, '/');
        $absolute = realpath(__DIR__ . '/../../') . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relative);
        if ($absolute && file_exists($absolute)) {
            @unlink($absolute);
        }
    }

    $imageUrl = "/images/menu/" . $imageName; // Ensure relative paths map cleanly
}

try {
    // UPDATED: Added status and prep_time fields + REQ-057 image_blob column
    $stmt = $pdo->prepare("
        UPDATE menu_items
        SET item_name = :item_name, 
            category_id = :category_id, 
            price = :price, 
            image_url = :image_url,
            image_blob = :image_blob,
            status = :status,
            estimated_prep_time_minutes = :estimated_prep_time_minutes
        WHERE menu_item_id = :menu_item_id
    ");

    $stmt->execute([
        ":item_name"      => $item_name,
        ":category_id"    => $category_id,
        ":price"          => $price,
        ":image_url"      => $imageUrl,
        ":image_blob"     => $image_blob,
        ":status"         => $status,
        ":estimated_prep_time_minutes" => $prepTime,
        ":menu_item_id"   => $menu_item_id
    ]);

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'MENU_UPDATE', "Updated {$item_name}",
        'menu_item', $menu_item_id, (string)$menu_item_id, $status ?: 'Active');

    echo json_encode(["success" => true, "message" => "Menu updated successfully"]);
} catch (PDOException $e) {
    error_log('update_menu error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to update menu. Please try again."]);
}
