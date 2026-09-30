<?php
/**
 * ============================================================
 * backend/choices_addons_helper.php  (REQ-040)
 * ------------------------------------------------------------
 * Shared, server-authoritative validation + composition for
 * per-line menu choices and add-ons.
 *
 * Used by:
 *   - customer/place_order.php
 *   - customer/update_existing_order.php
 *   - backend/waiter/order_service.php
 *
 * Rules enforced (REQ-040):
 *  1. Each menu_choice_id must exist in menu_item_choices, be
 *     status='Active' and belong to the line's menu_item_id.
 *  2. If the item has choice rows, every distinct group_name must
 *     have exactly one chosen menu_choice_id.
 *  3. Each menu_addon_id must exist in menu_item_addons with
 *     status='Active'; quantity >= 1, clamped to <= 99.
 *  4. Add-on price is folded into the line price by the caller:
 *     linePrice = menu base price + SUM(addon.price * addon.qty).
 *  5. special_instructions = free text first, then a readable
 *     snapshot: "Group: Choice; 2x Addon; 1x Addon".
 * ============================================================
 */

if (!function_exists('hof_validate_choices_addons')) {

    /**
     * Validate choices + add-ons for one menu-item line and compose
     * the readable snapshot for special_instructions.
     *
     * @param PDO    $pdo
     * @param int    $menuItemId  the menu item the line refers to
     * @param string $freeText    user-typed instructions (may be '')
     * @param array  $choices     array of menu_choice_id ints
     * @param array  $addons      array of ['menu_addon_id' => int, 'quantity' => int]
     * @param bool   $configured  true when the line came from a real order
     *                            (resume/edit): the composed snapshot in
     *                            $freeText is already authoritative, so the
     *                            required-group gate is skipped and the stored
     *                            text is preserved.
     * @return array  on success:
     *                  ['ok' => true,
     *                   'addon_total' => float,
     *                   'special_instructions' => string]
     *                on failure:
     *                  ['ok' => false, 'message' => <generic client-safe string>]
     */
    function hof_validate_choices_addons(PDO $pdo, int $menuItemId, string $freeText, array $choices, array $addons, bool $configured = false): array
    {
        $choices = is_array($choices) ? $choices : [];
        $addons  = is_array($addons)  ? $addons  : [];
        $parts   = [];

        // ---- 1 & 2. Choices ----
        $choiceStmt = $pdo->prepare(
            "SELECT menu_choice_id, group_name, choice_name
               FROM menu_item_choices
              WHERE menu_item_id = ? AND status = 'Active'
              ORDER BY sort_order ASC, menu_choice_id ASC"
        );
        $choiceStmt->execute([$menuItemId]);
        $itemChoices = $choiceStmt->fetchAll(PDO::FETCH_ASSOC);

        if ($itemChoices === []) {
            if ($choices !== []) {
                error_log("REQ-040: menu_item_id #{$menuItemId} received choices but has no choice groups.");
                return ['ok' => false, 'message' => 'This item does not accept menu choices.'];
            }
        } elseif (!$configured) {
            $valid = [];
            foreach ($itemChoices as $row) {
                $valid[(int)$row['menu_choice_id']] = [
                    'group_name'  => $row['group_name'],
                    'choice_name' => $row['choice_name'],
                ];
            }

            $picked = [];
            foreach ($choices as $choiceId) {
                $choiceId = (int)$choiceId;
                if (!isset($valid[$choiceId])) {
                    error_log("REQ-040: invalid choice #{$choiceId} for menu_item_id #{$menuItemId}.");
                    return ['ok' => false, 'message' => 'One or more menu choices are invalid for this item.'];
                }
                $picked[$choiceId] = $valid[$choiceId];
            }

            $byGroup = [];
            foreach ($picked as $info) {
                $byGroup[$info['group_name']][] = $info['choice_name'];
            }

            $groupOrder = [];
            $seen = [];
            foreach ($itemChoices as $row) {
                if (!isset($seen[$row['group_name']])) {
                    $seen[$row['group_name']] = true;
                    $groupOrder[] = $row['group_name'];
                }
            }

            foreach ($groupOrder as $group) {
                $count = isset($byGroup[$group]) ? count($byGroup[$group]) : 0;
                if ($count !== 1) {
                    error_log("REQ-040: menu_item_id #{$menuItemId} group \"{$group}\" needs exactly 1 choice, got {$count}.");
                    return ['ok' => false, 'message' => 'Please select exactly one option from each required group.'];
                }
                $parts[] = $group . ': ' . $byGroup[$group][0];
            }
        } else {
            // Configured (resume/edit) line: the composed snapshot is already in
            // $freeText; keep it verbatim as the stored special_instructions.
            $parts[] = trim($freeText);
        }

        // ---- 3 & 4. Add-ons ----
        $addonTotal = 0.0;
        if ($addons !== []) {
            $merged = [];
            foreach ($addons as $addon) {
                if (!is_array($addon)) {
                    continue;
                }
                $addonId = (int)($addon['menu_addon_id'] ?? 0);
                $qty     = (int)($addon['quantity'] ?? 1);
                if ($addonId < 1) {
                    error_log("REQ-040: line on menu_item_id #{$menuItemId} has an add-on without a valid id.");
                    return ['ok' => false, 'message' => 'One or more add-ons are invalid.'];
                }
                if ($qty < 1) {
                    error_log("REQ-040: add-on #{$addonId} quantity {$qty} is below 1.");
                    return ['ok' => false, 'message' => 'Add-on quantity must be at least 1.'];
                }
                if ($qty > 99) {
                    $qty = 99;
                }
                if (!isset($merged[$addonId])) {
                    $merged[$addonId] = $qty;
                } else {
                    $merged[$addonId] = min(99, $merged[$addonId] + $qty);
                }
            }

            if ($merged !== []) {
                $addonIds     = array_keys($merged);
                $placeholders = implode(',', array_fill(0, count($addonIds), '?'));
                $addonStmt    = $pdo->prepare(
                    "SELECT menu_addon_id, addon_name, price
                       FROM menu_item_addons
                      WHERE menu_addon_id IN ({$placeholders}) AND status = 'Active'"
                );
                $addonStmt->execute($addonIds);

                $addonRows = [];
                foreach ($addonStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
                    $addonRows[(int)$row['menu_addon_id']] = $row;
                }

                foreach ($merged as $addonId => $qty) {
                    if (!isset($addonRows[$addonId])) {
                        error_log("REQ-040: add-on #{$addonId} not found or inactive.");
                        return ['ok' => false, 'message' => 'One or more add-ons are no longer available.'];
                    }
                    $addonTotal += (float)$addonRows[$addonId]['price'] * $qty;
                    $parts[]     = $qty . 'x ' . $addonRows[$addonId]['addon_name'];
                }
            }
        }

        // ---- 5. Compose special_instructions ----
        // For a configured (resume/edit) line the snapshot text was already the
        // stored value; don't re-prepend the free text (avoid duplication).
        $snapshot = $configured ? (trim($freeText) !== '' ? trim($freeText) : '') : implode('; ', $parts);
        if (!$configured) {
            $freeText = trim($freeText);
            if ($freeText !== '') {
                $snapshot = $snapshot !== '' ? $freeText . '; ' . $snapshot : $freeText;
            }
        }

        // Safety cap: the column is TEXT, so this only guards against absurdly
        // long composed values; never loses the choices/add-ons summary.
        if (mb_strlen($snapshot) > 1000) {
            $snapshot = mb_substr($snapshot, 0, 1000);
        }

        return [
            'ok'                   => true,
            'addon_total'          => round($addonTotal, 2),
            'special_instructions' => $snapshot,
        ];
    }

    /**
     * Resolve a DB-rebuilt (configured) line back to its authoritative stored
     * price + special_instructions. Used on resume/edit so add-on charges that
     * were folded into the original order_items.price are never lost when the
     * order is re-saved (REQ-040 HIGH-4).
     *
     * @param PDO $pdo
     * @param int $orderItemId  order_items.order_item_id carried by the line
     * @param int $orderId      the order the line originally belonged to
     * @return array|null ['price' => float, 'special_instructions' => string]
     *                    or null if not found / not deletable-safe
     */
    function hof_resolve_configured_line(PDO $pdo, int $orderItemId, int $orderId): ?array
    {
        if ($orderItemId < 1 || $orderId < 1) {
            return null;
        }
        $stmt = $pdo->prepare(
            "SELECT price, special_instructions
               FROM order_items
              WHERE order_item_id = ? AND order_id = ?
              LIMIT 1"
        );
        $stmt->execute([$orderItemId, $orderId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            return null;
        }
        return [
            'price'                => (float)$row['price'],
            'special_instructions' => (string)($row['special_instructions'] ?? ''),
        ];
    }
}
