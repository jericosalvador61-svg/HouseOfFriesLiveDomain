<?php
/**
 * Cashier endpoint: Remove a counter-level discount from a PENDING order (REQ-049).
 *
 * POST body (JSON):
 *   order_id              : int
 *   authorizer_username   : string (Admin/Supervisor username)
 *   authorizer_password   : string (Admin/Supervisor password)
 *
 * Auth: Cashier, Admin (the acting cashier). The AUTHORIZER must be an
 * Admin or Supervisor — copied from backend/cashier/void_order_items.php.
 *
 * Guard: order must exist and payment_status <> 'COMPLETED'.
 * Clears the discount columns and restores total_amount = subtotal_amount.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../pusher_helper.php'; // REQ-054 B4-C

// Authenticate the cashier making the request
$auth = authenticate(['Cashier', 'Admin']);
$cashierId = $auth['user_id'];

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['order_id'])) {
    echo json_encode(['success' => false, 'message' => 'Missing required data.']);
    exit;
}

$orderId = (int)$data['order_id'];

// Authorization credentials
$authorizerUsername = trim($data['authorizer_username'] ?? '');
$authorizerPassword = $data['authorizer_password'] ?? '';

if (empty($authorizerUsername) || empty($authorizerPassword)) {
    echo json_encode(['success' => false, 'message' => 'Admin/Supervisor credentials required to authorize removing the discount.']);
    exit;
}

try {
    $pdo->beginTransaction();

    // 1. Verify authorizer credentials AND check they are Admin or Supervisor
    $stmt = $pdo->prepare("
        SELECT u.user_id, u.password, r.role_name 
        FROM users u
        JOIN roles r ON u.role_id = r.role_id
        WHERE u.username = ?
    ");
    $stmt->execute([$authorizerUsername]);
    $authorizer = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$authorizer) {
        throw new Exception('Invalid credentials. User not found.');
    }

    if (!password_verify($authorizerPassword, $authorizer['password'])) {
        throw new Exception('Invalid credentials. Wrong password.');
    }

    // 🔐 ROLE CHECK: Only Admin or Supervisor can authorize removing a discount
    $authorizerRole = strtolower(trim($authorizer['role_name']));
    if (!in_array($authorizerRole, ['admin', 'supervisor'], true)) {
        throw new Exception('Access denied. Only Admin or Supervisor can authorize removing a discount. Your role: ' . $authorizer['role_name']);
    }

    $authorizerId = (int)$authorizer['user_id'];

    // 2. Lock the order and read its current state
    $orderStmt = $pdo->prepare("
        SELECT subtotal_amount, total_amount, payment_status, discount_amount
        FROM orders
        WHERE order_id = ?
        FOR UPDATE
    ");
    $orderStmt->execute([$orderId]);
    $order = $orderStmt->fetch(PDO::FETCH_ASSOC);

    if (!$order) {
        throw new Exception('Order not found.');
    }

    if (strtoupper(trim((string)$order['payment_status'])) === 'COMPLETED') {
        throw new Exception('This order is already paid. A discount cannot be removed after payment.');
    }

    if ($order['discount_amount'] === null) {
        throw new Exception('This order has no discount to remove.');
    }

    $subtotalAmount = round((float)$order['subtotal_amount'], 2);

    // 3. Clear the discount and restore the net total to the gross subtotal
    $updateStmt = $pdo->prepare("
        UPDATE orders
        SET discount_type_id = NULL,
            discount_id_number = NULL,
            discount_amount = NULL,
            discount_approved_by = NULL,
            discount_approved_at = NULL,
            total_amount = ?,
            updated_at = NOW()
        WHERE order_id = ?
    ");
    $updateStmt->execute([$subtotalAmount, $orderId]);

    $pdo->commit();

    logActivity($pdo, $cashierId, $auth['username'], $auth['role'],
        'DISCOUNT_REMOVED',
        "Removed discount from order #{$orderId}, approved by {$authorizerUsername}",
        'order', $orderId);

    // REQ-054 B4-C: the total changed — nudge the customer tracker.
    if (function_exists('broadcastOrderUpdate')) {
        broadcastOrderUpdate($orderId, "Discount removed from order", null);
    }

    echo json_encode([
        'success' => true,
        'total_amount' => $subtotalAmount,
        'message' => 'Discount removed.'
    ]);

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('remove_discount error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
