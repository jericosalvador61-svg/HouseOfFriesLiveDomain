<?php
// Database connection
require_once __DIR__ . '/../auth_middleware.php';
$user = authenticate(['Cashier', 'Admin']);
require_once __DIR__ . '/../db.php';

header('Content-Type: application/json');

try {
    // 1. Capture the filter parameter safely (defaults to 'all')
    $filter = isset($_GET['filter']) ? trim($_GET['filter']) : 'all';

    // Base query components
    // NOTE: customer_name is included so the cashier sees WHO the order is for
    // directly on the card, without having to open the order.
    // REQ-063 #3: payment_status is returned so the cashier UI can distinguish
    // GCASH-unpaid rows (view-only) from CASH rows. The payment METHOD lives on
    // the payments table, not on orders — orders have NO payment_method column
    // (canonical schema + live DB). The unified PENDING list contains every
    // pending order; a GCASH intent is detectable via payment_intent_id +
    // payment_status (see isGcashUnpaid in cashier_dashboard.js).
    $query = "SELECT 
                o.order_id, 
                o.reference_number, 
                o.total_amount, 
                o.status, 
                o.order_type,
                o.created_at,
                o.customer_name,
                o.payment_status,
                o.payment_intent_id,
                t.table_number
              FROM orders o
              LEFT JOIN restaurant_table t ON o.table_id = t.table_id
              WHERE o.status = 'PENDING'";

    $params = [];

    // Apply specific filter rules based on what the cashier clicked
    if ($filter === 'otc') {
        $query .= " AND o.order_type = 'TAKE_OUT'";
    } else if ($filter !== 'all') {
        // Enforce Dine-In and match the table number provided by the dropdown
        $query .= " AND o.order_type = 'DINE_IN' AND t.table_id = :table_id";
        $params['table_id'] = $filter;
    }

    $query .= " ORDER BY o.created_at DESC";

    // Prepare and execute the filtered order fetch
    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $orders = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 2. Adjust count query to align exactly with the current filtered list view
    $countQuery = "SELECT COUNT(*) as pending_count 
                   FROM orders o
                   LEFT JOIN restaurant_table t ON o.table_id = t.table_id
                   WHERE o.status = 'PENDING'";

    if ($filter === 'otc') {
        $countQuery .= " AND o.order_type = 'TAKE_OUT'";
    } else if ($filter !== 'all') {
        $countQuery .= " AND o.order_type = 'DINE_IN' AND t.table_id = :table_id";
    }

    $countStmt = $pdo->prepare($countQuery);
    $countStmt->execute($params);
    $count = $countStmt->fetch(PDO::FETCH_ASSOC)['pending_count'];

    // Send clean JSON back to JavaScript
    echo json_encode([
        'success' => true,
        'count' => (int)$count,
        'orders' => $orders
    ]);
} catch (PDOException $e) {
    error_log($e->getMessage());
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => 'Database error occurred: ' . $e->getMessage()
    ]);
}
