<?php
require_once __DIR__ . '/../../auth_middleware.php';
$auth = authenticate(['Admin', 'Supervisor']);
require_once __DIR__ . '/../../db.php';
header('Content-Type: application/json');

try {
    // 1. Get the list of materials
    $stmt = $pdo->query("
        SELECT raw_material_id, raw_material_name, description, unit, 
               current_quantity, reorder_level, status, is_perishable, img_url, updated_at
        FROM raw_materials
        ORDER BY raw_material_name ASC
    ");
    $materials = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // 2. Get Stats for the 4 Inventory Cards
    $totalItems = count($materials);

    // Low Stock
    $stmtLow = $pdo->query("
        SELECT COUNT(*) 
        FROM raw_materials 
        WHERE current_quantity > 0 
        AND current_quantity <= reorder_level
    ");
    $lowStock = $stmtLow->fetchColumn();

    // Out of Stock
    $stmtOut = $pdo->query("SELECT COUNT(*) FROM raw_materials WHERE current_quantity <= 0");
    $outStock = $stmtOut->fetchColumn();

    // Damaged/Spoilage Stat
    $stmtDamaged = $pdo->query("SELECT SUM(quantity_lost) FROM spoilage WHERE status = 'Approved' OR status IS NULL OR status = ''");
    $damagedTotal = $stmtDamaged->fetchColumn() ?: 0;


    // ====================================================================
    // 🌟 REAL-TIME SALES TELEMETRY (ADMIN METRICS)
    // ====================================================================

    // A. Today's Revenue
    $stmtRevenue = $pdo->query("
        SELECT SUM(amount_paid) 
        FROM payments 
        WHERE DATE(paid_at) = CURDATE() 
          AND payment_status = 'COMPLETED'
    ");
    $todayRevenue = (float)($stmtRevenue->fetchColumn() ?: 0.00);

    // B. Active Orders (still moving through the kitchen)
    $stmtActiveOrders = $pdo->query("
        SELECT COUNT(*) 
        FROM orders 
        WHERE status IN ('PENDING', 'IN-PROGRESS', 'COOKING')
    ");
    $activeOrdersCount = (int)($stmtActiveOrders->fetchColumn() ?: 0);

    // C. Customers Today
    $stmtCustomers = $pdo->query("
        SELECT COUNT(DISTINCT IFNULL(user_id, order_id)) 
        FROM orders 
        WHERE DATE(ordered_at) = CURDATE() 
          AND status != 'Cancelled'
    ");
    $customersTodayCount = (int)($stmtCustomers->fetchColumn() ?: 0);

    // D. Average Order Value
    $stmtAvgOrder = $pdo->query("
        SELECT AVG(total_amount) 
        FROM orders 
        WHERE DATE(ordered_at) = CURDATE() 
          AND status != 'Cancelled'
    ");
    $avgOrderValue = (float)($stmtAvgOrder->fetchColumn() ?: 0.00);

    // E. Gross Profit TODAY = today's revenue − today's COGS.
    // Schema-agnostic: COALESCE(soi.unit_cost, rm.cost_per_unit) IF
    // stock_out_items.unit_cost exists (REQ-057), else rm.cost_per_unit.
    $costExpr = "rm.cost_per_unit";
    $stmtColCheck = $pdo->prepare("
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'stock_out_items' AND column_name = 'unit_cost'
    ");
    $stmtColCheck->execute();
    if ((int)$stmtColCheck->fetchColumn() > 0) {
        $costExpr = "COALESCE(soi.unit_cost, rm.cost_per_unit)";
    }
    $stmtTodayCogs = $pdo->query("
        SELECT SUM(soi.quantity * $costExpr)
        FROM stock_out so
        JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
        JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
        WHERE so.status = 'APPROVED'
          AND DATE(so.stock_out_date) = CURDATE()
    ");
    $todayCogs = (float)($stmtTodayCogs->fetchColumn() ?: 0.00);
    $todayGrossProfit = $todayRevenue - $todayCogs;


    // 3. RECENT SPOILAGE FEED
    $stmtRecentSpoilage = $pdo->query("
        SELECT s.spoilage_date, r.raw_material_name, s.quantity_lost, r.unit, s.spoilage_type 
        FROM spoilage s
        JOIN raw_materials r ON s.raw_material_id = r.raw_material_id
        ORDER BY s.spoilage_date DESC, s.spoilage_id DESC 
        LIMIT 5
    ");
    $recentSpoilage = $stmtRecentSpoilage->fetchAll(PDO::FETCH_ASSOC);


    // ====================================================================
    // 4. BATCH EXPIRATION WATCHLIST (OPTIMIZED AND GROUP-FIXED)
    // ====================================================================
    $stmtExpiration = $pdo->query("
        SELECT 
            sii.raw_material_id,
            rm.raw_material_name,
            rm.unit,
            MIN(sii.expiration_date) AS expiration_date, 
            SUM(sii.quantity) AS total_batch_quantity,    
            DATEDIFF(MIN(sii.expiration_date), CURDATE()) AS days_left
        FROM stock_in_items sii
        JOIN raw_materials rm ON sii.raw_material_id = rm.raw_material_id
        JOIN stock_in si ON sii.stock_in_id = si.stock_in_id
        WHERE rm.is_perishable = 1 
          AND rm.current_quantity > 0       -- <-- ADDED: Ensures main raw material stock isn't zero/depleted
          AND sii.expiration_date IS NOT NULL 
          AND sii.is_deleted = 0
          AND sii.quantity > 0  
          AND (si.status = 'Approved' OR si.status = 'Completed' OR si.status = 'Received')
          AND sii.expiration_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY sii.raw_material_id, rm.raw_material_name, rm.unit 
        HAVING total_batch_quantity > 0 
        ORDER BY days_left ASC
        LIMIT 5
    ");
    $expirationWatch = $stmtExpiration->fetchAll(PDO::FETCH_ASSOC);


    // ====================================================================
    // 🌟 7-DAY WEEKLY SALES GRAPH DATA
    // ====================================================================
    $weeklySales = [];

    // Initialize the calendar tracking array for the last 7 days
    for ($i = 6; $i >= 0; $i--) {
        $dateStr = date('Y-m-d', strtotime("-$i days"));
        $dayName = date('D', strtotime("-$i days"));
        $weeklySales[$dateStr] = [
            'day' => $dayName,
            'date' => $dateStr,
            'sales' => 0.00
        ];
    }

    // Fetch daily aggregated revenue records
    $stmtChart = $pdo->query("
        SELECT DATE(paid_at) as sale_date, SUM(amount_paid) as daily_total
        FROM payments
        WHERE DATE(paid_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
          AND payment_status = 'COMPLETED'
        GROUP BY DATE(paid_at)
    ");
    $chartRows = $stmtChart->fetchAll(PDO::FETCH_ASSOC);

    // Map database totals onto the matching dates
    foreach ($chartRows as $row) {
        if (isset($weeklySales[$row['sale_date']])) {
            $weeklySales[$row['sale_date']]['sales'] = (float)$row['daily_total'];
        }
    }

    $chartDataFormatted = array_values($weeklySales);


    // ====================================================================
    // 🌟 RECENT ORDERS STREAM (LATEST 5) - PLACED SAFELY INSIDE TRY BLOCK
    // ====================================================================
    $stmtRecentOrders = $pdo->query("
        SELECT 
            o.order_id,
            o.reference_number,
            o.total_amount,
            o.created_at,
            t.table_number,
            GROUP_CONCAT(CONCAT(oi.quantity, 'x ', m.item_name) SEPARATOR ', ') AS items_summary
        FROM orders o
        LEFT JOIN restaurant_table t ON o.table_id = t.table_id
        LEFT JOIN order_items oi ON o.order_id = oi.order_id AND oi.is_deleted = 0
        LEFT JOIN menu_items m ON oi.menu_item_id = m.menu_item_id
        WHERE o.status != 'Cancelled'
        GROUP BY o.order_id
        ORDER BY o.created_at DESC
        LIMIT 5
    ");
    $recentOrders = $stmtRecentOrders->fetchAll(PDO::FETCH_ASSOC);

    // Calculate time elapsed strings safely for JavaScript relative time tracking
    foreach ($recentOrders as &$order) {
        $order['time_ago_seconds'] = time() - strtotime($order['created_at']);
    }
    unset($order); // break reference safety flag


    // ====================================================================
    // 🌟 TOP SELLING MENU ITEMS - PLACED SAFELY INSIDE TRY BLOCK
    // PAID=SALE rule: based on COMPLETED payments (cash/GCash), NOT kitchen
    // status - so a paid order counts immediately even if still cooking.
    $stmtTopSelling = $pdo->query("
        SELECT 
            m.item_name,
            SUM(oi.quantity) AS total_orders_count,
            SUM(oi.subtotal) AS total_gross_revenue
        FROM order_items oi
        JOIN menu_items m ON oi.menu_item_id = m.menu_item_id
        JOIN orders o ON oi.order_id = o.order_id
        JOIN payments p ON p.payment_id = (
            SELECT MAX(x.payment_id) FROM payments x
            WHERE x.order_id = o.order_id AND x.payment_status = 'COMPLETED'
        )
        WHERE oi.is_deleted = 0 
          AND o.status <> 'CANCELLED'
        GROUP BY oi.menu_item_id, m.item_name
        ORDER BY total_orders_count DESC
        LIMIT 5
    ");
    $topSelling = $stmtTopSelling->fetchAll(PDO::FETCH_ASSOC);


    // 5. SINGLE RESPONSE OUTPUT BLOCK
    echo json_encode([
        'status' => 'success',
        'data' => $materials,
        'recent_spoilage' => $recentSpoilage,
        'expiration_watchlist' => $expirationWatch,
        'inventory_stats' => [
            'total' => $totalItems,
            'low' => (int)$lowStock,
            'out' => (int)$outStock,
            'damaged' => (float)$damagedTotal
        ],
        'sales_stats' => [
            'today_revenue' => $todayRevenue,
            'active_orders' => $activeOrdersCount,
            'customers_today' => $customersTodayCount,
            'avg_order_value' => $avgOrderValue,
            'gross_profit' => $todayGrossProfit
        ],
        'weekly_sales' => $chartDataFormatted,
        'recent_orders' => $recentOrders,
        'top_selling' => $topSelling
    ]);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Database operation trace failure.',
        'debug_details' => $e->getMessage()
    ]);
}
