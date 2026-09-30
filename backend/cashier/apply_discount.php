<?php
/**
 * Cashier endpoint: Apply a counter-level discount (Senior / PWD) to a PENDING order (REQ-049).
 *
 * POST body (JSON):
 *   order_id              : int
 *   discount_type_id      : int
 *   discount_id_number    : string (ID number shown by the customer)
 *   authorizer_username   : string (Admin/Supervisor username)
 *   authorizer_password   : string (Admin/Supervisor password)
 *
 * Auth: Cashier, Admin (the acting cashier). The AUTHORIZER must be an
 * Admin or Supervisor — copied from backend/cashier/void_order_items.php.
 *
 * Guard: order must exist, payment_status <> 'COMPLETED' and no discount
 * applied yet (discount_amount IS NULL).
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';

// Authenticate the cashier making the request
$auth = authenticate(['Cashier', 'Admin']);
$cashierId = $auth['user_id'];

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['order_id'], $data['discount_type_id'], $data['discount_id_number'])) {
    echo json_encode(['success' => false, 'message' => 'Missing required discount data.']);
    exit;
}

$orderId       = (int)$data['order_id'];
$discountTypeId = (int)$data['discount_type_id'];
$discountIdNumber = trim((string)$data['discount_id_number']);

// Authorization credentials
$authorizerUsername = trim($data['authorizer_username'] ?? '');
$authorizerPassword = $data['authorizer_password'] ?? '';

if (empty($authorizerUsername) || empty($authorizerPassword)) {
    echo json_encode(['success' => false, 'message' => 'Admin/Supervisor credentials required to authorize the discount.']);
    exit;
}

if ($discountIdNumber === '') {
    echo json_encode(['success' => false, 'message' => 'Please enter the customer\'s discount ID number.']);
    exit;
}
if (strlen($discountIdNumber) > 50) {
    echo json_encode(['success' => false, 'message' => 'Discount ID number is too long (max 50 characters).']);
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

    // 🔐 ROLE CHECK: Only Admin or Supervisor can authorize discounts
    $authorizerRole = strtolower(trim($authorizer['role_name']));
    if (!in_array($authorizerRole, ['admin', 'supervisor'], true)) {
        throw new Exception('Access denied. Only Admin or Supervisor can authorize discounts. Your role: ' . $authorizer['role_name']);
    }

    $authorizerId = (int)$authorizer['user_id'];

    // 2. Lock the order and read its current gross subtotal
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
        throw new Exception('This order is already paid. A discount cannot be applied after payment.');
    }

    if ($order['discount_amount'] !== null) {
        throw new Exception('A discount has already been applied to this order. Remove it first if you want to change it.');
    }

    // 3. Load the discount type
    $typeStmt = $pdo->prepare("
        SELECT name, percent
        FROM discount_types
        WHERE discount_type_id = ? AND is_active = 1
    ");
    $typeStmt->execute([$discountTypeId]);
    $type = $typeStmt->fetch(PDO::FETCH_ASSOC);

    if (!$type) {
        throw new Exception('Discount type not found or is no longer active.');
    }

    $subtotalAmount = round((float)$order['subtotal_amount'], 2);
    $discountAmount = round($subtotalAmount * (float)$type['percent'] / 100, 2);
    $totalAmount    = round($subtotalAmount - $discountAmount, 2);

    if ($discountAmount < 0) {
        throw new Exception('Discount calculation failed. Please check the discount type percentage.');
    }

    // 4. Apply the discount
    $updateStmt = $pdo->prepare("
        UPDATE orders
        SET discount_type_id = ?,
            discount_id_number = ?,
            discount_amount = ?,
            discount_approved_by = ?,
            discount_approved_at = NOW(),
            total_amount = ?,
            updated_at = NOW()
        WHERE order_id = ?
    ");
    $updateStmt->execute([
        $discountTypeId,
        $discountIdNumber,
        $discountAmount,
        $authorizerId,
        $totalAmount,
        $orderId
    ]);

    $pdo->commit();

    logActivity($pdo, $cashierId, $auth['username'], $auth['role'],
        'DISCOUNT_APPLIED',
        "Applied {$type['name']} discount (-₱{$discountAmount}) to order #{$orderId}, approved by {$authorizerUsername}",
        'order', $orderId);

    echo json_encode([
        'success' => true,
        'total_amount'    => $totalAmount,
        'discount_amount' => $discountAmount,
        'message' => "Discount of ₱{$discountAmount} applied."
    ]);

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('apply_discount error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}
