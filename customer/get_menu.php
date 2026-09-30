<?php
// get_menu.php
header('Content-Type: application/json');
require_once __DIR__ . "/../backend/db.php";
require_once __DIR__ . "/../backend/image_helper.php";

try {
    // UPDATED: Added 'status' to the SELECT fields and removed the WHERE restriction
    $stmt = $pdo->prepare("SELECT menu_item_id, item_name, description, image_url, category_id, price, status 
                           FROM menu_items 
                           ORDER BY item_name ASC");
    $stmt->execute();
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC); // Fetching as associative array cleanly

    // REQ-040: Per-item choices + global add-ons, fetched once and grouped in PHP.
    // Graceful degradation: if the new tables aren't applied yet, return empty
    // choices/add-ons instead of killing the whole menu (MEDIUM-2).
    $choicesByItem = [];
    $addons = [];
    try {
        $choicesStmt = $pdo->query("
            SELECT menu_choice_id, menu_item_id, group_name, choice_name
            FROM menu_item_choices
            WHERE status = 'Active'
            ORDER BY menu_choice_id ASC
        ");
        foreach ($choicesStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $choicesByItem[$row['menu_item_id']][$row['group_name']][] = [
                'menu_choice_id' => (int)$row['menu_choice_id'],
                'choice_name'    => $row['choice_name']
            ];
        }

        $addonsStmt = $pdo->query("
            SELECT menu_addon_id, addon_name, price
            FROM menu_item_addons
            WHERE status = 'Active'
            ORDER BY sort_order ASC
        ");
        $addons = array_map(function ($a) {
            return [
                'menu_addon_id' => (int)$a['menu_addon_id'],
                'addon_name'    => $a['addon_name'],
                'price'         => (float)$a['price']
            ];
        }, $addonsStmt->fetchAll(PDO::FETCH_ASSOC));
    } catch (PDOException $e) {
        error_log('get_menu choices/addons degrade: ' . $e->getMessage());
        $choicesByItem = [];
        $addons = [];
    }

    foreach ($items as &$item) {
        $itemChoices = [];
        foreach (($choicesByItem[$item['menu_item_id']] ?? []) as $group => $options) {
            $itemChoices[] = ['group_name' => $group, 'options' => $options];
        }
        $item['choices'] = $itemChoices;
        $item['addons'] = $addons;
    }
    unset($item);

    // Normalize legacy image paths (e.g. /HOF1/images/...) to root-absolute /images/menu/...
    hof_normalize_menu_images($items);

    echo json_encode($items);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["error" => $e->getMessage()]);
}
