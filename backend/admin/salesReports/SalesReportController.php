<?php
// backend/admin/salesReports/SalesReportController.php

require_once __DIR__ . '/SalesReport.php';
require_once __DIR__ . '/../../date_window_helper.php';

class SalesReportController {
    private $model;
    private $user;

    public function __construct(array $user = []) {
        $this->model = new SalesReport();
        $this->user = $user;
    }

    private function respond($data, $statusCode = 200) {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }

    private function getDateRange() {
        $start = $_GET['start_date'] ?? date('Y-m-d', strtotime('-7 days'));
        $end = $_GET['end_date'] ?? date('Y-m-d');

        if (($this->user['role'] ?? '') === 'Supervisor') {
            $window = hof_month_window($start ?: null, $end ?: null);
            if ($window['blocked']) {
                $this->respond(['success' => false, 'message' => 'Supervisor access is limited to the last 31 days.'], 400);
                exit; // respond() already exits; explicit for clarity + safety
            }
            list($start, $end) = [$window['from'], $window['to']];
        }

        return [$start, $end];
    }

    public function getStats() {
        list($start, $end) = $this->getDateRange();
        $menuItemId = isset($_GET['menu_item_id']) ? (int)$_GET['menu_item_id'] : null;
        $data = $this->model->getStats($start, $end, $menuItemId);
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function getChartData() {
        list($start, $end) = $this->getDateRange();
        $groupBy = $_GET['group_by'] ?? 'day';
        $metric = $_GET['metric'] ?? 'revenue';
        $menuItemId = isset($_GET['menu_item_id']) ? (int)$_GET['menu_item_id'] : null;

        if ($menuItemId) {
            $data = $this->model->getChartDataByMenuItem($start, $end, $menuItemId, $groupBy, $metric);
        } else {
            $data = $this->model->getChartData($start, $end, $groupBy, $metric);
        }

        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function getReport() {
        list($start, $end) = $this->getDateRange();
        $menuItemId = isset($_GET['menu_item_id']) ? (int)$_GET['menu_item_id'] : null;
        $data = $this->model->getReportByDay($start, $end, $menuItemId);
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function getTopSelling() {
        list($start, $end) = $this->getDateRange();
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 10;
        $menuItemId = isset($_GET['menu_item_id']) ? (int)$_GET['menu_item_id'] : null;
        $data = $this->model->getTopSelling($start, $end, $limit, $menuItemId);
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function getHourlyDistribution() {
        list($start, $end) = $this->getDateRange();
        $menuItemId = isset($_GET['menu_item_id']) ? (int)$_GET['menu_item_id'] : null;
        $data = $this->model->getHourlyDistribution($start, $end, $menuItemId);
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function getMenuItems() {
        $data = $this->model->getMenuItems();
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function exportCSV() {
        list($start, $end) = $this->getDateRange();
        $menuItemId = isset($_GET['menu_item_id']) ? (int)$_GET['menu_item_id'] : null;
        $data = $this->model->getReportData($start, $end, $menuItemId);

        // Set headers for CSV download
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="sales_report_' . date('Y-m-d') . '.csv"');

        $output = fopen('php://output', 'w');
        fputcsv($output, ['Order ID', 'Reference', 'Date', 'Type', 'Subtotal', 'Discount', 'Total Amount', 'Status', 'Item', 'Quantity', 'Price', 'Subtotal/Line']);

        foreach ($data as $row) {
            fputcsv($output, [
                $row['order_id'],
                $row['reference_number'],
                $row['ordered_at'],
                $row['order_type'],
                $row['subtotal_amount'] ?? $row['total_amount'],
                $row['discount_amount'] ?? '0.00',
                $row['total_amount'],
                $row['status'],
                $row['item_name'],
                $row['quantity'],
                $row['price'],
                $row['subtotal']
            ]);
        }

        fclose($output);
        exit;
    }

    public function exportExcel() {
        list($start, $end) = $this->getDateRange();
        $menuItemId = isset($_GET['menu_item_id']) ? (int)$_GET['menu_item_id'] : null;
        $data = $this->model->getReportData($start, $end, $menuItemId);

        // Simple Excel export using HTML table (works in Excel)
        header('Content-Type: application/vnd.ms-excel');
        header('Content-Disposition: attachment; filename="sales_report_' . date('Y-m-d') . '.xls"');

        echo '<html><head><meta charset="UTF-8"></head><body>';
        echo '<h2>Sales Report</h2>';
        echo '<p>Period: ' . $start . ' to ' . $end . '</p>';
        echo '<table border="1" cellpadding="5">';
        echo '<tr style="background:#f0f0f0;">';
        echo '<th>Order ID</th><th>Reference</th><th>Date</th><th>Type</th>';
        echo '<th>Subtotal</th><th>Discount</th><th>Total Amount</th><th>Status</th><th>Item</th><th>Quantity</th><th>Price</th><th>Subtotal/Line</th>';
        echo '</tr>';

        $totalRevenue = 0;
        foreach ($data as $row) {
            echo '<tr>';
            echo '<td>' . $row['order_id'] . '</td>';
            echo '<td>' . $row['reference_number'] . '</td>';
            echo '<td>' . $row['ordered_at'] . '</td>';
            echo '<td>' . $row['order_type'] . '</td>';
            echo '<td>' . number_format($row['subtotal_amount'] ?? $row['total_amount'], 2) . '</td>';
            echo '<td>' . number_format($row['discount_amount'] ?? 0, 2) . '</td>';
            echo '<td>' . number_format($row['total_amount'], 2) . '</td>';
            echo '<td>' . $row['status'] . '</td>';
            echo '<td>' . $row['item_name'] . '</td>';
            echo '<td>' . $row['quantity'] . '</td>';
            echo '<td>' . number_format($row['price'], 2) . '</td>';
            echo '<td>' . number_format($row['subtotal'], 2) . '</td>';
            echo '</tr>';
            $totalRevenue += $row['subtotal'];
        }

        echo '<tr style="background:#f0f0f0; font-weight:bold;">';
        echo '<td colspan="11" align="right">Total Revenue:</td>';
        echo '<td>' . number_format($totalRevenue, 2) . '</td>';
        echo '</tr>';
        echo '</table>';
        echo '</body></html>';
        exit;
    }
}