<?php
// backend/cashier/get_cashier_daily_sales.php
header('Content-Type: application/json');

try {
    // 1. Pull token security helper & your standard PDO db mapping file
    require_once __DIR__ . '/../auth_middleware.php';
    require_once __DIR__ . '/../db.php';

    // 2. Validate token and extract active user shift identifier variables stateless
    $user = authenticate(['Cashier', 'Admin']);
    $userId = $user['user_id'];

    $response = [
        'summary' => [
            'gross_revenue' => 0,
            'total_orders' => 0,
            'order_handled' => 0,
            'cash_revenue' => 0,
            'gcash_revenue' => 0,
            'cash_received' => 0
        ],
        'transactions' => [],
        'top_items' => []
    ];

    /**
     * PAID = SALE rule:
     * Every COMPLETED payment attributed to this cashier counts as a sale
     * immediately - cash taken at the counter OR a GCash/PayMongo payment
     * this cashier verified - even if the kitchen has not finished the order.
     * Attribution: payments.user_id (stamped at verification) falling back
     * to orders.user_id (cashier who processed the order).
     */
    $attributed = "COALESCE(p.user_id, o.user_id)";

    // --- QUERY 1: CORE SUMMARY METRICS (order total-based) ---
    $summaryQuery = "SELECT 
                        COALESCE(SUM(o.total_amount), 0) AS gross_revenue,
                        COUNT(DISTINCT o.order_id) AS total_orders,
                        COUNT(DISTINCT CASE WHEN o.status NOT IN ('CANCELLED') THEN o.order_id END) AS order_handled,
                        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'CASH' THEN o.total_amount ELSE 0 END), 0) AS cash_revenue,
                        COALESCE(SUM(CASE WHEN UPPER(p.payment_method) <> 'CASH' THEN o.total_amount ELSE 0 END), 0) AS gcash_revenue,
                        COALESCE(SUM(p.amount_paid), 0) AS cash_received
                   FROM payments p
                   JOIN orders o ON p.order_id = o.order_id
                   WHERE ($attributed = :user_id OR $attributed IS NULL)
                     AND p.payment_status = 'COMPLETED'
                     AND DATE(p.paid_at) = CURDATE()";

    $stmt = $pdo->prepare($summaryQuery);
    $stmt->execute([':user_id' => $userId]);
    $summaryResult = $stmt->fetch();

    if ($summaryResult) {
        $response['summary']['gross_revenue'] = (float)$summaryResult['gross_revenue'];
        $response['summary']['total_orders'] = (int)$summaryResult['total_orders'];
        $response['summary']['order_handled'] = (int)$summaryResult['order_handled'];
        $response['summary']['cash_revenue'] = (float)$summaryResult['cash_revenue'];
        $response['summary']['gcash_revenue'] = (float)$summaryResult['gcash_revenue'];
        $response['summary']['cash_received'] = (float)$summaryResult['cash_received'];
    }

    // --- QUERY 2: SHIFT TRANSACTIONS STREAM (paid transactions today) ---
    $txQuery = "SELECT 
                    o.order_id, 
                    UNIX_TIMESTAMP(p.paid_at) AS paid_at_epoch,
                    UNIX_TIMESTAMP(p.created_at) AS paid_created_epoch,
                    o.order_type, 
                    o.total_amount,
                    o.reference_number,
                    o.customer_name,
                    o.status AS kitchen_status,
                    UPPER(p.payment_method) AS payment_method
                FROM payments p
                JOIN orders o ON p.order_id = o.order_id
                WHERE ($attributed = :user_id OR $attributed IS NULL)
                  AND p.payment_status = 'COMPLETED'
                  AND DATE(p.paid_at) = CURDATE() 
                ORDER BY p.paid_at DESC";

    $stmt = $pdo->prepare($txQuery);
    $stmt->execute([':user_id' => $userId]);
    $transactions = $stmt->fetchAll();

    foreach ($transactions as $row) {
        $response['transactions'][] = [
            'order_id' => $row['order_id'],
            'reference_number' => $row['reference_number'],
            'paid_at_epoch' => $row['paid_at_epoch'] ? (int)$row['paid_at_epoch'] : null,
            'paid_created_epoch' => $row['paid_created_epoch'] ? (int)$row['paid_created_epoch'] : null,
            'order_type' => $row['order_type'],
            'total_amount' => (float)$row['total_amount'],
            'customer_name' => $row['customer_name'],
            'kitchen_status' => $row['kitchen_status'],
            'payment_method' => $row['payment_method']
        ];
    }

    // --- QUERY 3: TOP ITEMS SOLD RANKINGS LIST (among this cashier's PAID orders today) ---
    $itemsQuery = "SELECT 
                    m.item_name, 
                    m.category_id, 
                    SUM(oi.quantity) AS total_qty_sold
                   FROM order_items oi
                   JOIN orders o ON oi.order_id = o.order_id
                   JOIN payments p ON p.order_id = o.order_id AND p.payment_status = 'COMPLETED'
                   JOIN menu_items m ON oi.menu_item_id = m.menu_item_id
WHERE ($attributed = :user_id OR $attributed IS NULL)
                      AND DATE(p.paid_at) = CURDATE()
                   GROUP BY oi.menu_item_id, m.item_name, m.category_id
                   ORDER BY total_qty_sold DESC 
                   LIMIT 5";

    $stmt = $pdo->prepare($itemsQuery);
    $stmt->execute([':user_id' => $userId]);
    $topItems = $stmt->fetchAll();

    foreach ($topItems as $row) {
        $response['top_items'][] = [
            'item_name' => $row['item_name'],
            'category_name' => 'Category #' . $row['category_id'],
            'total_qty_sold' => (int)$row['total_qty_sold']
        ];
    }

    echo json_encode($response);

} catch (Exception $e) {
    echo json_encode([
        'status' => 'ERROR',
        'message' => 'Server exception: ' . $e->getMessage()
    ]);
}
