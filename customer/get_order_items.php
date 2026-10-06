<?php
require_once __DIR__ . "/../backend/db.php";
require_once __DIR__ . "/../backend/url_signer.php";

header('Content-Type: application/json');

$order_id = isset($_GET['order_id']) ? (int)$_GET['order_id'] : 0;
$ref = $_GET['ref'] ?? '';
$sig = $_GET['sig'] ?? '';

if (!$order_id) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing order_id']);
    exit;
}

// If sig is provided, validate it; otherwise allow unauthenticated access
// for backward compatibility with cart rebuild paths.
if ($sig && $ref) {
    hof_require_signed_params(['order_id' => $order_id, 'ref' => $ref, 'purpose' => 'items'], $sig, false, true);
}

try {
    $stmt = $pdo->prepare("SELECT reference_number, ordered_at, created_at, status, cooking_started_at FROM orders WHERE order_id = ?");
    $stmt->execute([$order_id]);
    $order = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$order) {
        http_response_code(404);
        echo json_encode(['success' => false, 'message' => 'Order not found']);
        exit;
    }

    if ($ref && $order['reference_number'] !== $ref) {
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Reference mismatch']);
        exit;
    }

    $stmt = $pdo->prepare("
        SELECT oi.order_item_id, oi.menu_item_id, oi.quantity, oi.price,
               oi.special_instructions, mi.item_name, mi.image_url,
               mi.estimated_prep_time_minutes,
               UNIX_TIMESTAMP(oi.created_at) AS created_epoch
        FROM order_items oi
        JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
        WHERE oi.order_id = ? AND oi.is_deleted = 0
        ORDER BY oi.order_item_id ASC
    ");
    $stmt->execute([$order_id]);
    $items = $stmt->fetchAll(PDO::FETCH_ASSOC);

    // How many minutes the kitchen has already ticked off. This walks the
    // SAME ledger the kitchen uses (orders.total_estimated_prep_time) to work
    // out which dishes are done, so the customer sees real progress.
    //
    // REQ-054 B4-C (#25): the ledger is only meaningful once the kitchen has
    // actually STARTED cooking. Before that, total_estimated_prep_time is
    // still 0/NULL, which would make `total - remaining = total` and every
    // item green-checked prematurely. So we only derive tick marks after
    // cooking_started_at is set (i.e. the kitchen pressed Start Cooking).
    $ledger = $pdo->prepare("
        SELECT COALESCE(total_estimated_prep_time, 0) AS remaining,
               (SELECT COALESCE(SUM(mi2.estimated_prep_time_minutes * oi2.quantity), 0)
                  FROM order_items oi2
                  JOIN menu_items mi2 ON oi2.menu_item_id = mi2.menu_item_id
                 WHERE oi2.order_id = orders.order_id AND oi2.is_deleted = 0) AS total
        FROM orders WHERE order_id = ?
    ");
    $ledger->execute([$order_id]);
    $ledgerRow = $ledger->fetch(PDO::FETCH_ASSOC) ?: [];
    $cookingStarted = !empty($order['cooking_started_at']);
    $orderTotal = (int)($ledgerRow['total'] ?? 0);
    $orderRemaining = (int)($ledgerRow['remaining'] ?? 0);
    // Pre-cooking orders have a NULL/0 ledger — do NOT treat that as "all done".
    $minutesDone = $cookingStarted ? max(0, $orderTotal - $orderRemaining) : 0;

    $totalPrepMinutes = 0;
    $budget = $minutesDone;
    $cartItems = [];
    foreach ($items as $item) {
        $prep = (int)($item['estimated_prep_time_minutes'] ?? 0);
        $lineMinutes = $prep * (int)$item['quantity'];
        $totalPrepMinutes += $lineMinutes;

        // Greedy reconstruction of the tick marks (same rule as the KDS).
        $isPrepared = ($lineMinutes > 0 && $budget >= $lineMinutes) ? 1 : 0;
        if ($isPrepared) {
            $budget -= $lineMinutes;
        }

        for ($i = 0; $i < $item['quantity']; $i++) {
            $cartItems[] = [
                'menu_item_id' => (int)$item['menu_item_id'],
                'order_item_id' => (int)$item['order_item_id'],
                'item_name' => $item['item_name'],
                'price' => (float)$item['price'],
                'image_url' => $item['image_url'] ?? '',
                'description' => '',
                // DB-rebuilt line: the stored text IS the authoritative snapshot.
                // Mark `configured` so the backend skips the required-group gate
                // on resume/edit (the picks already came from a real order).
                'special_instructions' => $item['special_instructions'] ?? '',
                'composed_instructions' => $item['special_instructions'] ?? '',
                'choices' => [],
                'addons' => [],
                'configured' => true,
                'created_epoch' => $item['created_epoch'] ? (int)$item['created_epoch'] : null,
                'prep_minutes' => $lineMinutes,
                'is_prepared' => $isPrepared
            ];
        }
    }

    echo json_encode([
        'success' => true,
        'items' => $cartItems,
        'ordered_at' => $order['ordered_at'] ?? null,
        'created_at' => $order['created_at'] ?? null,
        'total_prep_minutes' => $totalPrepMinutes,
        'minutes_done' => $minutesDone
    ]);
} catch (Exception $e) {
    error_log('get_order_items error: ' . $e->getMessage());
    echo json_encode(['success' => false, 'message' => 'Failed to load order items.']);
}
