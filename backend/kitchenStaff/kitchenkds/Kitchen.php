<?php

require_once __DIR__ . '/../../db.php';

/**
 * Kitchen Model - Handles all kitchen display logic
 * Works with ACTUAL database schema (house_of_fries_db.sql)
 */
class Kitchen
{
    /**
     * How long after "Start Cooking" a kitchen staff member may UN-tick an
     * item and get the minutes back.
     *
     * Rationale: a mis-tick in the first few minutes is harmless to correct.
     * Past this point the kitchen could hand itself extra time and run past
     * what the customer was promised, so an un-tick is allowed but gives no
     * time back (the dish stays counted as done).
     */
    const PREP_UNLOCK_WINDOW_MINUTES = 10;

    protected PDO $db;

    public function __construct()
    {
        global $pdo;
        $this->db = $pdo;
    }

    public function getDb(): PDO
    {
        return $this->db;
    }

    /**
     * Get all active kitchen orders (IN-PROGRESS, COOKING)
     * Filters: DINE_IN, TAKE_OUT only (excludes DELIVERY)
     * Sorted by ordered_at ASC (FCFS - First Come First Served)
     *
     * PREP-TIME LEDGER (no new columns):
     *   prep_estimate_total = SUM(menu prep time x qty)  -> the ORIGINAL estimate
     *   prep_remaining      = orders.total_estimated_prep_time
     *                          (a previously DEAD column, now the live
     *                           "minutes still to cook" ledger)
     *   minutes already cooked-off = prep_estimate_total - prep_remaining
     *   The countdown is computed CLIENT-side as
     *   (prep_remaining * 60) - seconds_since(cooking_started_epoch).
     *
     * Epoch timestamps are returned in addition to the raw strings so the
     * browser never has to parse a MySQL datetime in local time (the old
     * `new Date(str)` approach was off by the server/UTC offset).
     */
    public function getActiveOrders(): array
    {
        $sql = "
            SELECT 
                o.order_id,
                o.reference_number,
                o.table_id,
                o.status,
                o.order_type,
                o.total_amount,
                o.customer_name,
                o.ordered_at,
                UNIX_TIMESTAMP(o.ordered_at) AS ordered_at_epoch,
                o.cooking_started_at,
                UNIX_TIMESTAMP(o.cooking_started_at) AS cooking_started_epoch,
                o.completed_at,
                UNIX_TIMESTAMP(o.completed_at) AS completed_at_epoch,
                COALESCE(o.total_estimated_prep_time, 0) AS prep_remaining,
                rt.table_number,
                (SELECT COALESCE(SUM(mi.estimated_prep_time_minutes * oi.quantity), 0)
                   FROM order_items oi
                   JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
                  WHERE oi.order_id = o.order_id AND oi.is_deleted = 0) AS prep_estimate_total
            FROM orders o
            LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
            WHERE o.status IN ('IN-PROGRESS', 'COOKING')
                AND o.order_type IN ('DINE_IN', 'TAKE_OUT')
            ORDER BY o.ordered_at ASC
        ";

        $stmt = $this->db->prepare($sql);
        $stmt->execute();
        $orders = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Fetch items for each order, deriving which items are already ticked.
        foreach ($orders as &$order) {
            $estimateTotal = (int)$order['prep_estimate_total'];
            $remaining     = (int)$order['prep_remaining'];
            $deducted      = max(0, $estimateTotal - $remaining);

            $order['prep_estimate_total'] = $estimateTotal;
            $order['prep_remaining']      = $remaining;
            $order['prep_minutes_done']   = $deducted;
            $order['prep_started']        = !empty($order['cooking_started_epoch']);
            // Epoch after which un-ticking no longer refunds time. The UI uses
            // this to disable the boxes instead of offering a false affordance.
            $order['unlock_deadline_epoch'] = !empty($order['cooking_started_epoch'])
                ? ((int)$order['cooking_started_epoch'] + (self::PREP_UNLOCK_WINDOW_MINUTES * 60))
                : null;
            $order['items'] = $this->getOrderItems((int)$order['order_id'], $deducted);
        }
        unset($order);

        return $orders;
    }

