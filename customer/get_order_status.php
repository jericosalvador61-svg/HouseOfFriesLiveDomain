<?php
require_once __DIR__ . "/../backend/db.php";
require_once __DIR__ . "/../backend/url_signer.php";

header('Content-Type: application/json');

$order_id = isset($_GET['order_id']) ? (int)$_GET['order_id'] : 0;
$sig = $_GET['sig'] ?? '';

if (!$order_id) {
    echo json_encode(['status' => 'PENDING']);
    exit;
}

// If sig provided, validate it; otherwise allow unsigned read-only access
// for polling fallback in orderHistory.js
if ($sig) {
    hof_require_signed_params(['order_id' => $order_id, 'purpose' => 'track'], $sig, false, true);
}

try {
    // Prep-time ledger (see backend/kitchenStaff/kitchenkds/Kitchen.php):
    //   total_estimated_prep_time = MINUTES STILL TO COOK
    //   cooking_started_at        = the immutable clock anchor
    // The customer's countdown is computed in the browser from these two
    // values, so a 30s poll still gives a smooth per-second display.
    $stmt = $pdo->prepare("
        SELECT status,
               payment_status,
               payment_intent_status,
               ordered_at,
               created_at,
               UNIX_TIMESTAMP(updated_at) AS updated_epoch,
               UNIX_TIMESTAMP(cooking_started_at) AS cooking_started_epoch,
               COALESCE(total_estimated_prep_time, 0) AS prep_remaining,
               (SELECT COALESCE(SUM(mi.estimated_prep_time_minutes * oi.quantity), 0)
                  FROM order_items oi
                  JOIN menu_items mi ON oi.menu_item_id = mi.menu_item_id
                 WHERE oi.order_id = orders.order_id AND oi.is_deleted = 0) AS prep_estimate_total
        FROM orders
        WHERE order_id = ?
    ");
    $stmt->execute([$order_id]);
    $result = $stmt->fetch(PDO::FETCH_ASSOC);

    if (!$result) {
        http_response_code(404);
        echo json_encode(['status' => 'PENDING', 'not_found' => true]);
        exit;
    }

    $prepRemaining = (int)($result['prep_remaining'] ?? 0);
    $prepTotal     = (int)($result['prep_estimate_total'] ?? 0);
    $startedEpoch  = $result['cooking_started_epoch'] ? (int)$result['cooking_started_epoch'] : null;

    // The clock only runs once the kitchen has started cooking.
    $remainingSeconds = null;
    if ($startedEpoch !== null && ($result['status'] ?? '') === 'COOKING') {
        $elapsed = time() - $startedEpoch;
        $remainingSeconds = max(0, ($prepRemaining * 60) - $elapsed);
    }

    // REQ-066 US-7: fresh-device tracking needs the server-known reference so
    // signed flows (cancel / switch / pay) work on a device that never stored
    // it. Security (Cline HIGH): ONLY expose reference_number when a VALID
    // 'track' signature was presented — never on unsigned reads (otherwise an
    // attacker who sees a numeric order_id could read the ref, mint a 'cancel'
    // sig and cancel someone else's PENDING order).
    $validatedRef = null;
    if ($sig) {
        // signed — safe to include the reference
        $refStmt = $pdo->prepare("SELECT reference_number FROM orders WHERE order_id = ?");
        $refStmt->execute([$order_id]);
        $refRow = $refStmt->fetch(PDO::FETCH_ASSOC);
        $validatedRef = $refRow['reference_number'] ?? null;
    }

    echo json_encode([
        'status' => $result['status'] ?? 'PENDING',
        'paid' => (($result['payment_status'] ?? '') === 'COMPLETED'),
        'ordered_at' => $result['ordered_at'] ?? null,
        'created_at' => $result['created_at'] ?? null,
        // only when signed (Cline HIGH fix)
        'reference_number' => $validatedRef,
        'updated_epoch' => $result['updated_epoch'] ? (int)$result['updated_epoch'] : null,
        'prep_remaining' => $prepRemaining,
        'prep_estimate_total' => $prepTotal,
        'prep_started' => $startedEpoch !== null,
        'cooking_started_epoch' => $startedEpoch,
        'remaining_seconds' => $remainingSeconds
    ]);
} catch (PDOException $e) {
    error_log('get_order_status error: ' . $e->getMessage());
    echo json_encode(['status' => 'PENDING']);
}