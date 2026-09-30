<?php
/**
 * ============================================================
 * backend/waiter/order_service.php
 * ------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for waiter order creation.
 *
 * Both backend/waiter/submit_order.php (current UI endpoint) and the legacy
 * backend/waiter/create_order.php shim call hof_waiter_create_order() so the
 * security rules can never drift apart again.
 *
 * Security rules enforced here (server side, never trust the client):
 *   1. Prices / item names are read from `menu_items`, NOT from the payload.
 *   2. Only status = 'Available' items may be ordered.
 *   3. Quantity is clamped; item count is capped.
 *   4. A dine-in table must exist, not be soft-deleted, be table_type
 *      'DINE_IN' and still be 'AVAILABLE' (prevents double-booking).
 *   5. The table is only flipped to OCCUPIED inside the same transaction.
 *
 * REQ-040 (choices + add-ons) is enforced through the shared helper
 * backend/choices_addons_helper.php — validation, add-on price folding
 * and instruction composition can never drift from the customer paths.
 * Configured (resume/edit) lines are passed through with the stored
 * snapshot preserved verbatim by the helper ($configured flag).
 *
 * Status enums use HYPHENS: 'IN-PROGRESS', 'COOKING' (never underscores).
 * ============================================================
 */

require_once __DIR__ . '/../choices_addons_helper.php';