    /**
     * Get order items with menu details.
     *
     * $minutesDone: how many prep minutes are already ticked off. Because we
     * deliberately store no per-item flag, the tick marks are rebuilt by
     * walking the items in order and consuming the deducted minutes - for a
     * purely additive estimate this reproduces the cook's actual progress.
     */
    public function getOrderItems(int $orderId, int $minutesDone = 0): array
    {
        $sql = "
            SELECT 
                oi.order_item_id,
                oi.menu_item_id,
                oi.quantity,
                oi.price,
                oi.subtotal,
                oi.special_instructions,
                mi.item_name,
                mi.description,
                mi.image_url,
                mi.category_id,
                mc.category_name,
                mi.estimated_prep_time_minutes AS estimated_prep_time
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
            LEFT JOIN menu_categories mc ON mi.category_id = mc.category_id
            WHERE oi.order_id = :order_id AND oi.is_deleted = 0
            ORDER BY oi.order_item_id ASC
        ";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':order_id' => $orderId]);
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $budget = max(0, $minutesDone);
        foreach ($items as &$item) {
            $perItem = ((int)($item['estimated_prep_time'] ?? 0)) * (int)$item['quantity'];
            $item['prep_minutes_total'] = $perItem;
            $isPrepared = ($budget >= $perItem && $perItem > 0);
            $item['is_prepared'] = $isPrepared ? 1 : 0;
            if ($isPrepared) {
                $budget -= $perItem;
            }
        }
        unset($item);

        return $items;
    }

    /**
     * Total prep minutes for an order, summed from the menu.
     */
    public function getEstimatedTotalPrepTime(int $orderId): int
    {
        $sql = "
            SELECT COALESCE(SUM(mi.estimated_prep_time_minutes * oi.quantity), 0) AS total_prep_time
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
            WHERE oi.order_id = :order_id AND oi.is_deleted = 0
        ";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([':order_id' => $orderId]);
        return (int)$stmt->fetchColumn();
    }

