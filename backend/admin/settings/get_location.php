<?php
header('Content-Type: application/json');

try {
    require_once __DIR__ . '/../../auth_middleware.php';
    $authUser = authenticate(['Admin']);

    if (!is_array($authUser) || !isset($authUser['user_id'])) {
        http_response_code(401);
        echo json_encode(['success' => false, 'message' => 'Unauthorized']);
        exit;
    }

    require_once __DIR__ . '/../../db.php';

    // Check if branch_settings table exists
    try {
        $tableCheck = $pdo->query("SHOW TABLES LIKE 'branch_settings'");
        if (!$tableCheck || $tableCheck->rowCount() === 0) {
            // Table doesn't exist - return EMPTY values for admin to fill in
            http_response_code(200);
            echo json_encode([
                'success' => true,
                'settings' => [
                    'branch_name' => '',
                    'latitude' => null,
                    'longitude' => null,
                    'radius_meters' => 300,
                    'geofence_enabled' => true,
                    'is_new' => true
                ]
            ]);
            exit;
        }
    } catch (PDOException $e) {
        // Table doesn't exist, return EMPTY values
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'settings' => [
                'branch_name' => '',
                'latitude' => null,
                'longitude' => null,
                'radius_meters' => 300,
                'geofence_enabled' => true,
                'is_new' => true
            ]
        ]);
        exit;
    }

    // Fetch branch settings row
    try {
        $stmt = $pdo->query("SELECT setting_id, branch_name, latitude, longitude, radius_meters, geofence_enabled, updated_at FROM branch_settings ORDER BY setting_id ASC LIMIT 1");
        $row = $stmt ? $stmt->fetch(PDO::FETCH_ASSOC) : null;
    } catch (PDOException $e) {
        $row = null;
    }

    if (!$row) {
        // No data in table - return EMPTY values for admin to fill in
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'settings' => [
                'branch_name' => '',
                'latitude' => null,
                'longitude' => null,
                'radius_meters' => 300,
                'geofence_enabled' => true,
                'is_new' => true
            ]
        ]);
        exit;
    }

    // Found data - return it
    http_response_code(200);
    echo json_encode([
        'success' => true,
        'settings' => [
            'branch_name' => (string)$row['branch_name'],
            'latitude' => (float)$row['latitude'],
            'longitude' => (float)$row['longitude'],
            'radius_meters' => (int)$row['radius_meters'],
            'geofence_enabled' => (bool)$row['geofence_enabled'],
            'is_new' => false
        ]
    ]);
} catch (PDOException $e) {
    error_log('get_location.php PDO: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error occurred while fetching location settings']);
} catch (\Throwable $e) {
    error_log('get_location.php FATAL: ' . $e->getMessage() . ' at line ' . $e->getLine());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'An unexpected error occurred while fetching location settings']);
}