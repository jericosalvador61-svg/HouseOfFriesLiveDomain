<?php
/**
 * Get Location for Landing Page - House of Fries
 * PUBLIC, read-only JSON endpoint (no auth) that mirrors the admin's
 * branch_settings so the landing-page map always shows the CURRENT
 * location saved by the admin. Same self-contained style as
 * get_menu_for_landing.php so it deploys as a single file.
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

$host = 'sql201.infinityfree.com';
$db   = 'if0_42560270_house_of_fries_db';
$user = 'if0_42560270';
$pass = 'houseoffries';

try {
    $pdo = new PDO(
        "mysql:host=$host;dbname=$db;charset=utf8mb4",
        $user,
        $pass,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );

    $row = $pdo->query(
        "SELECT branch_name, latitude, longitude, radius_meters, geofence_enabled
         FROM branch_settings
         ORDER BY setting_id ASC LIMIT 1"
    )->fetch();

    if (!$row) {
        echo json_encode([
            'success' => false,
            'message' => 'No location configured yet. Please set it in Admin > Location Settings.'
        ]);
        exit;
    }

    echo json_encode([
        'success' => true,
        'settings' => [
            'branch_name'      => (string)$row['branch_name'],
            'latitude'         => (float)$row['latitude'],
            'longitude'        => (float)$row['longitude'],
            'radius_meters'    => (int)$row['radius_meters'],
            'geofence_enabled' => (bool)$row['geofence_enabled']
        ]
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load location']);
}
