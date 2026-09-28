<?php
/**
 * ============================================================
 * backend/table_state_helper.php
 * ------------------------------------------------------------
 * Table + order state consistency (single decision point).
 *
 * Restaurant workflow:
 *   AVAILABLE -> OCCUPIED -> ACTIVE ORDER -> completed/served/closed
 *   ...ONLY THEN -> CLEAN / AVAILABLE
 *
 * A table that still has a PENDING / IN-PROGRESS / COOKING order must NOT
 * be cleared, marked AVAILABLE, or deleted — by ANY role (Waiter, Cashier,
 * Supervisor, Admin). The frontend also hides these actions, but the backend
 * is the final authority.
 *
 * SERVED is deliberately NOT blocking: it is a terminal status (the only
 * transition into it is COMPLETED -> SERVED, and nothing moves out of it).
 * Leaving it in this list deadlocked tables permanently — the auto-free on
 * serve excludes the served order itself, but the manual clear/status
 * endpoints could not, so no role could ever free the table again.
 *
 * Status enums use HYPHENS: 'IN-PROGRESS' (never underscores).
 * ============================================================
 */

if (!defined('HOF_TABLE_BLOCKING_STATUSES')) {
    /**
     * Order statuses that mean "this table is still in service".
     * Mirrors backend/waiter/clear_table.php so every endpoint agrees.
     */
    define('HOF_TABLE_BLOCKING_STATUSES', "'PENDING','IN-PROGRESS','COOKING'");
}

if (!function_exists('hof_get_blocking_order_for_table')) {
    /**
     * Return the first active order blocking a table free-up, or null.
     *
     * @param PDO   $pdo
     * @param int   $tableId
     * @param bool  $forUpdate  Add FOR UPDATE when already inside a transaction.
     * @return array|null ['order_id' => int, 'reference_number' => string, 'status' => string, 'payment_status' => string]
     */
    function hof_get_blocking_order_for_table(PDO $pdo, int $tableId, bool $forUpdate = false): ?array
    {
        $sql = "SELECT order_id, reference_number, status, payment_status
                FROM orders
                WHERE table_id = ?
                  AND status IN (" . HOF_TABLE_BLOCKING_STATUSES . ")
                ORDER BY order_id DESC
                LIMIT 1";
        if ($forUpdate) {
            $sql .= " FOR UPDATE";
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute([$tableId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }
}

if (!function_exists('hof_table_block_message')) {
    /**
     * Human-readable reason a table cannot be freed yet.
     */
    function hof_table_block_message(array $order): string
    {
        $ref     = $order['reference_number'] ?? ('#' . ($order['order_id'] ?? '?'));
        $status  = strtoupper((string)($order['status'] ?? ''));
        $paid    = strtoupper((string)($order['payment_status'] ?? '')) === 'COMPLETED';

        if ($paid && in_array($status, ['IN-PROGRESS', 'COOKING'], true)) {
            return "Cannot free this table — order #{$ref} is paid and still being prepared in the kitchen. "
                 . "The table can only be cleared after the order is served or completed.";
        }
        if ($status === 'PENDING') {
            return "Cannot free this table — order #{$ref} is still awaiting payment. "
                 . "Please complete or cancel the order first.";
        }
        return "Cannot free this table — active order #{$ref} ({$status}) is still open. "
             . "Please complete or cancel the order first.";
    }
}