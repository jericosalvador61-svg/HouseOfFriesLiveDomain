<?php
/**
 * ============================================================
 * HOF Geofence Configuration & Helpers (Advisor Feature #7)
 * ------------------------------------------------------------
 * Anti-fraud location gate: QR ordering is only allowed when
 * the customer's device is physically near the restaurant.
 *
 * Used by:
 *   - customer/check_geofence.php   (pre-order verification)
 *   - customer/place_order.php      (server-side re-validation)
 *
 * TUNING GUIDE:
 *   To adjust the store location or radius, edit the constants
 *   below ONLY. Radius is in meters (default 300m ~ 3 min walk).
 * ============================================================
 */

if (!defined('HOF_GEOFENCE_LOADED')) {
    define('HOF_GEOFENCE_LOADED', true);

    /**
     * Gate mode:
     *   'ENFORCED'  - block orders outside the radius (production)
     *   'LOG_ONLY'  - allow everything but still compute/log distances
     *                 (soft-launch / tuning period)
     *   'OFF'       - feature disabled entirely
     */
    define('HOF_GEOFENCE_MODE', 'ENFORCED');

    /**
     * Restaurant reference point — The House of Fries, Villegas St.,
     * Poblacion, Tagoloan, Misamis Oriental.
     * Update these if the branch moves.
     */
    define('HOF_STORE_LAT', 8.53720);
    define('HOF_STORE_LNG', 124.82690);

    /**
     * Allowed ordering radius in meters.
     * 300m covers the immediate Poblacion block while excluding
     * out-of-town scanners. Increase if indoor GPS struggles.
     */
    define('HOF_GEOFENCE_RADIUS_M', 300);

    /**
     * GPS accuracy handling: devices report an accuracy circle (meters).
     * We subtract it from the measured distance (charitable math) so a
     * customer standing inside the shop with ±40m noise is not rejected.
     * Readings worse than HOF_MAX_ACCURACY_M are treated as unreliable
     * and refused (prevents "fake accuracy=9999" spoofing).
     */
    define('HOF_MAX_ACCURACY_M', 150);

    /**
     * Enforcement mode:
     *   'ENFORCED'  – orders outside the radius are REJECTED (production default)
     *   'LOG_ONLY'  – distances are logged but orders are allowed
     *                 (useful for defense-day demos / flaky venue Wi-Fi)
     *   'OFF'       – feature disabled entirely (local LAN testing)
     * Consumers must call hof_geofence_gate() — never branch on their own.
     */
    defined('HOF_GEOFENCE_MODE') || define('HOF_GEOFENCE_MODE', 'ENFORCED');
}

if (!function_exists('hof_haversine_distance_m')) {
    /**
     * Great-circle distance between two lat/lng points in METERS.
     */
    function hof_haversine_distance_m($lat1, $lng1, $lat2, $lng2)
    {
        $earthRadius = 6371000.0;

        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) * sin($dLat / 2)
           + cos(deg2rad($lat1)) * cos(deg2rad($lat2))
           * sin($dLng / 2) * sin($dLng / 2);

        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return round($earthRadius * $c, 1);
    }
}

if (!function_exists('hof_validate_coordinates')) {
    /**
     * Sanity-check raw coordinate input.
     * Returns [float|null $lat, float|null $lng, float $accuracy].
     */
    function hof_validate_coordinates($rawLat, $rawLng, $rawAccuracy)
    {
        $lat = is_numeric($rawLat) ? (float)$rawLat : null;
        $lng = is_numeric($rawLng) ? (float)$rawLng : null;
        $acc = is_numeric($rawAccuracy) ? (float)$rawAccuracy : 0.0;

        // Reject impossible / placeholder values (0,0 is the null island)
        if ($lat === null || $lng === null || $lat === 0.0 && $lng === 0.0) {
            return [null, null, 0.0];
        }
        if ($lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
            return [null, null, 0.0];
        }
        if ($acc < 0) {
            $acc = 0.0;
        }

        return [$lat, $lng, $acc];
    }
}

if (!function_exists('hof_get_store_location_from_db')) {
    /**
     * Read the store location settings from the branch_settings table.
     * Falls back to hardcoded constants if the table/row doesn't exist.
     *
     * @param PDO $pdo
     * @return array { lat: float, lng: float, radius_m: int, enabled: bool }
     */
    function hof_get_store_location_from_db(PDO $pdo)
    {
        try {
            $stmt = $pdo->query("SELECT latitude, longitude, radius_meters, geofence_enabled FROM branch_settings LIMIT 1");
            $row  = $stmt->fetch();
            if ($row) {
                return [
                    'lat'       => (float)$row['latitude'],
                    'lng'       => (float)$row['longitude'],
                    'radius_m'  => (int)$row['radius_meters'],
                    'enabled'   => (bool)$row['geofence_enabled'],
                ];
            }
        } catch (PDOException $e) {
            // Table may not exist yet — fall through to defaults
        }

        return [
            'lat'       => HOF_STORE_LAT,
            'lng'       => HOF_STORE_LNG,
            'radius_m'  => HOF_GEOFENCE_RADIUS_M,
            'enabled'   => true,
        ];
    }
}

