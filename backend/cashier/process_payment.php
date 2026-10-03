<?php
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../pusher_helper.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../rate_limit.php';

// Rate limit: 10 cash payment submissions per 60 seconds per IP
hof_rate_limit('process_cash_payment', 10, 60);

$auth = authenticate(['Cashier', 'Admin']);
$userId = $auth['user_id'];

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || !isset($data['order_id'], $data['cash_received'])) {
    echo json_encode(['success' => false, 'message' => 'Missing payment data.']);
    exit;
}

$orderId = (int)$data['order_id'];
$amountPaid = (float)$data['cash_received'];

// ── INPUT SANITY (P0) ──
// Rejects NaN/Infinity/negative/zero before we open a transaction.
if ($orderId < 1 || !is_finite($amountPaid) || $amountPaid <= 0) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Please enter a valid cash amount.']);
    exit;
}

/**
 * expected_total (optional) is the total the cashier SAW on screen.
 * If the customer changed the order in between, this will differ from the
 * fresh DB total and we refuse the payment with an explicit message instead
 * of silently charging the wrong amount.
 */
$hasExpectedTotal = isset($data['expected_total']) && is_numeric($data['expected_total']);
$expectedTotal = $hasExpectedTotal ? round((float)$data['expected_total'], 2) : null;

$txnRef = 'HOF-' . strtoupper(uniqid());

try {
    $pdo->beginTransaction();

    // Lock the order row so a concurrent "add item" cannot change the total
    // between our validation and our commit.
    $checkStmt = $pdo->prepare("SELECT payment_status, total_amount FROM orders WHERE order_id = ? FOR UPDATE");
    $checkStmt->execute([$orderId]);
    $orderRow = $checkStmt->fetch(PDO::FETCH_ASSOC);

    if (!$orderRow) {
        $pdo->rollBack();
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Order not found.']);
        exit;
    }

    if ($orderRow['payment_status'] === 'COMPLETED') {
        $pdo->rollBack();
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This order is already paid.']);
        exit;
    }

    $dbTotal = round((float)$orderRow['total_amount'], 2);

    // ── STALE TOTAL GUARD (P0) ─
    // The order total is always taken from the server, never from the client.
    if ($hasExpectedTotal && abs($expectedTotal - $dbTotal) > 0.009) {
        $pdo->rollBack();
        http_response_code(409);
        echo json_encode([
            'success'       => false,
            'error'         => 'TOTAL_CHANGED',
            'current_total' => $dbTotal,
            'message'       => 'The order total has changed. Current order total is ₱' . number_format($dbTotal, 2) . '. '
                             . 'Please collect ₱' . number_format($dbTotal, 2) . ' and try again.'
        ]);
        exit;
    }

    // ─ INSUFFICIENT PAYMENT GUARD (P0) ──
    // Server-side authority: the client-side check can be bypassed.
    if ($amountPaid < $dbTotal) {
        $pdo->rollBack();
        http_response_code(400);
        echo json_encode([
            'success'       => false,
            'error'         => 'INSUFFICIENT_PAYMENT',
            'current_total' => $dbTotal,
            'message'       => 'Insufficient payment. Current order total is ₱' . number_format($dbTotal, 2) . '.'
        ]);
        exit;
    }

    // change can never be negative at this point (guarded above); max(0) is
    // pure defence-in-depth so a receipt can never print a negative change.
    $changeGiven = round(max(0, $amountPaid - $dbTotal), 2);

    $updateOrder = $pdo->prepare("
        UPDATE orders 
        SET status = 'IN-PROGRESS', 
            user_id = ?, 
            payment_status = 'COMPLETED',
            payment_intent_status = 'paid_cash',
            updated_at = NOW() 
        WHERE order_id = ? AND payment_status <> 'COMPLETED'
    ");
    $updateOrder->execute([$userId, $orderId]);

    if ($updateOrder->rowCount() === 0) {
        $pdo->rollBack();
        http_response_code(409);
        echo json_encode(['success' => false, 'message' => 'This order is already paid.']);
        exit;
    }

    $insertPayment = $pdo->prepare("
        INSERT INTO payments (
            order_id, 
            user_id, 
            amount_paid, 
            payment_method, 
            payment_status, 
            paid_at, 
            transaction_reference, 
            change_given, 
            created_at, 
            updated_at
        ) VALUES (?, ?, ?, 'CASH', 'COMPLETED', NOW(), ?, ?, NOW(), NOW())
    ");

    $insertPayment->execute([
        $orderId,
        $userId,
        $amountPaid,
        $txnRef,
        $changeGiven
    ]);

    $pdo->commit();

    if (function_exists('broadcastOrderUpdate')) {
        broadcastOrderUpdate($orderId, 'IN-PROGRESS', 'IN-PROGRESS');
    }

    logActivity($pdo, $userId, $auth['username'], $auth['role'],
        'PAYMENT_COMPLETED', "Cash: ₱{$amountPaid} paid, ₱{$changeGiven} change",
        'order', $orderId, (string)$txnRef, 'COMPLETED');

    echo json_encode([
        'success'       => true,
        'message'       => 'Payment processed successfully',
        'reference'     => $txnRef,
        'current_total' => $dbTotal,
        'amount_paid'   => $amountPaid,
        'change'        => $changeGiven
    ]);
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('process_payment error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}