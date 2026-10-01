<?php
/**
 * backend/admin/customer_manage/list_customers.php
 * REQ-052 Batch 3 — Staff searchable customer list (Admin + Supervisor).
 *
 * Returns customer rows + order counts for the manage_customers page.
 * Supports optional ?search= filter on name / phone_number.
 */
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
header('Content-Type: application/json');

$auth = authenticate(['Admin', 'Supervisor']);

try {
    $search = trim($_GET['search'] ?? '');

    $where = '';
    $params = [];
    if ($search !== '') {
        // Escape LIKE metacharacters (mirror backend/waiter/get_order_history.php)
        $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $search);
        $where = 'WHERE c.phone_number LIKE :search OR c.name LIKE :search';
        $params[':search'] = '%' . $escaped . '%';
    }

    $stmt = $pdo->prepare("
        SELECT
            c.customer_id,
            c.phone_number,
            c.name,
            c.is_active,
            c.last_login_at,
            c.created_at,
            (
                SELECT COUNT(*)
                FROM orders o
                WHERE o.customer_account_id = c.customer_id
            ) AS orders_count,
            (
                SELECT COUNT(*)
                FROM orders o
                WHERE o.customer_account_id = c.customer_id
                  AND o.payment_status = 'COMPLETED'
            ) AS paid_orders_count
        FROM customers c
        $where
        ORDER BY c.created_at DESC
    ");
    $stmt->execute($params);
    $customers = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode(['success' => true, 'customers' => $customers]);
} catch (Throwable $e) {
    error_log('list_customers error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load customers.']);
}