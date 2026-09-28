<?php
header('Content-Type: application/json');

require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/Kitchen.php';
require_once __DIR__ . '/../../pusher_helper.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../notifications/notification_helper.php';

/**
 * Update order status
 * 
 * Request:
 * {
 *   "order_id": 123,
 *   "status": "COOKING"  // or "COMPLETED", "CANCELLED"
 * }
 * 
 * Response format:
 * {
 *   "status": "success",
 *   "message": "Order status updated",
 *   "data": { "order_id": 123, "new_status": "COOKING" }
 * }
 */

// Authenticate kitchen staff
$user = authenticate(['Kitchen Staff', 'Admin', 'Supervisor']);

$input = json_decode(file_get_contents('php://input'), true);
$orderId = $input['order_id'] ?? null;
$newStatus = $input['status'] ?? null;

if (!$orderId || !$newStatus) {
    echo json_encode([
        'status' => 'error',
        'message' => 'Missing order_id or status'
    ]);
    exit;
}

// Validate status
$validStatuses = ['COOKING', 'COMPLETED', 'CANCELLED'];
if (!in_array($newStatus, $validStatuses, true)) {
    echo json_encode([
        'status' => 'error',
        'message' => 'Invalid status. Must be: COOKING, COMPLETED, or CANCELLED'
    ]);
    exit;
}

$kitchen = new Kitchen();
$result = $kitchen->updateStatus($orderId, $newStatus);

// Broadcast to Pusher for real-time updates
if ($result['success']) {
    broadcastOrderUpdate($orderId, $newStatus, $newStatus);

    // Role-based DB notifications for status transitions
    try {
        $refStmt = $pdo->prepare("SELECT reference_number, table_id FROM orders WHERE order_id = ?");
        $refStmt->execute([$orderId]);
        $orderRow = $refStmt->fetch(PDO::FETCH_ASSOC);
        $orderRef = ($orderRow && $orderRow['reference_number']) ? $orderRow['reference_number'] : ('#' . $orderId);

        if ($newStatus === 'COMPLETED') {
            // Food is done - Waiter must serve it to the table
            hof_notify_roles($pdo, 'order_ready', 'Order Ready to Serve',
                "Order $orderRef is prepared and ready to be served"
                    . (($orderRow && $orderRow['table_id']) ? ' (Table ' . $orderRow['table_id'] . ')' : '') . '.',
                ['Waiter'], '/public/waiter/orders.html');
        } elseif ($newStatus === 'CANCELLED') {
            hof_notify_roles($pdo, 'order_cancelled', 'Order Cancelled',
                "Order $orderRef was cancelled by the kitchen.",
                ['Cashier', 'Supervisor'], '/public/cashier/cashier_dashboard.html');
        }
    } catch (Exception $e) { /* notifications must never break the flow */ }
}

echo json_encode([
    'status' => $result['success'] ? 'success' : 'error',
    'message' => $result['message'],
    'data' => $result['success'] ? ['order_id' => $orderId, 'new_status' => $newStatus] : null
]);