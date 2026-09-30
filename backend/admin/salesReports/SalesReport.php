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
     * Get KPI stats (Total Revenue, Paid Orders, Avg Order Value, Best Seller)
     */
    public function getStats($startDate, $endDate) {
        // Revenue from actual received payments (cash + GCash)
        $sql = "SELECT 
                    COUNT(DISTINCT o.order_id) AS total_orders,
                    COALESCE(SUM(p.amount_paid), 0) AS total_revenue,
                    COALESCE(AVG(p.amount_paid), 0) AS avg_order_value,
                    COALESCE(SUM(CASE WHEN UPPER(p.payment_method) IN ('GCASH','ONLINE','CARD') THEN p.amount_paid ELSE 0 END), 0) AS gcash_revenue,
                    COALESCE(SUM(CASE WHEN UPPER(p.payment_method) = 'CASH' THEN p.amount_paid ELSE 0 END), 0) AS cash_revenue,
                    COALESCE(SUM(o.discount_amount), 0) AS total_discount
                FROM orders o
                {$this->paidJoin()}
                WHERE DATE(p.paid_at) BETWEEN :start AND :end";

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);
        $stats = $stmt->fetch();

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

        return [
            'total_orders' => (int)$stats['total_orders'],
            'total_revenue' => (float)$stats['total_revenue'],
            'avg_order_value' => (float)$stats['avg_order_value'],
            'gcash_revenue' => (float)$stats['gcash_revenue'],
            'cash_revenue' => (float)$stats['cash_revenue'],
            'total_discount' => (float)$stats['total_discount'],
            'best_seller' => $bestSeller ? [
                'item_name' => $bestSeller['item_name'],
                'total_revenue' => (float)$bestSeller['total_revenue'],
                'total_quantity' => (int)$bestSeller['total_quantity']
            ] : null
        ];
    }

    /**
     * Get chart data grouped by date (daily/weekly/monthly/yearly)
     */
    public function getChartData($startDate, $endDate, $groupBy = 'day') {
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

        return [
            'labels' => $labels,
            'revenue' => $revenue,
            'orders' => $orders
        ];
    }

    /**
     * Get chart data filtered by specific menu item
     */
    public function getChartDataByMenuItem($startDate, $endDate, $menuItemId, $groupBy = 'day') {
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

        return [
            'labels' => $labels,
            'revenue' => $revenue,
            'orders' => $orders
        ];
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
                    o.discount_amount,
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
