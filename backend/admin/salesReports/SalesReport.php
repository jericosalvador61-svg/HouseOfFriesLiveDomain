<?php
// backend/admin/salesReports/SalesReport.php

require_once __DIR__ . '/../../db.php';

class SalesReport {
    private $db;

    public function __construct() {
        global $pdo;
        $this->db = $pdo;
    }

    /**
     * PAID = SALE rule:
     * Revenue is computed from the payments table (payment_status = COMPLETED).
     * An order counts as a sale the moment it is paid - whether cash was taken
     * at the counter by a cashier or the customer paid via GCash/PayMongo -
     * even if the kitchen has not finished it yet.
     * CANCELLED orders are excluded EVEN IF a completed payment exists
     * (verified against live data: cancelled orders can carry completed
     * payments - those are refunds/abandoned carts, not sales).
     */
    private function paidJoin() {
        return "
            JOIN payments p ON p.payment_id = (
                SELECT MAX(x.payment_id) FROM payments x
                WHERE x.order_id = o.order_id AND x.payment_status = 'COMPLETED'
            )
            AND o.status <> 'CANCELLED'
        ";
    }

    /**
     * REQ-056: SCHEMA-AGNOSTIC column guard.
     * New columns (orders.discount_amount, stock_out_items.unit_cost) are applied
     * to the live DB AFTER deploy (REQ-049 / REQ-057). Never write a query that
     * fatals when the column is absent — check information_schema first.
     */
    private function hasColumn(string $table, string $column): bool {
        $stmt = $this->db->prepare("
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
        ");
        $stmt->execute([$table, $column]);
        return (int)$stmt->fetchColumn() > 0;
    }

    /**
     * Gross profit cost side: COGS for the SOLD menu items + addons folded into
     * order_items.price (choices_addons_helper.php), matched against stock-out
     * quantities. Uses stock_out_items.unit_cost snapshot when present (REQ-057),
     * otherwise falls back to raw_materials.cost_per_unit.
     */
    private function cogsCostExpression(): string {
        if ($this->hasColumn('stock_out_items', 'unit_cost')) {
            return "COALESCE(soi.unit_cost, rm.cost_per_unit)";
        }
        return "rm.cost_per_unit";
    }

    /**
     * Discount column expression: orders.discount_amount is a REQ-049 column that
     * may not exist on the live DB yet — guard with 0.00 so the SUM never fatals.
     */
    private function discountExpr(): string {
        return $this->hasColumn('orders', 'discount_amount') ? 'o.discount_amount' : '0';
    }

    /**
     * Get KPI stats (Total Revenue, Paid Orders, Avg Order Value, Best Seller)
     */
    /**
     * COGS for a given date range (schema-agnostic): the cost value of APPROVED
     * stock-out items, optionally restricted to a single day (null $startDate).
     * Uses the same cogsCostExpression() (stock_out_items.unit_cost snapshot
     * when present, else raw_materials.cost_per_unit) as getReportByDay().
     *
     * @return array map date(Y-m-d) => cogs float when grouped by day, else single float
     */
    private function cogsByDateRange(?string $startDate, ?string $endDate, bool $groupByDay = false) {
        $costExpr = $this->cogsCostExpression();

        $select = $groupByDay
            ? "DATE(so.stock_out_date) AS d, SUM(soi.quantity * $costExpr) AS cogs"
            : "SUM(soi.quantity * $costExpr) AS cogs";

        $sql = "SELECT $select
                FROM stock_out so
                JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
                JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
                WHERE so.status = 'APPROVED'
                  AND so.stock_out_date BETWEEN :start AND :end
                " . ($groupByDay ? "GROUP BY d" : "");

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);

        if ($groupByDay) {
            $rows = $stmt->fetchAll();
            $byDay = [];
            foreach ($rows as $row) {
                $byDay[$row['d']] = (float)$row['cogs'];
            }
            return $byDay;
        }

        $row = $stmt->fetch();
        return (float)($row['cogs'] ?? 0);
    }

