<?php
header("Content-Type: application/json; charset=utf-8");

ini_set('display_errors', 0);
error_reporting(E_ALL);

try {
    require_once __DIR__ . "/../backend/db.php";
    require_once __DIR__ . "/../backend/rate_limit.php";
    require_once __DIR__ . "/../backend/log_activity_helper.php";
    require_once __DIR__ . "/../backend/choices_addons_helper.php"; // REQ-040

    hof_rate_limit('update_existing_order', 10, 60);

    $input = json_decode(file_get_contents("php://input"), true);
    
    $orderId = $input['order_id'] ?? null;
    $refNumber = $input['reference_number'] ?? null;
    $items = $input['items'] ?? [];

    if (empty($orderId) || empty($refNumber) || empty($items)) {
        echo json_encode(["success" => false, "message" => "Missing order ID, reference number, or items."]);
        exit;
    }

    $pdo->beginTransaction();

    // 1. Fetch order with status + payment_status + table_id + reference_number
    $stmt = $pdo->prepare("SELECT status, payment_status, table_id, order_type, reference_number FROM orders WHERE order_id = ?");
    $stmt->execute([$orderId]);
    $order = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$order) {
        $pdo->rollBack();
        echo json_encode(["success" => false, "message" => "Order not found."]);
        exit;
    }

    // 2. 409 guard: only PENDING + unpaid orders can be edited
    if ($order['status'] !== 'PENDING' || $order['payment_status'] === 'COMPLETED') {
        $pdo->rollBack();
        http_response_code(409);
        echo json_encode(["success" => false, "message" => "This order is already being prepared and can no longer be edited. You can place a new order instead."]);
        exit;
    }

    // 3. Verify reference number matches
    if ($order['reference_number'] !== $refNumber) {
        $pdo->rollBack();
        echo json_encode(["success" => false, "message" => "Reference number mismatch."]);
        exit;
    }

    // 4. Group cart items (same as place_order.php pattern)
    //    REQ-040: keyed by a CONFIGURATION SIGNATURE so distinct configs of the
    //    same base item never collapse into one line.
    $groupedCart = [];
    foreach ($items as $item) {
        $itemId = (int)($item['menu_item_id'] ?? 0);
        if ($itemId < 1) {
            $pdo->rollBack();
            echo json_encode(['success' => false, 'message' => 'Invalid cart item.']);
            exit;
        }
        $instructions = trim($item['special_instructions'] ?? '');
        $lineChoices = [];
        foreach (($item['choices'] ?? []) as $cid) {
            $lineChoices[] = (int)$cid;
        }
        sort($lineChoices);
        $lineAddons = [];
        foreach (($item['addons'] ?? []) as $addon) {
            if (!is_array($addon)) continue;
            $lineAddons[] = [
                'menu_addon_id' => (int)($addon['menu_addon_id'] ?? 0),
                'quantity'      => max(1, (int)($addon['quantity'] ?? 1))
            ];
        }
        usort($lineAddons, function ($a, $b) {
            return $a['menu_addon_id'] <=> $b['menu_addon_id'];
        });
        $configured = !empty($item['configured']);

        $sig = json_encode([
            'i' => $itemId,
            'c' => $lineChoices,
            'a' => $lineAddons,
            's' => $configured ? '__configured__' : $instructions
        ], JSON_UNESCAPED_SLASHES);

        if (!isset($groupedCart[$sig])) {
            $groupedCart[$sig] = [
                'menu_item_id' => $itemId,
                'quantity' => 0,
                'special_instructions' => $instructions,
                'choices' => $lineChoices,
                'addons' => $lineAddons,
                'configured' => $configured
            ];
        }
        // Always accumulate quantity — the first occurrence included.
        $groupedCart[$sig]['quantity'] += isset($item['quantity']) ? (int)$item['quantity'] : 1;
    }

    // 5. Fetch server-side prices from menu_items (never trust client prices)
    $menuIds = array_values(array_unique(array_map(function ($g) {
        return (int)$g['menu_item_id'];
    }, $groupedCart)));
    $placeholders = implode(',', array_fill(0, count($menuIds), '?'));
    $priceStmt = $pdo->prepare("SELECT menu_item_id, price, item_name, status FROM menu_items WHERE menu_item_id IN ($placeholders)");
    $priceStmt->execute($menuIds);
    $menuRows = [];
    while ($row = $priceStmt->fetch(PDO::FETCH_ASSOC)) {
        $menuRows[$row['menu_item_id']] = $row;
    }

    // Check availability
    $unavailable = [];
    $menuPrices = [];
    foreach ($groupedCart as $sig => $item) {
        $itemId = (int)$item['menu_item_id'];
        if (!isset($menuRows[$itemId])) {
            $pdo->rollBack();
            echo json_encode(['success' => false, 'message' => 'Menu item not found: ' . $itemId]);
            exit;
        }
        if ($menuRows[$itemId]['status'] !== 'Available') {
            $unavailable[] = $menuRows[$itemId]['item_name'];
        }
        $menuPrices[$itemId] = (float)$menuRows[$itemId]['price'];
    }

    if (!empty($unavailable)) {
        $pdo->rollBack();
        echo json_encode([
            'success' => false,
            'unavailable' => $unavailable,
            'message' => 'Some items are no longer available: ' . implode(', ', $unavailable) . '. Please remove or replace them.'
        ]);
        exit;
    }

    // 6. Soft-delete old order_items (mark deleted to preserve audit trail)
    $deleteItems = $pdo->prepare("UPDATE order_items SET is_deleted = 1, updated_at = NOW() WHERE order_id = ? AND is_deleted = 0");
    $deleteItems->execute([$orderId]);

    // 7. Re-insert grouped items with server-recomputed prices
    // NOTE: subtotal is GENERATED ALWAYS AS (quantity * price) — never write it
    $insertItem = $pdo->prepare("INSERT INTO order_items (order_id, menu_item_id, quantity, price, special_instructions, created_at) VALUES (?, ?, ?, ?, ?, NOW())");
    $newTotal = 0;
    foreach ($groupedCart as $sig => $item) {
        $itemId = (int)$item['menu_item_id'];
        $serverPrice = $menuPrices[$itemId] ?? 0;
        if ($serverPrice <= 0) continue;

        // REQ-040: validate choices/add-ons, fold add-on price, compose instructions
        $validated = hof_validate_choices_addons(
            $pdo,
            $itemId,
            $item['special_instructions'],
            $item['choices'],
            $item['addons'],
            !empty($item['configured'])
        );
        if (!$validated['ok']) {
            $pdo->rollBack();
            echo json_encode(['success' => false, 'message' => $validated['message']]);
            exit;
        }

        $foldedPrice = $serverPrice + $validated['addon_total'];
        $newTotal += $foldedPrice * $item['quantity'];
        $insertItem->execute([
            $orderId,
            $itemId,
            $item['quantity'],
            $foldedPrice,
            $validated['special_instructions']
        ]);
    }

    // 7. Update orders.total_amount + subtotal_amount
    // REQ-049: preserve any counter-applied discount. The customer can only edit
    // PENDING unpaid orders; if a discount is already on the order, keep it and
    // recompute the net total from the fresh gross subtotal, exactly like the
    // cashier recalc sites do. discount columns stay untouched.
    $updateOrder = $pdo->prepare("
        UPDATE orders
        SET subtotal_amount = ?,
            total_amount = ? - COALESCE(discount_amount, 0),
            ordered_at = NOW(),
            updated_at = NOW()
        WHERE order_id = ?
    ");
    $updateOrder->execute([$newTotal, $newTotal, $orderId]);

    // 9. If DINE_IN and table_id exists, re-assert OCCUPIED
    if ($order['table_id'] && $order['order_type'] === 'DINE_IN') {
        $tableStmt = $pdo->prepare("UPDATE restaurant_table SET status = 'OCCUPIED', updated_at = NOW() WHERE table_id = ? AND status = 'AVAILABLE'");
        $tableStmt->execute([$order['table_id']]);
    }

    $pdo->commit();

    logActivity($pdo, null, 'GUEST', 'Customer', 'ORDER_UPDATE', "Customer updated order #{$refNumber}", 'order', $orderId, $refNumber);

    // 10. Pusher broadcast
    require_once __DIR__ . '/../backend/pusher_helper.php';
    broadcastOrderUpdate($orderId, "Order #$refNumber updated");

    echo json_encode(["success" => true, "message" => "Order successfully updated.", "total_amount" => $newTotal]);

} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('update_existing_order error: ' . $e->getMessage());
    echo json_encode([
        "success" => false, 
        "message" => "Server error. Please try again."
    ]);
}
?>