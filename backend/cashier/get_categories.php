<?php
require_once __DIR__ . '/../db.php';
header('Content-Type: application/json');

try {
    $stmt = $pdo->query("SELECT category_id, category_name FROM menu_categories");
    echo json_encode(['success' => true, 'categories' => $stmt->fetchAll(PDO::FETCH_ASSOC)]);
} catch (PDOException $e) {
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