    /**
     * REQ-056: Per-day sales report over a paid range (PAID-only join).
     * Missing days in the range are zero-filled so the table shows a
     * continuous calendar. Gross profit per day = revenue − COGS where COGS
     * is the APPROVED stock-out cost value for that same day.
     */
    public function getReportByDay($startDate, $endDate) {
        $discountExpr = $this->discountExpr();

        // 1. Per-day PAID revenue/orders/net-sales/discount
        $sql = "SELECT 
                    DATE(p.paid_at) AS d,
                    COALESCE(SUM(p.amount_paid), 0) AS revenue,
                    COUNT(DISTINCT o.order_id) AS order_count,
                    COALESCE(SUM(o.total_amount), 0) AS net_sales,
                    COALESCE(SUM($discountExpr), 0) AS discount_amount
                FROM orders o
                {$this->paidJoin()}
                WHERE DATE(p.paid_at) BETWEEN :start AND :end
                GROUP BY DATE(p.paid_at)
                ORDER BY d ASC";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);
        $rows = $stmt->fetchAll();

        $byDay = [];
        foreach ($rows as $row) {
            $byDay[$row['d']] = [
                'date' => $row['d'],
                'revenue' => (float)$row['revenue'],
                'order_count' => (int)$row['order_count'],
                'net_sales' => (float)$row['net_sales'],
                'discount_amount' => (float)$row['discount_amount'],
                'gross_profit' => 0.0
            ];
        }

        // 2. Per-day COGS from APPROVED stock-outs (schema-agnostic cost expr).
        // A revenue day with no approved stock-out rows has no COGS entry — its
        // gross profit is the full revenue (cogs 0), never left at 0.0.
        $cogsByDay = $this->cogsByDateRange($startDate, $endDate, true);
        foreach ($byDay as $day => &$row) {
            $row['gross_profit'] = $row['revenue'] - ($cogsByDay[$day] ?? 0);
        }
        unset($row);

        // 3. Zero-fill the calendar between start/end
        $startDt = new DateTimeImmutable($startDate);
        $endDt = new DateTimeImmutable($endDate);
        $result = [];
        for ($cursor = $startDt; $cursor <= $endDt; $cursor = $cursor->modify('+1 day')) {
            $dayKey = $cursor->format('Y-m-d');
            $result[] = $byDay[$dayKey] ?? [
                'date' => $dayKey,
                'revenue' => 0.0,
                'order_count' => 0,
                'net_sales' => 0.0,
                'discount_amount' => 0.0,
                'gross_profit' => 0.0
            ];
        }

        return $result;
    }

