<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
authenticate(['Admin']);
header("Content-Type: application/json");

try {
    // All menu items (even those with no choices, so the admin can add to them)
    $stmt = $pdo->prepare("
        SELECT m.menu_item_id, m.item_name, c.category_name
        FROM menu_items m
        LEFT JOIN menu_categories c ON m.category_id = c.category_id
        ORDER BY c.category_name, m.item_name
    ");
    $stmt->execute();
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // All choices (Active + Inactive so hidden rows can be managed), ordered by group then sort_order
    $cStmt = $pdo->query("
        SELECT menu_choice_id, menu_item_id, group_name, choice_name, status
        FROM menu_item_choices
        ORDER BY group_name ASC, sort_order ASC, menu_choice_id ASC
    ");
    $choicesByItem = [];
    foreach ($cStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $itemId = (int)$row['menu_item_id'];
        $group  = $row['group_name'];
        if (!isset($choicesByItem[$itemId])) { $choicesByItem[$itemId] = []; }
        if (!isset($choicesByItem[$itemId][$group])) { $choicesByItem[$itemId][$group] = []; }
        $choicesByItem[$itemId][$group][] = [
            'menu_choice_id' => (int)$row['menu_choice_id'],
            'choice_name'    => $row['choice_name'],
            'status'         => $row['status']
        ];
    }

    $menuItems = [];
    foreach ($items as $item) {
        $choices = [];
        foreach (($choicesByItem[(int)$item['menu_item_id']] ?? []) as $group => $options) {
            $choices[] = [
                'choice_group_id' => null,
                'group_name'      => $group,
                'options'         => $options
            ];
        }
        $menuItems[] = [
            'menu_item_id' => (int)$item['menu_item_id'],
            'item_name'    => $item['item_name'],
            'category_name'=> $item['category_name'] ?? '',
            'choices'      => $choices
        ];
    }

    // Global add-ons (Active + Inactive), ordered by sort_order
    $aStmt = $pdo->query("
        SELECT menu_addon_id, addon_name, price, status
        FROM menu_item_addons
        ORDER BY sort_order ASC, menu_addon_id ASC
    ");
    $addons = array_map(function ($a) {
        return [
            'menu_addon_id' => (int)$a['menu_addon_id'],
            'addon_name'    => $a['addon_name'],
            'price'         => (float)$a['price'],
            'status'        => $a['status']
        ];
    }, $aStmt->fetchAll(PDO::FETCH_ASSOC));

    echo json_encode(['success' => true, 'menu_items' => $menuItems, 'global_addons' => $addons]);
} catch (PDOException $e) {
    error_log('fetch_choices error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to fetch choices and add-ons.']);
}