if (!function_exists('hof_geofence_evaluate')) {
    /**
     * Core evaluation used by every consumer so the rules live in ONE place.
     *
     * @param float|null $lat        Customer latitude
     * @param float|null $lng        Customer longitude
     * @param float      $accuracy   Device-reported accuracy in meters
     * @param float|null $storeLat   Override store latitude (null = use HOF_STORE_LAT)
     * @param float|null $storeLng   Override store longitude (null = use HOF_STORE_LNG)
     * @param int|null   $storeRadius Override store radius (null = use HOF_GEOFENCE_RADIUS_M)
     *
     * @return array {allowed: bool, reason: string, distance_m: float|null,
     *                effective_distance_m: float|null, radius_m: int}
     */
    function hof_geofence_evaluate($lat, $lng, $accuracy = 0.0, $storeLat = null, $storeLng = null, $storeRadius = null)
    {
        $sLat    = $storeLat    ?? HOF_STORE_LAT;
        $sLng    = $storeLng    ?? HOF_STORE_LNG;
        $sRadius = $storeRadius ?? HOF_GEOFENCE_RADIUS_M;

        // Feature switch: OFF allows everything immediately.
        if (HOF_GEOFENCE_MODE === 'OFF') {
            return [
                'allowed'              => true,
                'reason'               => 'DISABLED',
                'distance_m'           => null,
                'effective_distance_m' => null,
                'radius_m'             => $sRadius,
            ];
        }

        $radius = $sRadius;

        [$lat, $lng, $accuracy] = hof_validate_coordinates($lat, $lng, $accuracy);

        if ($lat === null || $lng === null) {
            return [
                'allowed'              => false,
                'reason'               => 'MISSING_COORDS',
                'distance_m'           => null,
                'effective_distance_m' => null,
                'radius_m'             => $radius,
            ];
        }

        if ($accuracy > HOF_MAX_ACCURACY_M) {
            return [
                'allowed'              => false,
                'reason'               => 'UNRELIABLE_GPS',
                'distance_m'           => null,
                'effective_distance_m' => null,
                'radius_m'             => $radius,
            ];
        }

        $distance  = hof_haversine_distance_m($lat, $lng, $sLat, $sLng);

        // Charitable distance: trust circle subtracted, never below zero.
        $effective = max(0.0, $distance - $accuracy);

        return [
            'allowed'              => $effective <= $radius,
            'reason'               => $effective <= $radius ? 'INSIDE' : 'OUT_OF_RANGE',
            'distance_m'           => $distance,
            'effective_distance_m' => round($effective, 1),
            'radius_m'             => $radius,
        ];
    }
}

if (!function_exists('hof_geofence_gate')) {
    /**
     * Order-placement gate used by place_order.php and check_geofence.php.
     * Single decision point that applies HOF_GEOFENCE_MODE AND the
     * DB-stored geofence_enabled toggle.
     *
     * Accepts BOTH key styles:
     *   - lat / lng          (used by customer.js geofence gate)
     *   - latitude / longitude (used by check_geofence.php contract)
     *
     * @param bool $enabled  Whether the admin has geofence toggled ON in DB.
     *                       Pass $storeLoc['enabled'] from hof_get_store_location_from_db().
     *                       When false, the gate is completely disabled regardless of MODE constant.
     *
     * @return array Evaluation array + extra keys:
     *               mode: string, enforced: bool
     */
    function hof_geofence_gate($lat, $lng, $accuracy = 0.0, $storeLat = null, $storeLng = null, $storeRadius = null, $enabled = true)
    {
        // If the admin has toggled geofence OFF in the Location Settings panel,
        // behave as DISABLED regardless of the hardcoded HOF_GEOFENCE_MODE constant.
        if (!$enabled) {
            return [
                'allowed'              => true,
                'reason'               => 'DISABLED',
                'distance_m'           => null,
                'effective_distance_m' => null,
                'radius_m'             => $storeRadius ?? HOF_GEOFENCE_RADIUS_M,
                'mode'                 => 'OFF',
                'enforced'             => false,
            ];
        }

        $result = hof_geofence_evaluate($lat, $lng, $accuracy, $storeLat, $storeLng, $storeRadius);
        $result['mode'] = HOF_GEOFENCE_MODE;

        switch (HOF_GEOFENCE_MODE) {
            case 'OFF':
                // Feature disabled: allow everything, but still report the math
                $result['allowed']  = true;
                $result['enforced'] = false;
                $result['reason']   = 'DISABLED';
                break;

            case 'LOG_ONLY':
                // Log violations for review but never block (demo mode)
                if (!$result['allowed']) {
                    error_log(sprintf(
                        "[HOF-GEOFENCE][LOG_ONLY] OUT_OF_RANGE lat=%s lng=%s acc=%s dist=%s",
                        var_export($lat, true),
                        var_export($lng, true),
                        var_export($accuracy, true),
                        var_export($result['distance_m'], true)
                    ));
                }
                $result['allowed']  = true;
                $result['enforced'] = false;
                break;

            case 'ENFORCED':
            default:
                $result['enforced'] = true;
                if (!$result['allowed']) {
                    error_log(sprintf(
                        "[HOF-GEOFENCE] BLOCKED reason=%s lat=%s lng=%s acc=%s dist=%s",
                        $result['reason'],
                        var_export($lat, true),
                        var_export($lng, true),
                        var_export($accuracy, true),
                        var_export($result['distance_m'], true)
                    ));
                }
                break;
        }

        return $result;
    }
}
