<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../../db.php";

try {
    $stmt = $pdo->query("SELECT supplier_id, supplier_name FROM suppliers WHERE status = 'Active' ORDER BY supplier_name ASC");
    $suppliers = $stmt->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode($suppliers);
} catch (Exception $e) {
    echo json_encode([]);
}