if (!function_exists('hof_waiter_create_order')) {    /**
     * Create a PENDING order for a waiter.
     *
     * @param PDO   $pdo
     * @param array $auth    Result of authenticate() (needs user_id/username/role)
     * @param array $payload Normalised payload:
     *                        ['order_type' => 'DINE_IN'|'TAKE_OUT',
     *                         'table_id'   => int|null,
     *                         'customer_name' => string,
     *                         'items'      => [['id' => int, 'quantity' => int,
     *                                           'special_instructions' => string], ...]]
     * @return array ['success' => bool, 'message' => string, 'http' => int,
     *                 'order_id' => int|null, 'reference_number' => string|null]
     */
    function hof_waiter_create_order(PDO $pdo, array $auth, array $payload): array
    {
        $orderType    = (($payload['order_type'] ?? '') === 'TAKE_OUT') ? 'TAKE_OUT' : 'DINE_IN';
        $tableId      = (int)($payload['table_id'] ?? 0);
        $customerName = trim((string)($payload['customer_name'] ?? ''));
        $items        = $payload['items'] ?? [];

        //  1. Basic validation 
        if (!is_array($items) || $items === []) {
            return ['success' => false, 'message' => 'Order items are required.', 'http' => 400];
        }
        if (count($items) > 50) {
            return ['success' => false, 'message' => 'An order may contain at most 50 line items.', 'http' => 400];
        }
        if (mb_strlen($customerName) > 100) {
            return ['success' => false, 'message' => 'Customer name is too long (max 100 characters).', 'http' => 400];
        }
        if ($orderType === 'TAKE_OUT' && $customerName === '') {
            return ['success' => false, 'message' => 'Customer name is required for take-out orders.', 'http' => 400];
        }
        if ($customerName === '') {
            $customerName = 'Walk-in';
        }
        if ($orderType === 'DINE_IN' && $tableId <= 0) {
            return ['success' => false, 'message' => 'Table selection is required for dine-in orders.', 'http' => 400];
        }
        if ($orderType === 'TAKE_OUT' && $tableId <= 0) {
            return ['success' => false, 'message' => 'A takeout pickup station must be selected.', 'http' => 400];
        }

        //  2. Server-side price + availability lookup 
        $requestedIds = [];
        foreach ($items as $item) {
            $id = (int)($item['id'] ?? 0);
            if ($id > 0) {
                $requestedIds[$id] = $id;
            }
        }
        if ($requestedIds === []) {
            return ['success' => false, 'message' => 'Order items are required.', 'http' => 400];
        }

        $placeholders = implode(',', array_fill(0, count($requestedIds), '?'));
        $lookup       = $pdo->prepare("
            SELECT menu_item_id, item_name, price, status
            FROM menu_items
            WHERE menu_item_id IN ($placeholders)
        ");
        $lookup->execute(array_values($requestedIds));

        $menuLookup = [];
        foreach ($lookup->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $menuLookup[(int)$row['menu_item_id']] = $row;
        }

        $totalAmount = 0.0;
        $validItems  = [];

        foreach ($items as $item) {
            $menuItemId = (int)($item['id'] ?? 0);
            $quantity   = (int)($item['quantity'] ?? 1);
            $special    = trim((string)($item['special_instructions'] ?? ''));
            $lineChoices = [];
            foreach (($item['choices'] ?? []) as $cid) {
                $lineChoices[] = (int)$cid;
            }
            $lineAddons = [];
            foreach (($item['addons'] ?? []) as $addon) {
                if (!is_array($addon)) continue;
                $lineAddons[] = [
                    'menu_addon_id' => (int)($addon['menu_addon_id'] ?? 0),
                    'quantity'      => (int)($addon['quantity'] ?? 1)
                ];
            }

            if (!isset($menuLookup[$menuItemId])) {
                return ['success' => false, 'message' => "Menu item #$menuItemId no longer exists.", 'http' => 400];
            }

            $menuItem = $menuLookup[$menuItemId];
            if ($menuItem['status'] !== 'Available') {
                return [
                    'success' => false,
                    'message' => "{$menuItem['item_name']} is currently unavailable.",
                    'http'    => 409,
                ];
            }

            $quantity = max(1, min(99, $quantity));
            if (mb_strlen($special) > 500) {
                $special = mb_substr($special, 0, 500);
            }
            $configured = !empty($item['configured']);

            // REQ-040: validate choices + add-ons server-side, fold add-on price into the line.
            $validated = hof_validate_choices_addons($pdo, $menuItemId, $special, $lineChoices, $lineAddons, $configured);
            if (!$validated['ok']) {
                return [
                    'success' => false,
                    'message' => $validated['message'],
                    'http'    => 400,
                ];
            }

            // Price ALWAYS comes from the database, never from the payload.
            // Add-on price is folded in so subtotal = quantity * price still holds.
            $price = (float)$menuItem['price'] + $validated['addon_total'];

            $validItems[] = [
                'menu_item_id'         => $menuItemId,
                'item_name'            => $menuItem['item_name'],
                'quantity'             => $quantity,
                'price'                => $price,
                'special_instructions' => $validated['special_instructions'],
            ];
            $totalAmount += $price * $quantity;
        }

        $totalAmount = round($totalAmount, 2);


        //  3. Validate the dine-in table (prevents double-booking) 
        if ($orderType === 'DINE_IN') {
            $tStmt = $pdo->prepare("
                SELECT table_id, table_number, table_type, status
                FROM restaurant_table
                WHERE table_id = ? AND is_deleted = 0
            ");
            $tStmt->execute([$tableId]);
            $table = $tStmt->fetch(PDO::FETCH_ASSOC);

            if (!$table) {
                return ['success' => false, 'message' => 'Selected table does not exist.', 'http' => 404];
            }
            if ($table['table_type'] !== 'DINE_IN') {
                return ['success' => false, 'message' => 'That table is not a dine-in table.', 'http' => 400];
            }
            if ($table['status'] !== 'AVAILABLE') {
                return [
                    'success' => false,
                    'message' => "Table {$table['table_number']} is already {$table['status']}. "
                               . 'Please choose another table or clear it first.',
                    'http'    => 409,
                ];
            }
        }

        //  3b. Validate the take-out anchor table. Take-out orders must point
        //  at a real TAKEOUT anchor (never NULL) so the anchor can be reserved
        //  and later freed the same way a dine-in table is.
        if ($orderType === 'TAKE_OUT') {
            $tStmt = $pdo->prepare("
                SELECT table_id, table_number, table_type, status
                FROM restaurant_table
                WHERE table_id = ? AND table_type = 'TAKEOUT' AND is_deleted = 0
            ");
            $tStmt->execute([$tableId]);
            $table = $tStmt->fetch(PDO::FETCH_ASSOC);

            if (!$table) {
                return [
                    'success' => false,
                    'message' => 'No takeout table is configured. Ask an administrator to add one.',
                    'http'    => 404,
                ];
            }
            if ($table['status'] !== 'AVAILABLE') {
                return [
                    'success' => false,
                    'message' => "The takeout pickup station is currently {$table['status']}. Please try again in a moment.",
                    'http'    => 409,
                ];
            }
        }

        //  4. Persist inside a transaction 
        $pdo->beginTransaction();
        try {
            // Reference number HOF<year><00001> - matches the historical format
            // already stored in the orders table. MAX+1 is racy, so mirror
            // create_otc_order.php: retry the sequence on a unique-key clash.
            $prefix = 'HOF' . date('Y');
            $referenceNumber = null;
            $seqStmt = $pdo->prepare("
                SELECT COALESCE(MAX(CAST(SUBSTRING(reference_number, ?) AS UNSIGNED)), 0)
                FROM orders
                WHERE reference_number LIKE ?
            ");
            $orderStmt = $pdo->prepare("
                INSERT INTO orders
                    (reference_number, table_id, customer_name, user_id, order_type,
                     subtotal_amount, total_amount, status, ordered_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NOW(), NOW())
            ");
            for ($attempt = 1; $attempt <= 3; $attempt++) {
                $seqStmt->execute([strlen($prefix) + 1, $prefix . '%']);
                $nextSeq = ((int)$seqStmt->fetchColumn()) + 1;
                $candidate = $prefix . str_pad((string)$nextSeq, 5, '0', STR_PAD_LEFT);

                try {
                    $orderStmt->execute([
                        $candidate,
                        $tableId, // dine-in table id OR the takeout anchor id
                        $customerName,
                        (int)$auth['user_id'],
                        $orderType,
                        $totalAmount,
                        $totalAmount,
                    ]);
                    $referenceNumber = $candidate;
                    break;
                } catch (PDOException $e) {
                    // SQLSTATE 23000 = integrity constraint violation. Retry
                    // with a fresh sequence value on the next attempt.
                    if ($attempt < 3 && (int)$e->getCode() === 23000) {
                        continue;
                    }
                    throw $e;
                }
            }

            if ($referenceNumber === null) {
                throw new RuntimeException('REFERENCE_GEN_RETRIES_EXHAUSTED');
            }
            $orderId = (int)$pdo->lastInsertId();

            $itemStmt = $pdo->prepare("
                INSERT INTO order_items (order_id, menu_item_id, quantity, price, special_instructions)
                VALUES (?, ?, ?, ?, ?)
            ");
            foreach ($validItems as $item) {
                $itemStmt->execute([
                    $orderId,
                    $item['menu_item_id'],
                    $item['quantity'],
                    $item['price'],
                    $item['special_instructions'],
                ]);
            }

            if ($orderType === 'DINE_IN' || $orderType === 'TAKE_OUT') {
                // Guarded UPDATE: only claim the table if it is still AVAILABLE.
                // For TAKE_OUT the anchor table_type is TAKEOUT; the guard
                // prevents two take-out orders racing for the same pickup station.
                $occupy = $pdo->prepare("
                    UPDATE restaurant_table
                    SET status = 'OCCUPIED', updated_at = NOW()
                    WHERE table_id = ? AND is_deleted = 0 AND status = 'AVAILABLE'
                ");
                $occupy->execute([$tableId]);
                if ($occupy->rowCount() === 0) {
                    // Lost a race with another waiter - abort cleanly.
                    throw new RuntimeException($orderType === 'TAKE_OUT' ? 'TAKEOUT_TABLE_RACE' : 'TABLE_RACE');
                }
            }

            $pdo->commit();
        } catch (RuntimeException $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if ($e->getMessage() === 'TABLE_RACE') {
                return [
                    'success' => false,
                    'message' => 'That table was just taken by another staff member. Please pick a different table.',
                    'http'    => 409,
                ];
            }
            if ($e->getMessage() === 'TAKEOUT_TABLE_RACE') {
                return [
                    'success' => false,
                    'message' => 'The takeout pickup station was just taken by another staff member. Please try again.',
                    'http'    => 409,
                ];
            }
            if ($e->getMessage() === 'REFERENCE_GEN_RETRIES_EXHAUSTED') {
                return [
                    'success' => false,
                    'message' => 'Could not allocate a reference number. Please try again.',
                    'http'    => 500,
                ];
            }
            throw $e;
        } catch (Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            error_log('hof_waiter_create_order failed: ' . $e->getMessage());
            return [
                'success' => false,
                'message' => 'The order could not be saved. Please try again.',
                'http'    => 500,
            ];
        }

        //  5. Side effects (after commit) 
        if (function_exists('logActivity')) {
            logActivity(
                $pdo,
                (int)$auth['user_id'],
                $auth['username'] ?? '',
                $auth['role'] ?? '',
                'ORDER_CREATED',
                "Waiter created order #{$referenceNumber}",
                'order',
                $orderId,
                $referenceNumber
            );
        }

        if (function_exists('broadcastOrderUpdate')) {
            broadcastOrderUpdate($orderId, "New Order #$referenceNumber from waiter");
        }

        if (function_exists('hof_notify_roles')) {
            hof_notify_roles(
                $pdo,
                'order_new',
                'New Order Received',
                "Waiter order $referenceNumber"
                    . ($orderType === 'DINE_IN' ? " (Table $tableId)" : ' (Take Out)')
                    . ' - awaiting payment.',
                ['Cashier'],
                '/public/cashier/cashier_dashboard.html'
            );
        }

        return [
            'success'          => true,
            'message'          => 'Order placed successfully!',
            'http'             => 200,
            'order_id'         => $orderId,
            'reference_number' => $referenceNumber,
        ];
    }
}
