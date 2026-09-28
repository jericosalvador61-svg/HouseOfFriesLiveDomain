<?php
/**
 * ============================================================
 * backend/kitchenStaff/kitchenkds/check_all.php
 * ------------------------------------------------------------
 * "Check All" on an order card: the kitchen declares every item done,
 * so the remaining prep time goes straight to 0 and the countdown ends.
 *
 * Implemented as a single atomic UPDATE rather than a loop of toggles,
 * so the timer snaps to 0:00 in one round trip (no flicker, and no
 * chance of a partial update if the connection drops mid-way).
 *
 * Request : { order_id }
 * Response: { status, message, data:{ prep_remaining } }
 * ============================================================
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../rate_limit.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../pusher_helper.php';
require_once __DIR__ . '/Kitchen.php';

$auth = authenticate(['Kitchen Staff', 'Admin', 'Supervisor']);

hof_rate_limit('kitchen_check_all', 60, 60);

$input   = json_decode(file_get_contents('php://input'), true);
$orderId = (int)($input['order_id'] ?? 0);

if (!$orderId) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Missing order_id.']);
    exit;
}

try {
    $kitchen = new Kitchen();
    $result  = $kitchen->checkAllItems($orderId);

    if ($result['success']) {
        logActivity(
            $pdo,
            (int)$auth['user_id'],
            $auth['username'] ?? '',
            $auth['role'] ?? '',
            'KITCHEN_CHECK_ALL',
            "Check All pressed on order #$orderId - remaining time zeroed",
            'order',
            $orderId
        );

        broadcastOrderUpdate($orderId, 'All items checked - ready to plate', 'COOKING');
    }

    http_response_code($result['success'] ? 200 : 400);
    echo json_encode([
        'status'  => $result['success'] ? 'success' : 'error',
        'message' => $result['message'],
        'data'    => $result['success'] ? [
            'order_id'       => $orderId,
            'prep_remaining' => 0,
        ] : null,
    ]);
} catch (PDOException $e) {
    error_log('check_all error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Could not check all items.']);
}
