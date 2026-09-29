<?php
/**
 * HOF Supervisor API - Get Approval Requests
 * Returns: stock_in, stock_out, spoilage, inventory adjustments, purchase plans
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';

$auth = authenticate(['Supervisor', 'Admin']);
header('Content-Type: application/json');

try {
    $type = $_GET['type'] ?? 'all';
    $results = [];

    // Stock In Requests — PENDING only (stock_in has no is_deleted column)
    if ($type === 'all' || $type === 'stock_in') {
        $stmt = $pdo->query("
            SELECT
                si.stock_in_id as request_id,
                si.total_cost,
                si.status,
                si.created_at,
                si.remarks as reason,
                CONCAT(u.first_name, ' ', u.last_name) as submitted_by,
                si.created_at as submitted_at,
                (SELECT COUNT(*) FROM stock_in_items sii WHERE sii.stock_in_id = si.stock_in_id AND sii.is_deleted = 0) as item_count
            FROM stock_in si
            JOIN users u ON si.user_id = u.user_id
            ORDER BY si.created_at DESC
            LIMIT 50
        ");
        $results['stock_in'] = $stmt->fetchAll();
    }

    // Stock Out Requests
    if ($type === 'all' || $type === 'stock_out') {
        $stmt = $pdo->query("
            SELECT
                so.stock_out_id as request_id,
                so.remarks as reason,
                so.status,
                CONCAT(u.first_name, ' ', u.last_name) as submitted_by,
                so.created_at as submitted_at
            FROM stock_out so
            JOIN users u ON so.user_id = u.user_id
            WHERE 1=1 /* stock_out has no is_deleted column */
            ORDER BY so.created_at DESC
            LIMIT 50
        ");
        $results['stock_out'] = $stmt->fetchAll();
    }

    // Spoilage Reports — spoilage has NO is_deleted column
    if ($type === 'all' || $type === 'spoilage') {
        $stmt = $pdo->query("
            SELECT
                s.spoilage_id as request_id,
                rm.raw_material_name as item_name,
                s.quantity_lost as quantity,
                s.remarks as reason,
                s.status,
                CONCAT(u.first_name, ' ', u.last_name) as submitted_by,
                s.created_at as submitted_at
            FROM spoilage s
            JOIN raw_materials rm ON s.raw_material_id = rm.raw_material_id
            JOIN users u ON s.user_id = u.user_id
            ORDER BY s.created_at DESC
            LIMIT 50
        ");
        $results['spoilage'] = $stmt->fetchAll();
    }

    // Inventory Adjustments
    if ($type === 'all' || $type === 'inv') {
        $stmt = $pdo->query("
            SELECT
                a.adjustment_id as request_id,
                rm.raw_material_name as item_name,
                a.adjustment_type,
                ai.quantity as change_amount,
                a.reason,
                a.status,
                CONCAT(u.first_name, ' ', u.last_name) as submitted_by,
                a.created_at as submitted_at
            FROM adjustments a
            JOIN adjustment_items ai ON a.adjustment_id = ai.adjustment_id
            JOIN raw_materials rm ON ai.raw_material_id = rm.raw_material_id
            JOIN users u ON a.user_id = u.user_id
            WHERE ai.is_deleted = 0 /* adjustments has no is_deleted column */
            ORDER BY a.created_at DESC
            LIMIT 50
        ");
        $results['inventory'] = $stmt->fetchAll();
    }

    // Purchase Plans — purchase_plans has NO is_deleted column
    if ($type === 'all' || $type === 'purchase_plan') {
        $stmt = $pdo->query("
            SELECT
                pp.plan_id as request_id,
                pp.total_cost as total_estimated_cost,
                pp.status,
                CONCAT(u.first_name, ' ', u.last_name) as submitted_by,
                pp.created_at as submitted_at,
                (SELECT COUNT(*) FROM purchase_plan_items ppi WHERE ppi.plan_id = pp.plan_id) as item_count
            FROM purchase_plans pp
            JOIN users u ON pp.created_by = u.user_id
            ORDER BY pp.created_at DESC
            LIMIT 50
        ");
        $results['purchase_plans'] = $stmt->fetchAll();
    }

    echo json_encode(['success' => true, 'data' => $results]);
} catch (PDOException $e) {
    error_log('get_approvals error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'error' => 'An unexpected server error occurred.']);
}