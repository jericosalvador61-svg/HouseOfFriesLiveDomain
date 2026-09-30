<?php
header('Content-Type: application/json');
require_once __DIR__ . "/../backend/db.php";
require_once __DIR__ . "/../backend/pusher_helper.php";
require_once __DIR__ . "/../backend/geofence_config.php"; // US-SYS-013 geofence
require_once __DIR__ . "/../backend/rate_limit.php";
require_once __DIR__ . "/../backend/choices_addons_helper.php"; // REQ-040
require_once __DIR__ . "/../backend/log_activity_helper.php"; // REQ-050

// Load dynamic location from DB for geofence gate
$storeLoc = hof_get_store_location_from_db($pdo);

// Rate limit: 10 order placements per 60 seconds per IP
hof_rate_limit('place_order', 10, 60);

$data = json_decode(file_get_contents('php://input'), true);

if (!$data || empty($data['cart'])) {
    echo json_encode(['success' => false, 'message' => 'Empty cart data received.']);
    exit;
}

/* ============================================================
   GEOFENCE RE-VALIDATION (US-SYS-013 — Advisor Feature #7)
   The customer page already gated the menu behind a location
   check, but coordinates can be spoofed by replaying requests.
   So we re-validate HERE, server-side, before any INSERT.
   Uses hof_geofence_gate() so HOF_GEOFENCE_MODE is respected
   (ENFORCED / LOG_ONLY / OFF).
   ============================================================ */
$geo = $data['geofence'] ?? [];
$geoLat  = $geo['lat']      ?? null;
$geoLng  = $geo['lng']      ?? null;
$geoAcc  = $geo['accuracy'] ?? 0;

$gate = hof_geofence_gate($geoLat, $geoLng, $geoAcc, $storeLoc['lat'], $storeLoc['lng'], $storeLoc['radius_m'], $storeLoc['enabled']);

if ($gate['enforced'] && !$gate['allowed']) {
    http_response_code(403);

    // Customer-safe wording (no stack traces, no internal codes leaked as the title)
    switch ($gate['reason']) {
        case 'MISSING_COORDS':
            $geoMessage = "We couldn't verify your location.\n\nPlease allow location access, make sure your device GPS is enabled, and stay near the restaurant. Then try again.";
            break;
        case 'UNRELIABLE_GPS':
            $geoMessage = "Your location is not accurate enough yet.\n\nPlease move to an area with a clearer GPS signal (near a window or outside) and try again.";
            break;
        case 'OUT_OF_RANGE':
            $geoMessage = "You appear to be outside House of Fries.\n\nOrders are only accepted while you are inside the restaurant. Please move closer and try again.";
            break;
        default:
            $geoMessage = "We couldn't verify your location right now.\n\nPlease check your internet connection and try again.";
    }

    echo json_encode([
        'success' => false,
        'blocked' => 'GEOFENCE',
        'reason'  => $gate['reason'],
        'distance_m' => $gate['distance_m'] ?? null,
        'radius_m'   => $storeLoc['radius_m'] ?? null,
        'message' => $geoMessage
    ]);
    exit;
}
/* ============ end geofence re-validation ============ */

/* ============================================================
   SERVER-SIDE PRE-FLIGHT VALIDATION
   The backend is the final authority. Every rule below is ALSO
   enforced in the UI, but the UI can be bypassed — so it is
   re-checked here before anything is written.
   ============================================================ */

// ── 1. PAYMENT METHOD (must be explicitly chosen) ──
// Cash must never be assumed. The frontend radio starts UNSELECTED.
$rawMethod = isset($data['payment_method']) ? strtoupper(trim((string)$data['payment_method'])) : '';
if ($rawMethod === '' || $rawMethod === 'NULL') {
    http_response_code(400);
    echo json_encode([
        'success'        => false,
        'blocked'        => 'PAYMENT_METHOD',
        'message'        => 'Unable to submit the order because the payment method has not been selected. Please choose Cash or GCash first.',
        'field'          => 'payment_method'
    ]);
    exit;
}
if (!in_array($rawMethod, ['CASH', 'GCASH'], true)) {
    http_response_code(400);
    echo json_encode([
        'success'        => false,
        'blocked'        => 'PAYMENT_METHOD',
        'message'        => 'Unsupported payment method. Please choose Cash or GCash.',
        'field'          => 'payment_method'
    ]);
    exit;
}
$payment_method = $rawMethod;

