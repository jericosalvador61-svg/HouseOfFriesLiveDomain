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

$kitchen = new Kitchen();
$orders = $kitchen->getActiveOrders();

echo json_encode([
    'status' => 'success',
    'message' => 'Orders retrieved',
    'data' => $orders
]);