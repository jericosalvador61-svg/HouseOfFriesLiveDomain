<?php
/**
 * Check Order Status - For Customer Timer
 * 
 * Returns order status and remaining time for countdown timer
 * 
 * @author Jerico (BSIT Capstone)
 * @version 1.0
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../db.php';

// Get order_id from request
$order_id = isset($_GET['order_id']) ? (int)$_GET['order_id'] : 0;

if (!$order_id) {
    echo json_encode([
        'success' => false,
        'message' => 'Missing order_id parameter'
    ]);
    exit;
}

try {
    // Get order details
    $stmt = $pdo->prepare("
        SELECT 
            order_id,
            reference_number,
            status,
            payment_status,
            payment_intent_status,
            ordered_at
        FROM orders 
        WHERE order_id = ?
    ");
    $stmt->execute([$order_id]);
    $order = $stmt->fetch(PDO::FETCH_ASSOC);
    
    if (!$order) {
        echo json_encode([
            'success' => false,
            'message' => 'Order not found'
        ]);
        exit;
    }
    
    // Check if order is still pending (needs payment)
    $isPending = ($order['status'] === 'PENDING');
    
    // Calculate time remaining (15 minutes from ordered_at)
    $orderTime = strtotime($order['ordered_at']);
    $expiryTime = $orderTime + (15 * 60); // 15 minutes
    $currentTime = time();
    $remaining = max(0, $expiryTime - $currentTime);
    
    // If order is not pending, it's either paid or expired
    if (!$isPending) {
        $remaining = 0;
    }
    
    // Return order status
    echo json_encode([
        'success' => true,
        'order_id' => $order['order_id'],
        'reference_number' => $order['reference_number'],
        'status' => $order['status'],
        'payment_status' => $order['payment_status'],
        'payment_intent_status' => $order['payment_intent_status'],
        'is_pending' => $isPending,
        'remaining_seconds' => $remaining,
        'expires_at' => date('Y-m-d H:i:s', $expiryTime)
    ]);
    
} catch (Exception $e) {
    echo json_encode([
        'success' => false,
        'message' => 'Error checking order status'
    ]);
}
?>
