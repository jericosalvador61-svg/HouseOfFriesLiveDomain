<?php
header("Content-Type: application/json; charset=utf-8");

ini_set('display_errors', 0);
error_reporting(E_ALL);

try {
    require_once __DIR__ . "/../backend/db.php";
    require_once __DIR__ . "/../backend/rate_limit.php";
    require_once __DIR__ . "/../backend/log_activity_helper.php";
    require_once __DIR__ . "/../backend/url_signer.php";

    hof_rate_limit('cancel_order', 10, 60);

    $input = json_decode(file_get_contents("php://input"), true);
    $order_id = isset($input['order_id']) ? (int)$input['order_id'] : 0;
    $ref = $input['ref'] ?? '';
    $sig = $input['sig'] ?? '';

    if (!$order_id || empty($ref) || empty($sig)) {
        echo json_encode(["success" => false, "message" => "Missing required parameters."]);
        exit;
    }

    hof_require_signed_params(['order_id' => $order_id, 'ref' => $ref, 'purpose' => 'cancel'], $sig, false, true);

    $pdo->beginTransaction();

    $stmt = $pdo->prepare("SELECT order_id, status, order_type, table_id, reference_number FROM orders WHERE order_id = ?");
    $stmt->execute([$order_id]);
    $order = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$order) {
        $pdo->rollBack();
        echo json_encode(["success" => false, "message" => "Order not found."]);
        exit;
    }

    if ($order['reference_number'] !== $ref) {
        $pdo->rollBack();
        echo json_encode(["success" => false, "message" => "Reference mismatch."]);
        exit;
    }

    if ($order['status'] === 'COMPLETED' || $order['status'] === 'CANCELLED') {
        $pdo->rollBack();
        echo json_encode(["success" => false, "message" => "This order can no longer be cancelled."]);
        exit;
    }

    if (in_array($order['status'], ['IN-PROGRESS', 'COOKING', 'SERVED'], true)) {
        $pdo->rollBack();
        echo json_encode(["success" => false, "message" => "Order is already in progress and cannot be cancelled. Please see the cashier."]);
        exit;
    }

    $updateOrder = $pdo->prepare("UPDATE orders SET status = 'CANCELLED' WHERE order_id = ?");
    $updateOrder->execute([$order_id]);

    if (!empty($order['table_id']) && $order['order_type'] === 'DINE_IN') {
        $updateTable = $pdo->prepare("UPDATE restaurant_table SET status = 'AVAILABLE' WHERE table_id = ?");
        $updateTable->execute([$order['table_id']]);
    }

    $pdo->commit();

    logActivity($pdo, null, 'GUEST', 'Customer', 'ORDER_CANCELLED', "Customer cancelled order #{$ref}", 'order', $order_id, $ref);

    require_once __DIR__ . '/../backend/pusher_helper.php';
    broadcastOrderUpdate($order_id, 'Order Cancelled: ' . $ref);

    echo json_encode(["success" => true, "message" => "Order successfully cancelled and table status updated."]);

} catch (Throwable $e) {
    if (isset($pdo) && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('cancel_order error: ' . $e->getMessage());
    echo json_encode(["success" => false, "message" => "Server Error."]);
}