    public function getStats($startDate, $endDate) {
        $discountExpr = $this->discountExpr();

        // Revenue from actual received payments (cash + GCash)
        $sql = "SELECT 
                    COUNT(DISTINCT o.order_id) AS total_orders,
                    COALESCE(SUM(p.amount_paid), 0) AS total_revenue,
                    COALESCE(AVG(p.amount_paid), 0) AS avg_order_value,
                    COALESCE(SUM(CASE WHEN UPPER(p.payment_method) IN ('GCASH','ONLINE','CARD') THEN p.amount_paid ELSE 0 END), 0) AS gcash_revenue,
                    COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'CASH' THEN p.amount_paid ELSE 0 END), 0) AS cash_revenue,
                    COALESCE(SUM($discountExpr), 0) AS total_discount,
                    COALESCE(SUM(o.total_amount), 0) AS net_sales
                FROM orders o
                {$this->paidJoin()}
                WHERE DATE(p.paid_at) BETWEEN :start AND :end";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);
        $stats = $stmt->fetch();

        // Best seller item fetch (unchanged, below).

        // Get best selling item (by revenue, among PAID orders)
        $sqlBest = "SELECT 
                        mi.item_name,
                        SUM(oi.quantity * oi.price) AS total_revenue,
                        SUM(oi.quantity) AS total_quantity
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.order_id
                    JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
                    {$this->paidJoin()}
                    WHERE DATE(p.paid_at) BETWEEN :start AND :end
                    GROUP BY oi.menu_item_id
                    ORDER BY total_revenue DESC
                    LIMIT 1";

        $stmt = $this->db->prepare($sqlBest);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);
        $bestSeller = $stmt->fetch();

        // COGS across the whole range (schema-agnostic) for Gross Profit
        $cogs = $this->cogsByDateRange($startDate, $endDate, false);

        return [
            'total_orders' => (int)$stats['total_orders'],
            'total_revenue' => (float)$stats['total_revenue'],
            'avg_order_value' => (float)$stats['avg_order_value'],
            'gcash_revenue' => (float)$stats['gcash_revenue'],
            'cash_revenue' => (float)$stats['cash_revenue'],
            'total_discount' => (float)$stats['total_discount'],
            'net_sales' => (float)($stats['net_sales'] ?? 0),
            'gross_profit' => (float)$stats['total_revenue'] - $cogs,
            'best_seller' => $bestSeller ? [
                'item_name' => $bestSeller['item_name'],
                'total_revenue' => (float)$bestSeller['total_revenue'],
                'total_quantity' => (int)$bestSeller['total_quantity']
            ] : null
        ];
    }

    /**
     * Get chart data grouped by date (daily/weekly/monthly/yearly).
     * REQ-061: optional $metric ('revenue'|'orders'|'gross_profit') selects the
     * dominant series; 'gross_profit' adds a per-period gross-profit array
     * (revenue − COGS per period, schema-agnostic).
     */
    public function getChartData($startDate, $endDate, $groupBy = 'day', $metric = 'revenue') {
        $format = $this->getDateFormat($groupBy);

        $sql = "SELECT 
                    DATE_FORMAT(p.paid_at, '$format') AS period,
                    DATE(p.paid_at) AS date,
                    COUNT(DISTINCT o.order_id) AS order_count,
                    COALESCE(SUM(p.amount_paid), 0) AS revenue
                FROM orders o
                {$this->paidJoin()}
                WHERE DATE(p.paid_at) BETWEEN :start AND :end
                GROUP BY period, date
                ORDER BY date ASC";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);
        $results = $stmt->fetchAll();

        $labels = [];
        $revenue = [];
        $orders = [];

        foreach ($results as $row) {
            $labels[] = $row['period'];
            $revenue[] = (float)$row['revenue'];
            $orders[] = (int)$row['order_count'];
        }

        $grossProfit = $this->computePerPeriodGrossProfit($startDate, $endDate, $groupBy, $results, $labels);

        return [
            'labels' => $labels,
            'revenue' => $revenue,
            'orders' => $orders,
            'gross_profit' => $grossProfit
        ];
    }

    /**
     * Get chart data filtered by specific menu item.
     * REQ-061: optional $metric + gross_profit series, same shape as getChartData().
     */
    public function getChartDataByMenuItem($startDate, $endDate, $menuItemId, $groupBy = 'day', $metric = 'revenue') {
        $format = $this->getDateFormat($groupBy);

        $sql = "SELECT 
                    DATE_FORMAT(p.paid_at, '$format') AS period,
                    DATE(p.paid_at) AS date,
                    COUNT(DISTINCT o.order_id) AS order_count,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue
                FROM orders o
                JOIN order_items oi ON o.order_id = oi.order_id
                {$this->paidJoin()}
                WHERE DATE(p.paid_at) BETWEEN :start AND :end
                    AND oi.menu_item_id = :menu_item_id
                GROUP BY period, date
                ORDER BY date ASC";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([
            ':start' => $startDate,
            ':end' => $endDate,
            ':menu_item_id' => $menuItemId
        ]);
        $results = $stmt->fetchAll();

        $labels = [];
        $revenue = [];
        $orders = [];

        foreach ($results as $row) {
            $labels[] = $row['period'];
            $revenue[] = (float)$row['revenue'];
            $orders[] = (int)$row['order_count'];
        }

        $grossProfit = $this->computePerPeriodGrossProfit($startDate, $endDate, $groupBy, $results, $labels);

        return [
            'labels' => $labels,
            'revenue' => $revenue,
            'orders' => $orders,
            'gross_profit' => $grossProfit
        ];
    }

    /**
     * REQ-061: per-period gross profit = revenue − COGS. Revenue per period is
     * taken from the already-fetched paid rows; COGS is the APPROVED stock-out
     * cost value for that period. Falls back to zero for missing periods so the
     * series always aligns 1:1 with the chart labels.
     */
    private function computePerPeriodGrossProfit($startDate, $endDate, $groupBy, $results, $labels) {
        $costExpr = $this->cogsCostExpression();
        $periodExpr = match ($groupBy) {
            'day' => "DATE(so.stock_out_date)",
            'week' => "DATE_FORMAT(so.stock_out_date, '%Y-%u')",
            'month' => "DATE_FORMAT(so.stock_out_date, '%Y-%m')",
            'year' => "DATE_FORMAT(so.stock_out_date, '%Y')",
            default => "DATE(so.stock_out_date)"
        };

        $sql = "SELECT $periodExpr AS period, SUM(soi.quantity * $costExpr) AS cogs
                FROM stock_out so
                JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
                JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
                WHERE so.status = 'APPROVED'
                  AND so.stock_out_date BETWEEN :start AND :end
                GROUP BY period";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);

        $cogsByPeriod = [];
        foreach ($stmt->fetchAll() as $row) {
            $cogsByPeriod[$row['period']] = (float)$row['cogs'];
        }

        // Revenue per period keyed by the same period label as $labels
        $revenueByPeriod = [];
        foreach ($results as $row) {
            $periodLabel = $row['period'];
            $revenueByPeriod[$periodLabel] = (float)$row['revenue'];
        }

        $grossProfit = [];
        foreach ($labels as $label) {
            $rev = $revenueByPeriod[$label] ?? 0;
            $cogs = $cogsByPeriod[$label] ?? 0;
            $grossProfit[] = $rev - $cogs;
        }

        return $grossProfit;
    }

    /**
     * Get top selling products (among PAID orders)
     */
    public function getTopSelling($startDate, $endDate, $limit = 10) {
        $sql = "SELECT 
                    mi.menu_item_id,
                    mi.item_name,
                    mi.price,
                    SUM(oi.quantity) AS total_quantity,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS total_revenue,
                    COUNT(DISTINCT o.order_id) AS order_count
                FROM order_items oi
                JOIN orders o ON oi.order_id = o.order_id
                JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
                {$this->paidJoin()}
                WHERE DATE(p.paid_at) BETWEEN :start AND :end
                GROUP BY mi.menu_item_id
                ORDER BY total_revenue DESC
                LIMIT :limit";

        $stmt = $this->db->prepare($sql);
        $stmt->bindValue(':start', $startDate);
        $stmt->bindValue(':end', $endDate);
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /**
     * Get hourly distribution (peak sales time, paid orders)
     */
    public function getHourlyDistribution($startDate, $endDate) {
        $sql = "SELECT 
                    HOUR(p.paid_at) AS hour,
                    COUNT(DISTINCT o.order_id) AS order_count,
                    COALESCE(SUM(p.amount_paid), 0) AS revenue
                FROM orders o
                {$this->paidJoin()}
                WHERE DATE(p.paid_at) BETWEEN :start AND :end
                GROUP BY HOUR(p.paid_at)
                ORDER BY hour ASC";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);
        $results = $stmt->fetchAll();

        // Fill missing hours with 0
        $hourlyData = array_fill(0, 24, ['hour' => 0, 'order_count' => 0, 'revenue' => 0]);
        foreach ($results as $row) {
            $hour = (int)$row['hour'];
            $hourlyData[$hour] = [
                'hour' => $hour,
                'order_count' => (int)$row['order_count'],
                'revenue' => (float)$row['revenue']
            ];
        }

        // Find peak hour
        $peakHour = null;
        $maxOrders = 0;
        foreach ($hourlyData as $data) {
            if ($data['order_count'] > $maxOrders) {
                $maxOrders = $data['order_count'];
                $peakHour = $data;
            }
        }

        return [
            'hourly_data' => $hourlyData,
            'peak_hour' => $peakHour ? [
                'hour' => $peakHour['hour'],
                'order_count' => $peakHour['order_count'],
                'revenue' => $peakHour['revenue'],
                'time_label' => date('g:i A', mktime($peakHour['hour'], 0, 0))
            ] : null
        ];
    }

    /**
     * Get all menu items for dropdown
     */
    public function getMenuItems() {
        $sql = "SELECT menu_item_id, item_name, price, category_id 
                FROM menu_items 
                WHERE status = 'Available'
                ORDER BY item_name ASC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute();
        return $stmt->fetchAll();
    }

    /**
     * Get report data for export (CSV/Excel) - PAID orders only
     */
    public function getReportData($startDate, $endDate, $menuItemId = null) {
        $sql = "SELECT 
                    o.order_id,
                    o.reference_number,
                    o.ordered_at,
                    o.order_type,
                    o.total_amount,
                    o.subtotal_amount,
                    {$this->discountExpr()} AS discount_amount,
                    COALESCE(dt.name, '') AS discount_type_name,
                    o.status,
                    UPPER(p.payment_method) AS payment_method,
                    p.paid_at,
                    TRIM(CONCAT(COALESCE(u.first_name,''), ' ', COALESCE(u.last_name,''))) AS cashier_name,
                    mi.item_name,
                    oi.quantity,
                    oi.price,
                    (oi.quantity * oi.price) AS subtotal
                FROM orders o
                JOIN order_items oi ON o.order_id = oi.order_id
                JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
                {$this->paidJoin()}
                LEFT JOIN users u ON u.user_id = COALESCE(p.user_id, o.user_id)
                LEFT JOIN discount_types dt ON dt.discount_type_id = o.discount_type_id
                WHERE DATE(p.paid_at) BETWEEN :start AND :end";

        $params = [':start' => $startDate, ':end' => $endDate];

        if ($menuItemId) {
            $sql .= " AND oi.menu_item_id = :menu_item_id";
            $params[':menu_item_id'] = $menuItemId;
        }

        $sql .= " ORDER BY p.paid_at DESC, o.order_id DESC";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /**
     * Helper: Get date format based on groupBy
     */
    private function getDateFormat($groupBy) {
        return match ($groupBy) {
            'day' => '%Y-%m-%d',
            'week' => '%Y-%u',
            'month' => '%Y-%m',
            'year' => '%Y',
            default => '%Y-%m-%d'
        };
    }
}
