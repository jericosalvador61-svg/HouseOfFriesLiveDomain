<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$user = authenticate(['Admin', 'Supervisor', 'Kitchen Staff']);
require_once __DIR__ . "/../../image_helper.php";
require_once __DIR__ . "/../../image_blob_helper.php";
header("Content-Type: application/json");

try {
    $stmt = $pdo->prepare("
        SELECT m.menu_item_id, m.item_name, m.description, m.price, m.image_url, m.image_blob, m.category_id, m.status, m.estimated_prep_time_minutes,
               c.category_name
        FROM menu_items m
        LEFT JOIN menu_categories c ON m.category_id = c.category_id
        ORDER BY c.category_name, m.item_name 
    ");
    $stmt->execute();
    $menus = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // REQ-057: base64-encode menu image_blob so cards render data URIs.
    hof_encode_blob_columns($menus, ['image_blob' => 'image_blob']);

    // REQ-040: Per-item choices + global add-ons, fetched once and grouped in PHP.
    // Graceful degradation: if the new tables aren't applied yet, return empty
    // choices/add-ons instead of killing the admin menu (MEDIUM-2).
    $choicesByItem = [];
    $addons = [];
    try {
        $choicesStmt = $pdo->query("
            SELECT menu_choice_id, menu_item_id, group_name, choice_name, image_blob
            FROM menu_item_choices
            WHERE status = 'Active'
            ORDER BY menu_choice_id ASC
        ");
        foreach ($choicesStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $choicesByItem[$row['menu_item_id']][$row['group_name']][] = [
                'menu_choice_id' => (int)$row['menu_choice_id'],
                'choice_name'    => $row['choice_name'],
                'image_blob'     => hof_blob_data_uri($row['image_blob'])
            ];
        }

        $addonsStmt = $pdo->query("
            SELECT menu_addon_id, addon_name, price, image_blob
            FROM menu_item_addons
            WHERE status = 'Active'
            ORDER BY sort_order ASC
        ");
        $addons = array_map(function ($a) {
            return [
                'menu_addon_id' => (int)$a['menu_addon_id'],
                'addon_name'    => $a['addon_name'],
                'price'         => (float)$a['price'],
                'image_blob'    => hof_blob_data_uri($a['image_blob'])
            ];
        }, $addonsStmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (PDOException $e) {
        error_log('fetch_menus choices/addons degrade: ' . $e->getMessage());
        $choicesByItem = [];
        $addons = [];
    }

    foreach ($menus as &$menu) {
        $itemChoices = [];
        foreach (($choicesByItem[$menu['menu_item_id']] ?? []) as $group => $options) {
            $itemChoices[] = ['group_name' => $group, 'options' => $options];
        }
        $menu['choices'] = $itemChoices;
        $menu['addons'] = $addons;
    }
    unset($menu);

    // Normalize legacy image paths (e.g. /HOF1/images/...) to root-absolute /images/menu/...
    hof_normalize_menu_images($menus);

    echo json_encode($menus);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to fetch menus"]);
}