<?php
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

$cat_id = $_GET['category_id'] ?? null;

try {
    $query = "SELECT menu_item_id, item_name, price, status FROM menu_items WHERE status = 'Available'";
    if ($cat_id && $cat_id !== 'all') {
        $query .= " AND category_id = :cat_id";
    }

    $stmt = $pdo->prepare($query);
    if ($cat_id && $cat_id !== 'all') {
        $stmt->execute(['cat_id' => $cat_id]);
    } else {
        $stmt->execute();
    }
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // REQ-040: Per-item choices + global add-ons, fetched once and grouped in PHP.
    // Graceful degradation: if the new tables aren't applied yet, return empty
    // choices/add-ons instead of killing the cashier grid (MEDIUM-2).
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
        error_log('get_items_by_category choices/addons degrade: ' . $e->getMessage());
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

    echo json_encode(['success' => true, 'items' => $items]);
} catch (PDOException $e) {
    error_log('get_items_by_category error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Failed to load items.']);
}
