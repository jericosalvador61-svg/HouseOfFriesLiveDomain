<?php
/**
 * Cashier API - Orders awaiting GCash confirmation
 * Returns PENDING orders that have a PayMongo payment intent but are
 * not yet paid. The cashier dashboard polls these and verifies each one
 * WITH the cashier's token, so the transaction is recorded under
 * whichever cashier is logged in at that time.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Cashier', 'Admin']);

try {
    $stmt = $pdo->query("
        SELECT o.order_id, o.reference_number, o.total_amount, o.payment_intent_status,
               rt.table_number
        FROM orders o
        LEFT JOIN restaurant_table rt ON o.table_id = rt.table_id
        WHERE o.status = 'PENDING'
          AND o.payment_status = 'PENDING'
          AND o.payment_intent_id IS NOT NULL
          AND o.payment_intent_id <> ''
        ORDER BY o.created_at ASC
        LIMIT 20
    ");
    $orders = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(['success' => true, 'orders' => $orders]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
