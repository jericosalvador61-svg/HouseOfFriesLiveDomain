<?php
/**
 * HOF Waiter API - Full menu list for the Create Order page
 * Shape matches createOrder.js: { success, menu: [{id,name,description,image,price,status}] }
 * Image paths are normalized for root deployment (/images/menu/<file>).
 */
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Waiter', 'Admin', 'Supervisor']);
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../image_helper.php';

try {
    // Only orderable items are returned - an Unavailable item must never be
    // addable to a cart. (menu_items has no is_deleted column.)
    $stmt = $pdo->query("
        SELECT menu_item_id, item_name, description, image_url, price, status
        FROM menu_items
        WHERE status = 'Available'
        ORDER BY item_name ASC
    ");
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

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
        error_log('get_menu_items choices/addons degrade: ' . $e->getMessage());
        $choicesByItem = [];
        $addons = [];
    }

    $menu = array_map(function ($item) use ($choicesByItem, $addons) {
        $itemChoices = [];
        foreach (($choicesByItem[$item['menu_item_id']] ?? []) as $group => $options) {
            $itemChoices[] = ['group_name' => $group, 'options' => $options];
        }
        return [
            'id'          => (int)$item['menu_item_id'],
            'name'        => $item['item_name'],
            'description' => $item['description'],
            'image'       => hof_normalize_image($item['image_url'], 'menu'),
            'price'       => (float)$item['price'],
            'status'      => $item['status'],
            'choices'     => $itemChoices,
            'addons'      => $addons
        ];
    }, $items);

    echo json_encode(['success' => true, 'menu' => $menu]);
} catch (PDOException $e) {
    error_log('get_menu_items error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load the menu.']);
}