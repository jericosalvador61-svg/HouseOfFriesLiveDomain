<?php
// backend/admin/inventoryReports/InventoryReportController.php
require_once __DIR__ . '/InventoryReport.php';

class InventoryReportController {
    private $model;

    public function __construct() {
        $this->model = new InventoryReport();
    }

    private function respond($data, $statusCode = 200) {
        http_response_code($statusCode);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }

    private function getDateRange() {
        $start = $_GET['start_date'] ?? date('Y-m-d', strtotime('-30 days'));
        $end = $_GET['end_date'] ?? date('Y-m-d');
        return [$start, $end];
    }

    public function getStats() {
        list($start, $end) = $this->getDateRange();
        $data = $this->model->getStats($start, $end);
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function getChartData() {
        list($start, $end) = $this->getDateRange();
        $groupBy = $_GET['group_by'] ?? 'day';
        $chartMetric = $_GET['chart_metric'] ?? 'all';
        $data = $this->model->getChartData($start, $end, $groupBy, $chartMetric);
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function getMaterialPerformance() {
        list($start, $end) = $this->getDateRange();
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 10;
        $data = $this->model->getMaterialPerformance($start, $end, $limit);
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function getMovementData() {
        list($start, $end) = $this->getDateRange();
        $limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
        $data = $this->model->getMovementData($start, $end, $limit);
        $this->respond(['status' => 'success', 'data' => $data]);
    }

    public function exportCSV() {
        list($start, $end) = $this->getDateRange();
        $data = $this->model->getMovementData($start, $end, 5000);

        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="inventory_report_' . date('Y-m-d') . '.csv"');

        $output = fopen('php://output', 'w');
        fputcsv($output, ['Type', 'Date', 'Material', 'Quantity', 'Value', 'Status']);

        foreach ($data as $row) {
            fputcsv($output, [
                $row['type'],
                $row['date'],
                $row['raw_material_name'],
                $row['quantity'],
                $row['value'],
                $row['status']
            ]);
        }
        fclose($output);
        exit;
    }

    public function exportExcel() {
        list($start, $end) = $this->getDateRange();
        $data = $this->model->getMovementData($start, $end, 5000);

        header('Content-Type: application/vnd.ms-excel');
        header('Content-Disposition: attachment; filename="inventory_report_' . date('Y-m-d') . '.xls"');

        echo '<html><head><meta charset="UTF-8"></head><body>';
        echo '<h2>Inventory Report</h2>';
        echo '<p>Period: ' . $start . ' to ' . $end . '</p>';
        echo '<table border="1" cellpadding="5">';
        echo '<tr style="background:#f0f0f0;">';
        echo '<th>Type</th><th>Date</th><th>Material</th><th>Quantity</th><th>Value (₱)</th><th>Status</th>';
        echo '</tr>';

        foreach ($data as $row) {
            echo '<tr>';
            echo '<td>' . $row['type'] . '</td>';
            echo '<td>' . $row['date'] . '</td>';
            echo '<td>' . $row['raw_material_name'] . '</td>';
            echo '<td>' . $row['quantity'] . '</td>';
            echo '<td>' . number_format($row['value'], 2) . '</td>';
            echo '<td>' . $row['status'] . '</td>';
            echo '</tr>';
        }
        echo '</table>';
        echo '</body></html>';
        exit;
    }
}