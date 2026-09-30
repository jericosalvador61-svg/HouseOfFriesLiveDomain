<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../choices_addons_helper.php'; // REQ-040

$auth = authenticate(['Cashier', 'Admin']);

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['order_id'], $data['menu_item_id'])) {
    echo json_encode(['success' => false, 'message' => 'Missing required data.']);
    exit;
}

$orderId    = (int)$data['order_id'];
$menuItemId = (int)$data['menu_item_id'];

try {
    $pdo->beginTransaction();

    // Server-authoritative base price (never trust the client-sent price).
    $availStmt = $pdo->prepare("SELECT status, item_name, price FROM menu_items WHERE menu_item_id = ?");
    $availStmt->execute([$menuItemId]);
    $availRow = $availStmt->fetch();
    if (!$availRow || $availRow['status'] !== 'Available') {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'message' => 'This item is no longer available and cannot be added to the order.']);
        exit;
    }

    $itemName = $availRow['item_name'];
    $basePrice = (float)$availRow['price'];

    // REQ-040: validate choices + add-ons, fold add-on price into the line.
    $freeText = trim((string)($data['special_instructions'] ?? ''));
    $choices  = is_array($data['choices'] ?? null) ? $data['choices'] : [];
    $addons   = is_array($data['addons']  ?? null) ? $data['addons']  : [];

    $validated = hof_validate_choices_addons($pdo, $menuItemId, $freeText, $choices, $addons, !empty($data['configured']));
    if (!$validated['ok']) {
        $pdo->rollBack();
        echo json_encode(['success' => false, 'message' => $validated['message']]);
        exit;
    }

    $linePrice      = round($basePrice + $validated['addon_total'], 2);
    $instructions   = $validated['special_instructions'];
    $qty            = (int)($data['quantity'] ?? 1);
    $qty            = max(1, min(99, $qty));

    // REQ-040: a configured line is always inserted as its own row so the
    // folded price + composed instructions are preserved per configuration.
    // (The legacy "qty+1 merge on repeat tap" behaviour is intentionally not
    // applied here because the same base item may be ordered with different
    // add-ons, which must not share a line.)
    $insertStmt = $pdo->prepare("INSERT INTO order_items (order_id, menu_item_id, quantity, price, special_instructions, created_at) VALUES (?, ?, ?, ?, ?, NOW())");
    $insertStmt->execute([$orderId, $menuItemId, $qty, $linePrice, $instructions]);

    $updateOrder = $pdo->prepare("
        UPDATE orders 
        SET total_amount = (SELECT SUM(subtotal) FROM order_items WHERE order_id = ? AND is_deleted = 0),
            updated_at = NOW()
        WHERE order_id = ?
    ");
    $updateOrder->execute([$orderId, $orderId]);

    $pdo->commit();

    logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
        'ADD_ITEM_TO_ORDER', "Added {$itemName} x{$qty} to order",
        'order', $orderId);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    error_log('add_item_to_order error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}
