<?php
/**
 * Get Menu for Landing Page - House of Fries
 * Public, read-only JSON endpoint for the landing page menu.
 * Self-contained: has its own connection + path normalizer so it works
 * even if only this file is present in /backend on the live host.
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$host = 'sql201.infinityfree.com';
$db   = 'if0_42560270_house_of_fries_db';
$user = 'if0_42560270';
$pass = 'houseoffries';

try {
    $pdo = new PDO(
        "mysql:host=$host;dbname=$db;charset=utf8mb4",
        $user,
        $pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );

    $cats = $pdo->query(
        "SELECT category_id, category_name FROM menu_categories WHERE status = 'Active' ORDER BY category_id"
    )->fetchAll();

    $items = $pdo->query(
        "SELECT menu_item_id, item_name, category_id, CAST(price AS DOUBLE) AS price, image_url
         FROM menu_items
         WHERE status = 'Available'
         ORDER BY category_id, menu_item_id"
    )->fetchAll();

    // Prefer optimized WebP thumb (/landing/images/m/…) when it exists,
    // otherwise fall back to the original root-absolute /images/menu/<file>.
    foreach ($items as &$it) {
        $u = trim((string)$it['image_url']);
        if ($u === '') { $it['image_url'] = null; continue; }
        if (preg_match('#^https?://#i', $u)) continue; // external URL: leave as-is
        $file = basename(parse_url($u, PHP_URL_PATH) ?: $u);
        if ($file === '') { $it['image_url'] = null; continue; }
        $base  = substr(pathinfo($file, PATHINFO_FILENAME), 0, 40);
        $base  = str_replace(' ', '_', $base);
        $thumb = '/landing/images/m/' . $base . '.webp';
        if (file_exists($_SERVER['DOCUMENT_ROOT'] . $thumb)) {
            $it['image_url'] = $thumb;
        } else {
            $it['image_url'] = '/images/menu/' . str_replace(' ', '%20', $file);
        }
    }
    unset($it);

    echo json_encode(
        ['success' => true, 'categories' => $cats, 'items' => $items],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
} catch (Exception | PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load menu']);
}