// ── 2. ORDER TYPE + TAKEOUT CUSTOMER NAME ─
$preOrderType = 'DINE_IN';
if (isset($data['order_type']) && trim((string)$data['order_type']) !== '') {
    $cleanType = strtoupper(trim((string)$data['order_type']));
    if ($cleanType === 'TAKE OUT' || $cleanType === 'TAKE_OUT' || $cleanType === 'TAKEOUT') {
        $preOrderType = 'TAKE_OUT';
    }
} elseif (empty($data['table_id'])) {
    $preOrderType = 'TAKE_OUT';
}
$preCustomerName = isset($data['customer_name']) ? trim((string)$data['customer_name']) : '';
if ($preOrderType === 'TAKE_OUT' && $preCustomerName === '') {
    http_response_code(400);
    echo json_encode([
        'success' => false,
        'blocked' => 'CUSTOMER_NAME',
        'message' => 'Please enter customer name for takeout orders.',
        'field'   => 'customer_name'
    ]);
    exit;
}

// ── 3. TABLE VALIDATION (deleted / maintenance / stale QR) ──
// A QR that points at a soft-deleted table must NEVER create an order,
// even if the customer's device still holds a stale cached session.
$preTableId = (!empty($data['table_id']) && trim((string)$data['table_id']) !== '')
    ? (int)$data['table_id']
    : null;

if ($preTableId) {
    $tblStmt = $pdo->prepare("SELECT table_id, table_number, table_type, status, is_deleted FROM restaurant_table WHERE table_id = ? LIMIT 1");
    $tblStmt->execute([$preTableId]);
    $tblRow = $tblStmt->fetch(PDO::FETCH_ASSOC);

    if (!$tblRow || (int)$tblRow['is_deleted'] === 1) {
        http_response_code(410);
        echo json_encode([
            'success' => false,
            'blocked' => 'TABLE_DELETED',
            'message' => 'This QR code is invalid or has been removed. Please ask restaurant staff for assistance.'
        ]);
        exit;
    }

    $tblStatus = strtoupper(trim((string)$tblRow['status']));
    if ($tblStatus === 'MAINTENANCE') {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'blocked' => 'TABLE_MAINTENANCE',
            'message' => 'This table is currently under maintenance and cannot accept orders. Please choose another table or ask restaurant staff for assistance.'
        ]);
        exit;
    }

    // A TAKEOUT station row may never be used to place a dine-in order.
    if (strtoupper((string)$tblRow['table_type']) === 'TAKEOUT' && $preOrderType === 'DINE_IN') {
        $preOrderType = 'TAKE_OUT';
        if ($preCustomerName === '') {
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'blocked' => 'CUSTOMER_NAME',
                'message' => 'Please enter customer name for takeout orders.',
                'field'   => 'customer_name'
            ]);
            exit;
        }
    }
}
/* ============ end pre-flight validation ============ */

