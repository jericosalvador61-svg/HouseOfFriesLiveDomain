<?php
/**
 * ============================================================
 * backend/kitchenStaff/kitchenkds/toggle_item.php
 * ------------------------------------------------------------
 * Tick / untick ONE menu item on an order.
 *
 * This is what drives the live countdown: ticking an item deducts that
 * item's prep minutes from the order's remaining-time ledger, so the
 * timer visibly jumps down.
 *
 * The minutes are ALWAYS read from the `menu_items` row on the server
 * (via Kitchen::setItemPrepared). A crafted `minutes` value in the
 * request body is ignored entirely, so nobody can shorten a timer.
 *
 * Request : { order_id, order_item_id, prepared: true|false }
 * Response: { status, message, data:{ minutes, prep_remaining } }
 * ============================================================
 */

header('Content-Type: application/json');

require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../rate_limit.php';
require_once __DIR__ . '/../../log_activity_helper.php';
require_once __DIR__ . '/../../pusher_helper.php';
require_once __DIR__ . '/Kitchen.php';

// Authenticate BEFORE rate limiting so an anonymous caller cannot burn quota.
$auth = authenticate(['Kitchen Staff', 'Admin', 'Supervisor']);

hof_rate_limit('kitchen_toggle_item', 120, 60);

$input  = json_decode(file_get_contents('php://input'), true);
$orderId     = (int)($input['order_id'] ?? 0);
$orderItemId = (int)($input['order_item_id'] ?? 0);
$prepared    = !empty($input['prepared']);

if (!$orderId || !$orderItemId) {
    http_response_code(400);
    echo json_encode(['status' => 'error', 'message' => 'Missing order_id or order_item_id.']);
    exit;
}

try {
    $kitchen = new Kitchen();
    $result  = $kitchen->setItemPrepared($orderId, $orderItemId, $prepared);

    if ($result['success']) {
        logActivity(
            $pdo,
            (int)$auth['user_id'],
            $auth['username'] ?? '',
            $auth['role'] ?? '',
            'KITCHEN_ITEM_PREPARED',
            ($prepared ? 'Item ticked' : 'Item unticked') . " on order #$orderId (-" . (int)($result['minutes'] ?? 0) . " min)",
            'order',
            $orderId
        );

        // Nudge every other screen (other cooks, the customer tracker).
        broadcastOrderUpdate($orderId, 'Item updated - ' . (int)($result['prep_remaining'] ?? 0) . ' min left', 'COOKING');
    }

    http_response_code($result['success'] ? 200 : 400);
    echo json_encode([
        'status'  => $result['success'] ? 'success' : 'error',
        'message' => $result['message'],
        'data'    => $result['success'] ? [
            'order_id'       => $orderId,
            'order_item_id'  => $orderItemId,
            'prepared'       => $prepared,
            'minutes'        => (int)($result['minutes'] ?? 0),
            'refunded'       => (bool)($result['refunded'] ?? false),
            'locked'         => (bool)($result['locked'] ?? false),
            'prep_remaining' => (int)($result['prep_remaining'] ?? 0),
        ] : null,
    ]);
} catch (PDOException $e) {
    error_log('toggle_item error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['status' => 'error', 'message' => 'Could not update that item.']);
}
