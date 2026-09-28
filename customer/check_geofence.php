<?php
/**
 * ============================================================
 * Check Geofence - HOF Anti-Fraud Location Gate (US-SYS-013)
 * ------------------------------------------------------------
 * POST { lat | latitude, lng | longitude, accuracy? }
 * →
 * {
 *   success: true,
 *   allowed: bool,
 *   reason:  INSIDE | OUT_OF_RANGE | MISSING_COORDS | UNRELIABLE_GPS,
 *   distance_m: number|null,
 *   effective_distance_m: number|null,
 *   radius_m: int,
 *   store: { name, lat, lng }
 * }
 *
 * Public endpoint (like occupy_table.php) — customers have no JWT.
 * Protected by a per-IP sliding-window rate limit (30 req / 5 min)
 * so bots can't use it as a free distance oracle.
 *
 * The authoritative re-check happens again inside place_order.php,
 * so spoofing this endpoint alone never lets an order through.
 * ============================================================
 */

header('Content-Type: application/json');
require_once __DIR__ . '/../backend/db.php';
require_once __DIR__ . '/../backend/geofence_config.php';

// Load dynamic location from DB
$storeLoc = hof_get_store_location_from_db($pdo);

/* ------------------------------------------------------------
 * Lightweight mode_only check (public, no rate limit, no auth).
 * Used by customer.js to quickly determine if geofence is OFF
 * without waiting for GPS lock.
 * ---------------------------------------------------------- */
if (!empty($_GET['mode_only'])) {
    echo json_encode([
        'success' => true,
        'enabled' => (bool)($storeLoc['enabled'] ?? true),
    ]);
    exit;
}

/* ------------------------------------------------------------
 * Per-IP rate limiting: 30 requests per 5 minutes, sliding window
 * stored in the system temp dir (no DB writes needed).
 * ---------------------------------------------------------- */
function hof_geofence_rate_limit_check(): bool
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $dir = sys_get_temp_dir() . '/hof_geo_limits';
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    $file  = $dir . '/geo_' . hash('sha256', $ip) . '.json';
    $now   = time();
    $window = 300;   // seconds
    $limit  = 30;    // max requests per window

    $stamps = [];
    if (is_file($file)) {
        $stamps = json_decode((string)file_get_contents($file), true) ?: [];
    }
    // keep only stamps inside the current window
    $stamps = array_values(array_filter($stamps, function($t) use ($now, $window) { return ($now - (int)$t) < $window; }));

    if (count($stamps) >= $limit) {
        file_put_contents($file, json_encode($stamps), LOCK_EX); // persist prune
        return false; // rate limited
    }

    $stamps[] = $now;
    file_put_contents($file, json_encode($stamps), LOCK_EX);
    return true;
}

if (!hof_geofence_rate_limit_check()) {
    http_response_code(429);
    header('Retry-After: 60');
    echo json_encode([
        'success' => false,
        'allowed' => false,
        'reason'  => 'RATE_LIMITED',
        'message' => 'Too many location checks. Please wait a minute and try again.'
    ]);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) {
    $input = $_POST; // allow form-encoded fallback
}

// Use hof_geofence_gate so DB geofence_enabled toggle + HOF_GEOFENCE_MODE are both respected
$storeEnabled = (bool)($storeLoc['enabled'] ?? true);
$gateResult = hof_geofence_gate(
    $input['lat'] ?? $input['latitude'] ?? null,
    $input['lng'] ?? $input['longitude'] ?? null,
    $input['accuracy'] ?? 0,
    $storeLoc['lat'],
    $storeLoc['lng'],
    $storeLoc['radius_m'],
    $storeEnabled
);

$allowed = $gateResult['allowed'];
$reason  = $gateResult['reason'];
$mode    = $gateResult['mode'] ?? 'ENFORCED';
$enforced = $gateResult['enforced'] ?? false;

echo json_encode([
    'success'              => true,
    'allowed'              => $storeEnabled ? $allowed : true,
    'reason'               => $storeEnabled ? $reason : 'DISABLED',
    'distance_m'           => $gateResult['distance_m'] ?? null,
    'effective_distance_m' => $gateResult['effective_distance_m'] ?? null,
    'radius_m'             => $storeLoc['radius_m'],
    'mode'                 => $storeEnabled ? $mode : 'OFF',
    'enforced'             => $storeEnabled ? $enforced : false,
    'store'                => [
        'name' => 'House of Fries - Tagoloan',
        'lat'  => $storeLoc['lat'],
        'lng'  => $storeLoc['lng'],
    ],
]);