try {
    $maxRetries = 3;
    $orderSuccess = false;
    for ($attempt = 1; $attempt <= $maxRetries; $attempt++) {
        $pdo->beginTransaction();

        // ── RACE-SAFE DUPLICATE DINE-IN GUARD (REQ-014, F2) ──
        $table_id = (!empty($data['table_id']) && trim($data['table_id']) !== '') ? (int)$data['table_id'] : null;
        if ($table_id) {
            $dupStmt = $pdo->prepare("SELECT order_id, reference_number FROM orders WHERE table_id = ? AND status = 'PENDING' AND payment_status != 'COMPLETED' LIMIT 1 FOR UPDATE");
            $dupStmt->execute([$table_id]);
            $dupOrder = $dupStmt->fetch(PDO::FETCH_ASSOC);
            if ($dupOrder) {
                $pdo->rollBack();
                echo json_encode([
                    'success' => false,
                    'duplicate' => true,
                    'order_id' => (int)$dupOrder['order_id'],
                    'reference_number' => $dupOrder['reference_number'],
                    'message' => 'You already have an unpaid order for this table. Continuing it instead.'
                ]);
                exit;
            }
        }

        // 1. Generate Reference Number (REQ-034: sequential COUNT+1, consistent pattern)
        $year = date("Y");
        $stmtCount = $pdo->prepare("SELECT COUNT(*) FROM orders WHERE YEAR(created_at) = ?");
        $stmtCount->execute([$year]);
        $count = $stmtCount->fetchColumn() + 1;
        $reference_number = "HOF" . $year . str_pad($count, 5, '0', STR_PAD_LEFT);

    $user_id  = (!empty($data['user_id']))  ? (int)$data['user_id']  : null;
    $customer_name = (!empty($data['customer_name'])) ? trim($data['customer_name']) : null;

    // ─── CRITICAL FIX: SANITIZE & VALIDATE ORDER TYPE ───
    $order_type = 'DINE_IN'; // Default fallback

    // Check if the frontend sent a non-empty string
    if (isset($data['order_type']) && trim($data['order_type']) !== '') {
        $clean_type = strtoupper(trim($data['order_type']));
        if ($clean_type === 'DINE IN' || $clean_type === 'DINE_IN') {
            $order_type = 'DINE_IN';
        } elseif ($clean_type === 'TAKE OUT' || $clean_type === 'TAKE_OUT') {
            $order_type = 'TAKE_OUT';
        }
    } else {
        // Smart fallback: If order_type is blank, auto-detect by table presence
        $order_type = $table_id ? 'DINE_IN' : 'TAKE_OUT';
    }

    // 2. Group Cart Items Backend-Side (Prevents duplicate row inserts)
    //    REQ-040: keyed by a CONFIGURATION SIGNATURE so two lines of the same
    //    base item with different flavors/add-ons never collapse into one
    //    (each config keeps its own choices/add-ons/price).
    $groupedCart = [];
    $sigOrder = []; // preserve first-seen order for stable output
    foreach ($data['cart'] as $item) {
        $itemId = (int)($item['menu_item_id'] ?? 0);
        if ($itemId < 1) {
            throw new Exception('Invalid cart item.');
        }
        $instructions = trim($item['special_instructions'] ?? '');
        $lineChoices = [];
        foreach (($item['choices'] ?? []) as $cid) {
            $lineChoices[] = (int)$cid;
        }
        sort($lineChoices);
        $lineAddons = [];
        foreach (($item['addons'] ?? []) as $addon) {
            if (!is_array($addon)) continue;
            $lineAddons[] = [
                'menu_addon_id' => (int)($addon['menu_addon_id'] ?? 0),
                'quantity'      => max(1, (int)($addon['quantity'] ?? 1))
            ];
        }
        usort($lineAddons, function ($a, $b) {
            return $a['menu_addon_id'] <=> $b['menu_addon_id'];
        });
        $configured = !empty($item['configured']);
        // REQ-050 C2: a DB-rebuilt (configured) line is authoritative ONLY if
        // it carries the order_item_id it came from. A client-forged flag with
        // no id must NOT skip the required-group gate.
        $orderItemId = $configured ? (int)($item['order_item_id'] ?? 0) : 0;
        if ($configured && $orderItemId < 1) {
            $configured = false;
        }

        $sig = json_encode([
            'i' => $itemId,
            'c' => $lineChoices,
            'a' => $lineAddons,
            's' => $configured ? '__configured__' : $instructions
        ], JSON_UNESCAPED_SLASHES);

        if (!isset($groupedCart[$sig])) {
            $groupedCart[$sig] = [
                'menu_item_id' => $itemId,
                'quantity' => 0,
                'price' => 0.0,
                'special_instructions' => $instructions,
                'choices' => $lineChoices,
                'addons' => $lineAddons,
                'configured' => $configured,
                'order_item_id' => $orderItemId
            ];
            $sigOrder[] = $sig;
        }
        // Always accumulate quantity — the first occurrence included.
        $groupedCart[$sig]['quantity'] += isset($item['quantity']) ? (int)$item['quantity'] : 1;
    }

    // 3. Fetch real prices from DB (server-authoritative, never trust client prices)
    $menuIds = array_values(array_unique(array_map(function ($g) {
        return (int)$g['menu_item_id'];
    }, $groupedCart)));
    $placeholders = implode(',', array_fill(0, count($menuIds), '?'));
    $stmtPrices = $pdo->prepare("SELECT menu_item_id, price, item_name, status FROM menu_items WHERE menu_item_id IN ($placeholders)");
    $stmtPrices->execute($menuIds);
    $dbItems = [];
    foreach ($stmtPrices->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $dbItems[(int)$row['menu_item_id']] = $row;
    }

    // 4. Validate every item exists + is Available + replace client prices with DB prices
    //    + validate choices/add-ons + fold add-on price into the line price + compose instructions (REQ-040)
    //    REQ-050 C2: a `configured` flag only skips the required-group gate when the line
    //    carries a real order_item_id (enforced during grouping above). New orders are
    //    always re-priced fresh from the menu — no stored-price resolution applies here.
    $unavailable = [];
    $computedTotal = 0;
    foreach ($groupedCart as $sig => &$item) {
        $itemId = (int)$item['menu_item_id'];
        if (!isset($dbItems[$itemId])) {
            throw new Exception('Menu item not found: ' . $itemId);
        }
        if ($dbItems[$itemId]['status'] !== 'Available') {
            $unavailable[] = $dbItems[$itemId]['item_name'];
            continue;
        }
        $validated = hof_validate_choices_addons(
            $pdo,
            $itemId,
            $item['special_instructions'],
            $item['choices'],
            $item['addons'],
            !empty($item['configured'])
        );
        if (!$validated['ok']) {
            $pdo->rollBack();
            echo json_encode(['success' => false, 'message' => $validated['message']]);
            exit;
        }
        $item['price'] = (float)$dbItems[$itemId]['price'] + $validated['addon_total'];
        $item['special_instructions'] = $validated['special_instructions'];
        $computedTotal += $item['quantity'] * $item['price'];
    }
    unset($item);

    if (!empty($unavailable)) {
        $pdo->rollBack();
        echo json_encode([
            'success' => false,
            'unavailable' => $unavailable,
            'message' => 'Some items are no longer available: ' . implode(', ', $unavailable) . '. Please remove or replace them.'
        ]);
        exit;
    }
    $computedTotal = round($computedTotal, 2);

    // 5. Insert Main Order with server-computed total
    $sqlOrder = "INSERT INTO orders (
                        table_id, 
                        user_id, 
                        customer_name,
                        status, 
                        reference_number, 
                        order_type, 
                        subtotal_amount,
                        total_amount, 
                        created_at,
                        ordered_at
                    ) VALUES (?, ?, ?, 'PENDING', ?, ?, ?, ?, NOW(), NOW())";

        try {
        $stmtOrder = $pdo->prepare($sqlOrder);
        $stmtOrder->execute([
            $table_id,
            $user_id,
            $customer_name,
            $reference_number,
            $order_type,
            $computedTotal,
            $computedTotal
        ]);
        $orderId = $pdo->lastInsertId();
    } catch (PDOException $e) {
        if ($e->getCode() == 23000) {
            $pdo->rollBack();
            if ($attempt >= $maxRetries) {
                throw $e;
            }
            continue;
        }
        throw $e;
    }

    if ($table_id && $order_type === 'DINE_IN') {
        $sqlTable = "UPDATE restaurant_table SET status = 'OCCUPIED' WHERE table_id = ?";
        $stmtTable = $pdo->prepare($sqlTable);
        $stmtTable->execute([$table_id]);
    }

    $sqlItems = "INSERT INTO order_items (
                    order_id, 
                    menu_item_id, 
                    quantity, 
                    price, 
                    special_instructions,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, NOW())";
    $stmtItems = $pdo->prepare($sqlItems);

    foreach ($groupedCart as $item) {
        $stmtItems->execute([
            $orderId,
            $item['menu_item_id'],
            $item['quantity'],
            $item['price'],
            $item['special_instructions']
        ]);
    }

