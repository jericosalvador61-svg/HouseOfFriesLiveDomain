<?php
/**
 * customer/get_my_orders.php
 * REQ-052 Batch 3 — Logged-in customer's own order history.
 *
 * Identity comes ONLY from the validated customer token (never query params).
 *
 * Returns orders where:
 *   - orders.customer_account_id = <cid>   (NEW orders linked at placement), OR
 *   - phone-merged historical guest orders that are PAID/COMPLETED:
 *     orders.customer_name = <token phone> AND customer_account_id IS NULL
 *     AND status IN ('COMPLETED','SERVED') / payment_status='COMPLETED'.
 *     (Read-time merge only — NO schema change, NO writes.)
 *
 * A guest can never request another customer's orders: no customer_id/phone
 * is accepted from the client.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/customer_auth.php';

$auth = require_customer();
$customerId = (int)$auth['customer_id'];
$phone = (string)($auth['phone_number'] ?? '');

try {
    // 1) Orders explicitly linked to this customer account.
    $linked = [];
    if ($customerId > 0) {
        $stmt = $pdo->prepare("
            SELECT
                o.order_id,
                o.reference_number,
                o.order_type,
                o.status,
                o.total_amount,
                o.ordered_at,
                o.payment_status,
                o.customer_name,
                rt.table_number
            FROM orders o
            LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
            WHERE o.customer_account_id = :cid
            ORDER BY o.ordered_at DESC
        ");
        $stmt->execute([':cid' => $customerId]);
        $linked = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // 2) Historical guest orders merged by phone (PAID/COMPLETED only).
    $merged = [];
    if ($phone !== '') {
        $stmt = $pdo->prepare(
            "SELECT
                o.order_id,
                o.reference_number,
                o.order_type,
                o.status,
                o.total_amount,
                o.ordered_at,
                o.payment_status,
                o.customer_name,
                rt.table_number
            FROM orders o
            LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
            WHERE o.customer_account_id IS NULL
              AND REPLACE(IFNULL(o.customer_name, ''), ' ', '') = REPLACE(:phone, ' ', '')
              AND o.payment_status = 'COMPLETED'
            ORDER BY o.ordered_at DESC"
        );
        $stmt->execute([':phone' => $phone]);
        $merged = $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    // Union: linked first (newest authoritative), then backfilled phone-merged
    // rows that aren't already present (dedupe by order_id).
    $ordersById = [];
    foreach ($linked as $o) {
        $ordersById[(int)$o['order_id']] = $o;
    }
    foreach ($merged as $o) {
        $id = (int)$o['order_id'];
        if (!isset($ordersById[$id])) {
            $ordersById[$id] = $o;
        }
    }

    $orders = array_values($ordersById);
    usort($orders, function ($a, $b) {
        return strtotime($b['ordered_at']) <=> strtotime($a['ordered_at']);
    });

    // 3) Attach items for the returned orders (reuse the waiter join pattern).
    if (!empty($orders)) {
        $orderIds = array_column($orders, 'order_id');
        $placeholders = implode(',', array_fill(0, count($orderIds), '?'));
        $itemStmt = $pdo->prepare("
            SELECT
                oi.order_id,
                oi.quantity,
                mi.item_name,
                mi.price
            FROM order_items oi
            JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
            WHERE oi.order_id IN ($placeholders)
              AND oi.is_deleted = 0
        ");
        $itemStmt->execute(array_map('intval', $orderIds));
        $itemsByOrder = [];
        foreach ($itemStmt->fetchAll(PDO::FETCH_ASSOC) as $item) {
            $itemsByOrder[$item['order_id']][] = $item;
        }

        foreach ($orders as &$order) {
            $id = (int)$order['order_id'];
            $order['items'] = $itemsByOrder[$id] ?? [];
            // Renderer shape parity with get_orders_today/get_order_history:
            // expose total_amount + ordered_at + table_number.
            $order['paid'] = ($order['payment_status'] === 'COMPLETED');
            $order['ref']  = $order['reference_number'];
        }
        unset($order);
    }

    echo json_encode(['success' => true, 'orders' => $orders]);
} catch (Throwable $e) {
    error_log('get_my_orders error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load your orders.']);
}