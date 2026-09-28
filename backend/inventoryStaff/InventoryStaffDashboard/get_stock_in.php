<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../../db.php";

try {
    $stmt = $pdo->query("
        SELECT si.stock_in_id, s.supplier_name, si.total_cost,
               u.username, si.stock_in_date, si.status
        FROM stock_in si
        JOIN suppliers s ON si.supplier_id = s.supplier_id
        JOIN users u ON si.user_id = u.user_id
        ORDER BY si.stock_in_id DESC
    ");

    $data = $stmt->fetchAll(PDO::FETCH_ASSOC);

    $data = array_map(function ($row) {
        $row['stock_in_date'] = date('Y-m-d', strtotime($row['stock_in_date']));
        $row['status'] = ucfirst(strtolower($row['status']));
        return $row;
    }, $data);

    echo json_encode($data);
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'message' => 'Failed to fetch stock in records: ' . $e->getMessage()
    ]);
}