$orderSuccess = true;
        break;

    } // end for

    if ($orderSuccess) {
        $pdo->commit();

        $epochStmt = $pdo->prepare("SELECT UNIX_TIMESTAMP(created_at) AS created_epoch FROM orders WHERE order_id = ?");
        $epochStmt->execute([$orderId]);
        $epochRow = $epochStmt->fetch(PDO::FETCH_ASSOC);

        if (function_exists('broadcastOrderUpdate')) {
            broadcastOrderUpdate($orderId, "New Order #$reference_number received. Awaiting counter payment.", 'PENDING');
        }

        // REQ-050: log order creation (GUEST actor — customer path, no authenticated user).
        // before is null (no prior state) so compose the after-snapshot WITHOUT a leading " → ".
        logActivity($pdo, null, 'GUEST', 'Customer', 'ORDER_CREATED',
            "Order {$reference_number} placed - total ₱" . number_format($computedTotal, 2, '.', '') . " status PENDING",
            'order', $orderId, $reference_number, 'PENDING');

        echo json_encode([
            'success' => true,
            'order_id' => $orderId,
            'reference_number' => $reference_number,
            'created_epoch' => $epochRow ? (int)$epochRow['created_epoch'] : time()
        ]);
        exit;
    } else {
        throw new Exception('Failed after ' . $maxRetries . ' retry attempts.');
    }
} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo json_encode(['success' => false, 'message' => $e->getMessage()]);
}