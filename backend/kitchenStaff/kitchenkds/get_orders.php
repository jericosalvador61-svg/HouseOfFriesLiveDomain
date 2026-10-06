<?php
header('Content-Type: application/json');

require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/Kitchen.php';

/**
 * Get active kitchen orders
 * 
 * Response format:
 * {
 *   "status": "success",
 *   "message": "Orders retrieved",
 *   "data": [...]
 * }
 */

// Authenticate kitchen staff
$user = authenticate(['Kitchen Staff', 'Admin', 'Supervisor']);

try {
    $kitchen = new Kitchen();
    $orders = $kitchen->getActiveOrders();

    echo json_encode([
        'status' => 'success',
        'message' => 'Orders retrieved',
        'data' => $orders
    ]);
} catch (Throwable $e) {
    // REQ-065 #3: a missing live column (e.g. order_items.subtotal or
    // menu_items.image_url) used to fatal BEFORE json_encode → the KDS saw
    // "unreadable response". Always emit valid JSON so the board can show a
    // readable error instead of dying.
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'Could not load orders: ' . $e->getMessage()
    ]);
}