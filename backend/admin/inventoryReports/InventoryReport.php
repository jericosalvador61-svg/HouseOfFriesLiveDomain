<?php
require_once __DIR__ . '/../../db.php';

class InventoryReport {
    private $db;

    public function __construct() {
        global $pdo;
        $this->db = $pdo;
    }

    /**
     * Get KPI stats for inventory
     */
    public function getStats($startDate, $endDate) {
        // Total raw materials
        $totalMat = $this->db->query("SELECT COUNT(*) FROM raw_materials WHERE status='Active'")->fetchColumn();

        // Low stock items
        $lowStmt = $this->db->prepare("SELECT COUNT(*) FROM raw_materials WHERE current_quantity <= reorder_level AND status='Active' AND current_quantity > 0");
        $lowStmt->execute();
        $lowStock = (int)$lowStmt->fetchColumn();

        // Out of stock
        $outStmt = $this->db->prepare("SELECT COUNT(*) FROM raw_materials WHERE (current_quantity <= 0 OR current_quantity IS NULL) AND status='Active'");
        $outStmt->execute();
        $outStock = (int)$outStmt->fetchColumn();

        // Total stock in value (approved)
        $siStmt = $this->db->prepare("SELECT COALESCE(SUM(total_cost), 0) FROM stock_in WHERE status='APPROVED' AND stock_in_date BETWEEN ? AND ?");
        $siStmt->execute([$startDate, $endDate]);
        $stockInValue = (float)$siStmt->fetchColumn();

        // Total spoilage loss
        $spStmt = $this->db->prepare("SELECT COALESCE(SUM(estimated_loss_cost), 0) FROM spoilage WHERE status='APPROVED' AND spoilage_date BETWEEN ? AND ?");
        $spStmt->execute([$startDate, $endDate]);
        $spoilageLoss = (float)$spStmt->fetchColumn();

        // Damaged = COUNT of PENDING spoilage/waste/damage (shared KPI definition)
        $damagedStmt = $this->db->prepare("
            SELECT COUNT(*)
            FROM spoilage
            WHERE status = 'PENDING'
              AND spoilage_type IN ('SPOILAGE','WASTE','DAMAGE')
        ");
        $damagedStmt->execute();
        $damagedCount = (int)$damagedStmt->fetchColumn();

        // Pending returns count
        $retStmt = $this->db->prepare("SELECT COUNT(*) FROM returns WHERE status='PENDING'");
        $retStmt->execute();
        $pendingReturns = (int)$retStmt->fetchColumn();

        // Total stock out qty
        $soStmt = $this->db->prepare("SELECT COALESCE(SUM(soi.quantity), 0) FROM stock_out_items soi JOIN stock_out so ON soi.stock_out_id = so.stock_out_id WHERE so.status='APPROVED' AND so.stock_out_date BETWEEN ? AND ?");
        $soStmt->execute([$startDate, $endDate]);
        $stockOutQty = (float)$soStmt->fetchColumn();

        return [
            'total_materials'   => (int)$totalMat,
            'low_stock'         => $lowStock,
            'out_stock'         => $outStock,
            'stock_in_value'    => $stockInValue,
            'spoilage_loss'     => $spoilageLoss,
            'pending_returns'   => $pendingReturns,
            'damaged'           => $damagedCount,
            'stock_out_qty'     => $stockOutQty
        ];
    }

    /**
     * Get chart data for inventory activity
     */
    public function getChartData($startDate, $endDate, $groupBy = 'day', $chartMetric = 'stock_in') {
        $format = $this->getDateFormat($groupBy);

        switch ($chartMetric) {
            case 'stock_in':
                $sql = "SELECT 
                            DATE_FORMAT(si.stock_in_date, '$format') AS period,
                            DATE(si.stock_in_date) AS date,
                            COALESCE(SUM(si.total_cost), 0) AS value,
                            COUNT(DISTINCT si.stock_in_id) AS count
                        FROM stock_in si
                        WHERE si.status='APPROVED' AND si.stock_in_date BETWEEN :start AND :end
                        GROUP BY period, date
                        ORDER BY date ASC";
                break;

            case 'stock_out':
                $sql = "SELECT 
                            DATE_FORMAT(so.stock_out_date, '$format') AS period,
                            DATE(so.stock_out_date) AS date,
                            COALESCE(SUM(soi.quantity), 0) AS value,
                            COUNT(DISTINCT so.stock_out_id) AS count
                        FROM stock_out so
                        JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
                        WHERE so.status='APPROVED' AND so.stock_out_date BETWEEN :start AND :end
                        GROUP BY period, date
                        ORDER BY date ASC";
                break;

            case 'spoilage':
                $sql = "SELECT 
                            DATE_FORMAT(s.spoilage_date, '$format') AS period,
                            DATE(s.spoilage_date) AS date,
                            COALESCE(SUM(s.estimated_loss_cost), 0) AS value,
                            COUNT(DISTINCT s.spoilage_id) AS count
                        FROM spoilage s
                        WHERE s.status='APPROVED' AND s.spoilage_date BETWEEN :start AND :end
                        GROUP BY period, date
                        ORDER BY date ASC";
                break;

            case 'returns':
                $sql = "SELECT 
                            DATE_FORMAT(r.return_date, '$format') AS period,
                            DATE(r.return_date) AS date,
                            COALESCE(SUM(ri.quantity), 0) AS value,
                            COUNT(DISTINCT r.return_id) AS count
                        FROM returns r
                        JOIN return_items ri ON r.return_id = ri.return_id
                        WHERE r.status='APPROVED' AND r.return_date BETWEEN :start AND :end
                        GROUP BY period, date
                        ORDER BY date ASC";
                break;

            case 'all':
            default:
                $sql = "SELECT 
                            DATE_FORMAT(si.stock_in_date, '$format') AS period,
                            DATE(si.stock_in_date) AS date,
                            COALESCE(SUM(si.total_cost), 0) AS stock_in_value,
                            COALESCE(so_sub.value, 0) AS stock_out_value,
                            COALESCE(sp_sub.value, 0) AS spoilage_value,
                            COALESCE(ret_sub.value, 0) AS return_value
                        FROM stock_in si
                        LEFT JOIN (
                            SELECT DATE(so.stock_out_date) AS d, COALESCE(SUM(soi.quantity), 0) AS value
                            FROM stock_out so JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
                            WHERE so.status='APPROVED' AND so.stock_out_date BETWEEN :start AND :end
                            GROUP BY d
                        ) so_sub ON DATE(si.stock_in_date) = so_sub.d
                        LEFT JOIN (
                            SELECT DATE(s.spoilage_date) AS d, COALESCE(SUM(s.estimated_loss_cost), 0) AS value
                            FROM spoilage s WHERE s.status='APPROVED' AND s.spoilage_date BETWEEN :start AND :end
                            GROUP BY d
                        ) sp_sub ON DATE(si.stock_in_date) = sp_sub.d
                        LEFT JOIN (
                            SELECT DATE(r.return_date) AS d, COALESCE(SUM(ri.quantity), 0) AS value
                            FROM returns r JOIN return_items ri ON r.return_id = ri.return_id
                            WHERE r.status='APPROVED' AND r.return_date BETWEEN :start AND :end
                            GROUP BY d
                        ) ret_sub ON DATE(si.stock_in_date) = ret_sub.d
                        WHERE si.status='APPROVED' AND si.stock_in_date BETWEEN :start AND :end
                        GROUP BY period, date, stock_in_value, stock_out_value, spoilage_value, return_value
                        ORDER BY date ASC";
                break;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':start' => $startDate, ':end' => $endDate]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Format for chart
        $labels = [];
        $values = [];
        $counts = [];

        foreach ($rows as $row) {
            $labels[] = $row['period'];
            if ($chartMetric === 'all') {
                $values[] = [
                    'stock_in' => (float)$row['stock_in_value'],
                    'stock_out' => (float)$row['stock_out_value'],
                    'spoilage' => (float)$row['spoilage_value'],
                    'returns' => (float)$row['return_value']
                ];
            } else {
                $values[] = (float)$row['value'];
                $counts[] = (int)$row['count'];
            }
        }

        return [
            'labels' => $labels,
            'values' => $values,
            'counts' => $counts
        ];
    }

    /**
     * Get raw material performance data
     */
    public function getMaterialPerformance($startDate, $endDate, $limit = 10) {
        $sql = "SELECT 
                    rm.raw_material_id,
                    rm.raw_material_name,
                    rm.unit,
                    rm.current_quantity,
                    rm.reorder_level,
                    rm.cost_per_unit,
                    COALESCE(SUM(soi.quantity), 0) AS total_stock_out,
                    COALESCE(SUM(sp.quantity_lost), 0) AS total_spoiled,
                    COALESCE(SUM(ri.quantity), 0) AS total_returned
                FROM raw_materials rm
                LEFT JOIN stock_out_items soi ON rm.raw_material_id = soi.raw_material_id
                LEFT JOIN stock_out so ON soi.stock_out_id = so.stock_out_id AND so.status='APPROVED' AND so.stock_out_date BETWEEN :start AND :end
                LEFT JOIN spoilage sp ON rm.raw_material_id = sp.raw_material_id AND sp.status='APPROVED' AND sp.spoilage_date BETWEEN :start AND :end
                LEFT JOIN return_items ri ON rm.raw_material_id = ri.raw_material_id
                LEFT JOIN returns r ON ri.return_id = r.return_id AND r.status='APPROVED' AND r.return_date BETWEEN :start AND :end
                WHERE rm.status='Active'
                GROUP BY rm.raw_material_id
                ORDER BY total_stock_out DESC
                LIMIT :limit";

        $stmt = $this->db->prepare($sql);
        $stmt->bindValue(':start', $startDate, PDO::PARAM_STR);
        $stmt->bindValue(':end', $endDate, PDO::PARAM_STR);
        $stmt->bindValue(':limit', (int)$limit, PDO::PARAM_INT);
        $stmt->execute();

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Get stock movement data for table
     */
    public function getMovementData($startDate, $endDate, $limit = 50) {
        $sql = "(SELECT 'Stock In' AS type, si.stock_in_date AS date, rm.raw_material_name, sis.quantity, si.total_cost AS value, si.status
                FROM stock_in si
                JOIN stock_in_items sis ON si.stock_in_id = sis.stock_in_id
                JOIN raw_materials rm ON sis.raw_material_id = rm.raw_material_id
                WHERE si.stock_in_date BETWEEN :start1 AND :end1)
                UNION ALL
                (SELECT 'Stock Out' AS type, so.stock_out_date AS date, rm.raw_material_name, soi.quantity, soi.quantity * rm.cost_per_unit AS value, so.status
                FROM stock_out so
                JOIN stock_out_items soi ON so.stock_out_id = soi.stock_out_id
                JOIN raw_materials rm ON soi.raw_material_id = rm.raw_material_id
                WHERE so.stock_out_date BETWEEN :start2 AND :end2)
                UNION ALL
                (SELECT 'Spoilage' AS type, s.spoilage_date AS date, rm.raw_material_name, s.quantity_lost, s.estimated_loss_cost AS value, s.status
                FROM spoilage s
                JOIN raw_materials rm ON s.raw_material_id = rm.raw_material_id
                WHERE s.spoilage_date BETWEEN :start3 AND :end3)
                UNION ALL
                (SELECT 'Return' AS type, r.return_date AS date, rm.raw_material_name, ri.quantity, ri.quantity * ri.unit_cost AS value, r.status
                FROM returns r
                JOIN return_items ri ON r.return_id = ri.return_id
                JOIN raw_materials rm ON ri.raw_material_id = rm.raw_material_id
                WHERE r.return_date BETWEEN :start4 AND :end4)
                ORDER BY date DESC
                LIMIT :lim";

        $stmt = $this->db->prepare($sql);
        $stmt->bindValue(':start1', $startDate, PDO::PARAM_STR);
        $stmt->bindValue(':end1', $endDate, PDO::PARAM_STR);
        $stmt->bindValue(':start2', $startDate, PDO::PARAM_STR);
        $stmt->bindValue(':end2', $endDate, PDO::PARAM_STR);
        $stmt->bindValue(':start3', $startDate, PDO::PARAM_STR);
        $stmt->bindValue(':end3', $endDate, PDO::PARAM_STR);
        $stmt->bindValue(':start4', $startDate, PDO::PARAM_STR);
        $stmt->bindValue(':end4', $endDate, PDO::PARAM_STR);
        $stmt->bindValue(':lim', (int)$limit, PDO::PARAM_INT);
        $stmt->execute();
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    private function getDateFormat($groupBy) {
        switch ($groupBy) {
            case 'year':  return '%Y';
            case 'month': return '%Y-%m';
            case 'week':  return '%Y-%u';
            case 'day':
            default:      return '%Y-%m-%d';
        }
    }
}