    /**
     * Get completed/cancelled orders for history page
     * Supports pagination and date filtering
     */
    public function getOrderHistory(int $page = 1, int $limit = 50, ?string $dateFrom = null, ?string $dateTo = null, ?string $status = null): array
    {
        $offset = ($page - 1) * $limit;
        
        $whereConditions = ["o.order_type IN ('DINE_IN', 'TAKE_OUT')"];
        $params = [':limit' => $limit, ':offset' => $offset];

        if ($status) {
            $whereConditions[] = "o.status = :status";
            $params[':status'] = $status;
        }

        if ($dateFrom) {
            $whereConditions[] = "DATE(o.ordered_at) >= :date_from";
            $params[':date_from'] = $dateFrom;
        }

        if ($dateTo) {
            $whereConditions[] = "DATE(o.ordered_at) <= :date_to";
            $params[':date_to'] = $dateTo;
        }

        $whereClause = implode(' AND ', $whereConditions);

        $sql = "
            SELECT 
                o.order_id,
                o.reference_number,
                o.table_id,
                o.status,
                o.ordered_at,
                o.cooking_started_at,
                o.completed_at,
                o.order_type,
                o.total_amount,
                rt.table_number
            FROM orders o
            LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
            WHERE $whereClause
            ORDER BY o.ordered_at DESC
            LIMIT :limit OFFSET :offset
        ";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $orders = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Fetch items for each order
        foreach ($orders as &$order) {
            $order['items'] = $this->getOrderItems($order['order_id']);
        }

        // Get total count for pagination
        $countSql = "SELECT COUNT(*) as total FROM orders o WHERE $whereClause";
        $countStmt = $this->db->prepare($countSql);
        unset($params[':limit'], $params[':offset']);
        $countStmt->execute($params);
        $total = (int)$countStmt->fetchColumn();

        return [
            'data' => $orders,
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit)
            ]
        ];
    }

    /**
     * Get single order details by ID (prep-ledger aware).
     */
    public function getOrderDetails(int $orderId): ?array
    {
        $sql = "
            SELECT 
                o.order_id,
                o.reference_number,
                o.table_id,
                o.status,
                o.order_type,
                o.total_amount,
                o.customer_name,
                o.ordered_at,
                UNIX_TIMESTAMP(o.ordered_at) AS ordered_at_epoch,
                o.cooking_started_at,
                UNIX_TIMESTAMP(o.cooking_started_at) AS cooking_started_epoch,
                o.completed_at,
                UNIX_TIMESTAMP(o.completed_at) AS completed_at_epoch,
                COALESCE(o.total_estimated_prep_time, 0) AS prep_remaining,
                rt.table_number
            FROM orders o
            LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
            WHERE o.order_id = :order_id
        ";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':order_id' => $orderId]);
        $order = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$order) {
            return null;
        }

        $estimateTotal = $this->getEstimatedTotalPrepTime($orderId);
        $remaining     = (int)$order['prep_remaining'];
        $deducted      = max(0, $estimateTotal - $remaining);

        $order['prep_estimate_total'] = $estimateTotal;
        $order['prep_remaining']      = $remaining;
        $order['prep_minutes_done']   = $deducted;
        $order['prep_started']        = !empty($order['cooking_started_epoch']);
        $order['items'] = $this->getOrderItems($orderId, $deducted);

        return $order;
    }


    // ================================================================
    // PREP-TIME LEDGER
    // ------------------------------------------------------------
    // The "minutes still to cook" value lives in the previously unused
    // orders.total_estimated_prep_time column. NO new columns were added.
    //
    //   Start Cooking  -> ledger := SUM(menu prep x qty)
    //   tick an item   -> ledger := ledger - that item's minutes
    //   untick         -> ledger := ledger + that item's minutes (capped at SUM)
    //   Check All      -> ledger := 0
    //
    // Minutes ALWAYS come from the menu row, never from the client, so a
    // crafted request cannot shorten an order's timer.
    // ================================================================

    /**
     * Move an order into COOKING and (re)initialise the ledger from the menu.
     */
    public function startPrep(int $orderId): array
    {
        $order = $this->db->prepare("SELECT status, reference_number FROM orders WHERE order_id = :id");
        $order->execute([':id' => $orderId]);
        $row = $order->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            return ['success' => false, 'message' => 'Order not found.'];
        }

        $total = $this->getEstimatedTotalPrepTime($orderId);
        if ($total <= 0) {
            $total = 15; // safety floor if no menu prep times are configured
        }

        $stmt = $this->db->prepare("
            UPDATE orders
            SET status = 'COOKING',
                cooking_started_at = NOW(),
                total_estimated_prep_time = :total
            WHERE order_id = :id
        ");
        $stmt->execute([':total' => $total, ':id' => $orderId]);

        return [
            'success' => true,
            'message' => 'Cooking started.',
            'prep_remaining' => $total,
        ];
    }

    /**
     * Minutes elapsed since the kitchen pressed "Start Cooking".
     * Uses MySQL-side datetimes (TIMESTAMPDIFF) so no PHP/DB timezone skew.
     * Returns 0 when the clock has not started yet.
     */
    public function getMinutesSinceCookingStart(int $orderId): int
    {
        $stmt = $this->db->prepare("
            SELECT COALESCE(TIMESTAMPDIFF(MINUTE, cooking_started_at, NOW()), 0) AS mins
            FROM orders
            WHERE order_id = :id
        ");
        $stmt->execute([':id' => $orderId]);
        return (int)$stmt->fetchColumn();
    }

    /**
     * Tick / untick one order item and adjust the ledger accordingly.
     *
     * @param bool $prepared true = item finished (subtract its minutes)
     */
    public function setItemPrepared(int $orderId, int $orderItemId, bool $prepared): array
    {
        // Look up the item's OWN minutes from the menu - never trust the client.
        $itemStmt = $this->db->prepare("
            SELECT mi.estimated_prep_time_minutes AS est, oi.quantity
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
            WHERE oi.order_item_id = :item AND oi.order_id = :order AND oi.is_deleted = 0
        ");
        $itemStmt->execute([':item' => $orderItemId, ':order' => $orderId]);
        $item = $itemStmt->fetch(PDO::FETCH_ASSOC);

        if (!$item) {
            return ['success' => false, 'message' => 'Item not found on this order.'];
        }

        $minutes = ((int)$item['est']) * ((int)$item['quantity']);
        $cap     = $this->getEstimatedTotalPrepTime($orderId);

        $refunded = false;
        $locked   = false;

        if ($prepared) {
            // Ticking ALWAYS deducts: the cook has committed that dish is done.
            $sql = "UPDATE orders
                    SET total_estimated_prep_time = GREATEST(0, COALESCE(total_estimated_prep_time, 0) - :mins)
                    WHERE order_id = :id";
            $stmt = $this->db->prepare($sql);
            $stmt->execute([':mins' => $minutes, ':id' => $orderId]);
        } else {
            // Un-ticking only gives time back inside the grace window.
            $elapsed = $this->getMinutesSinceCookingStart($orderId);

            if ($elapsed <= self::PREP_UNLOCK_WINDOW_MINUTES) {
                $sql = "UPDATE orders
                        SET total_estimated_prep_time = LEAST(:cap, COALESCE(total_estimated_prep_time, 0) + :mins)
                        WHERE order_id = :id";
                $stmt = $this->db->prepare($sql);
                $stmt->execute([':mins' => $minutes, ':cap' => $cap, ':id' => $orderId]);
                $refunded = true;
            } else {
                // Past the window the deduction stands - no time is handed back.
                $locked = true;
            }
        }

        $read = $this->db->prepare("SELECT COALESCE(total_estimated_prep_time, 0) FROM orders WHERE order_id = :id");
        $read->execute([':id' => $orderId]);

        return [
            'success'        => true,
            'message'        => $locked
                ? 'Too late to undo - the prep time for this item has been deducted.'
                : ($prepared ? 'Item marked prepared.' : 'Item unmarked.'),
            'minutes'        => $minutes,
            'refunded'       => $refunded,
            'locked'         => $locked,
            'prep_remaining' => (int)$read->fetchColumn(),
        ];
    }



    /**
     * "Check All" - every item is done, so the remaining time goes to zero.
     * Kept as an explicit action (not a loop of toggles) so the final update
     * is atomic and the kitchen gets instant feedback.
     */
    public function checkAllItems(int $orderId): array
    {
        // REQ-063 #9: idempotent — if the order is already zeroed (all items
        // already checked), that is NOT an error; return success so the
        // kitchen never sees a confusing "error" on a second Check All.
        $exists = $this->db->prepare("SELECT COUNT(*) FROM orders WHERE order_id = :id");
        $exists->execute([':id' => $orderId]);
        if ((int)$exists->fetchColumn() === 0) {
            return ['success' => false, 'message' => 'Order not found.'];
        }

        $already = $this->db->prepare("SELECT total_estimated_prep_time FROM orders WHERE order_id = :id");
        $already->execute([':id' => $orderId]);
        $current = (int)$already->fetchColumn();

        if ($current === 0) {
            // Second+ press on an already-checked order — treat as success.
            return ['success' => true, 'message' => 'All items already checked.', 'prep_remaining' => 0];
        }

        $stmt = $this->db->prepare("
            UPDATE orders
            SET total_estimated_prep_time = 0
            WHERE order_id = :id
        ");
        $stmt->execute([':id' => $orderId]);

        return ['success' => true, 'message' => 'All items checked.', 'prep_remaining' => 0];
    }

    /**
     * Update order status. COOKING is routed through startPrep() so the
     * ledger is always initialised when the clock starts.
     */
    public function updateStatus(int $orderId, string $newStatus): array
    {
        $statusMap = [
            'IN-PROGRESS' => 'IN-PROGRESS',
            'COOKING'     => 'COOKING',
            'COMPLETED'   => 'COMPLETED',
            'CANCELLED'   => 'CANCELLED',
            'PENDING'     => 'PENDING'
        ];

        $dbStatus = $statusMap[$newStatus] ?? $newStatus;
        $valid    = ['PENDING', 'IN-PROGRESS', 'COOKING', 'COMPLETED', 'CANCELLED'];

        if (!in_array($dbStatus, $valid, true)) {
            return ['success' => false, 'message' => 'Invalid status.'];
        }

        if ($dbStatus === 'COOKING') {
            return $this->startPrep($orderId);
        }

        $setClause = "status = :status";
        if ($dbStatus === 'COMPLETED') {
            $setClause .= ", completed_at = NOW(), total_estimated_prep_time = 0";
        }

        $stmt = $this->db->prepare("UPDATE orders SET $setClause WHERE order_id = :order_id");
        $stmt->execute([':status' => $dbStatus, ':order_id' => $orderId]);

        if ($stmt->rowCount() > 0) {
            return ['success' => true, 'message' => 'Order status updated.'];
        }

        return ['success' => false, 'message' => 'Order not found or no changes.'];
    }
}
