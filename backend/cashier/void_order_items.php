<?php
/**
 * Cashier API: Void order items with Supervisor/Admin authorization
 * 
 * The cashier selects items to void, then an Admin or Supervisor must
 * provide their credentials to authorize it. This backend checks that
 * the authorizer has role 'Admin' or 'Supervisor' — not just any valid password.
 * 
 * POST body:
 *   order_id          : int
 *   order_item_ids    : int[] (array of order_item_id to void)
 *   reason            : string
 *   authorizer_username : string (Admin/Supervisor username)
 *   authorizer_password : string (Admin/Supervisor password)
 *   token             : string (cashier's JWT)
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../log_activity_helper.php';

// Authenticate the cashier making the request
$auth = authenticate(['Cashier', 'Admin', 'Supervisor']);
$cashierId = $auth['user_id'];

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['order_id'], $data['order_item_ids'])) {
    echo json_encode(['success' => false, 'message' => 'Missing required void data.']);
    exit;
}

$orderId = (int)$data['order_id'];
$itemIds = $data['order_item_ids']; // Array of order_item_id
$reason = $data['reason'] ?? 'No reason provided';

// Authorization credentials
$authorizerUsername = trim($data['authorizer_username'] ?? '');
$authorizerPassword = $data['authorizer_password'] ?? '';

if (empty($authorizerUsername) || empty($authorizerPassword)) {
    echo json_encode(['success' => false, 'message' => 'Admin/Supervisor credentials required to authorize void.']);
    exit;
}

if (!is_array($itemIds) || count($itemIds) === 0) {
    echo json_encode(['success' => false, 'message' => 'No items selected to void.']);
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

    // 🔐 ROLE CHECK: Only Admin or Supervisor can authorize voids
    $authorizerRole = strtolower(trim($authorizer['role_name']));
    if (!in_array($authorizerRole, ['admin', 'supervisor'], true)) {
        throw new Exception('Access denied. Only Admin or Supervisor can authorize voids. Your role: ' . $authorizer['role_name']);
    }

    $authorizerId = $authorizer['user_id'];

    // 2. Insert into `voids` table
    $insertVoid = $pdo->prepare("
        INSERT INTO voids (order_id, requested_by, approved_by, approved_at, status, reason, created_at, updated_at)
        VALUES (?, ?, ?, NOW(), 'APPROVED', ?, NOW(), NOW())
    ");
    $insertVoid->execute([$orderId, $cashierId, $authorizerId, $reason]);
    $voidId = $pdo->lastInsertId();

    // 3. Get quantities of the items being voided
    $placeholders = implode(',', array_fill(0, count($itemIds), '?'));
    $stmtGetItems = $pdo->prepare("
        SELECT order_item_id, quantity, price 
        FROM order_items 
        WHERE order_id = ? AND order_item_id IN ($placeholders) AND is_deleted = 0
    ");
    $stmtGetItems->execute(array_merge([$orderId], $itemIds));
    $orderItemsToVoid = $stmtGetItems->fetchAll(PDO::FETCH_ASSOC);

    if (empty($orderItemsToVoid)) {
        throw new Exception('No valid order items found to void (they may already be voided).');
    }

    // 4. Insert into `void_items` and update `order_items` (set is_deleted = 1)
    $insertVoidItem = $pdo->prepare("
        INSERT INTO void_items (void_id, order_item_id, quantity, is_deleted, created_at, updated_at)
        VALUES (?, ?, ?, 0, NOW(), NOW())
    ");

    $updateOrderItem = $pdo->prepare("
        UPDATE order_items 
        SET is_deleted = 1, 
            updated_at = NOW() 
        WHERE order_item_id = ?
    ");

    foreach ($orderItemsToVoid as $item) {
        $insertVoidItem->execute([$voidId, $item['order_item_id'], $item['quantity']]);
        $updateOrderItem->execute([$item['order_item_id']]);
    }

    // 5. Recalculate order total
    $updateOrder = $pdo->prepare("
        UPDATE orders 
        SET total_amount = (
            SELECT COALESCE(SUM(price * quantity), 0) 
            FROM order_items 
            WHERE order_id = ? AND is_deleted = 0
        ),
        updated_at = NOW()
        WHERE order_id = ?
    ");
    $updateOrder->execute([$orderId, $orderId]);

    $pdo->commit();
$itemCount = count($orderItemsToVoid);

    logActivity($pdo, $cashierId, $auth['username'], $auth['role'],
        'VOID_ORDER', "Voided {$itemCount} item(s) from order #{$orderId}",
        'order', $orderId);

    echo json_encode([
        'success' => true,
        'message' => "{$itemCount} item(s) successfully voided and logged.",
        'void_id' => $voidId
    ]);

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('void_order_items error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}