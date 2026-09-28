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
    require_once __DIR__ . '/../../log_activity_helper.php';

    $rawBody = isset($GLOBALS['RAW_HTTP_BODY']) ? $GLOBALS['RAW_HTTP_BODY'] : file_get_contents('php://input');
    $input = json_decode($rawBody, true);

    if (!is_array($input)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Invalid JSON body']);
        exit;
    }

    $branchName = isset($input['branch_name']) ? trim((string)$input['branch_name']) : null;
    $lat = isset($input['latitude']) ? filter_var($input['latitude'], FILTER_VALIDATE_FLOAT) : null;
    $lng = isset($input['longitude']) ? filter_var($input['longitude'], FILTER_VALIDATE_FLOAT) : null;
    $rad = isset($input['radius_meters']) ? filter_var($input['radius_meters'], FILTER_VALIDATE_INT) : null;
    $enabled = isset($input['geofence_enabled']) ? (int)(bool)$input['geofence_enabled'] : null;

    // Validate branch_name (required, 3-100 chars)
    if (!$branchName || strlen($branchName) < 3 || strlen($branchName) > 100) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Branch name must be 3-100 characters']);
        exit;
    }

    if ($lat === false || $lat === null || $lng === false || $lng === null || $rad === false || $rad === null || $enabled === null) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Missing required fields']);
        exit;
    }

    if ($lat < 4.5 || $lat > 21.5) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Latitude out of range']);
        exit;
    }
    if ($lng < 116.5 || $lng > 127.0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Longitude out of range']);
        exit;
    }
    if ($rad < 10 || $rad > 2500) {
        http_response_code(400);
        echo json_encode(['success' => false, 'message' => 'Radius must be 10-2500 meters']);
        exit;
    }

    // Check if branch_settings table exists
    try {
        $tableCheck = $pdo->query("SHOW TABLES LIKE 'branch_settings'");
        if (!$tableCheck || $tableCheck->rowCount() === 0) {
            // Table doesn't exist - create it
            $pdo->exec("
                CREATE TABLE `branch_settings` (
                    `setting_id` int(11) NOT NULL AUTO_INCREMENT,
                    `branch_name` varchar(100) NOT NULL DEFAULT 'House of Fries - Tagoloan',
                    `latitude` decimal(10,7) NOT NULL DEFAULT 8.5372000,
                    `longitude` decimal(10,7) NOT NULL DEFAULT 124.8269000,
                    `radius_meters` int(11) NOT NULL DEFAULT 300,
                    `geofence_enabled` tinyint(1) NOT NULL DEFAULT 1,
                    `updated_by` int(11) DEFAULT NULL,
                    `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
                    `created_at` datetime DEFAULT current_timestamp(),
                    PRIMARY KEY (`setting_id`),
                    KEY `idx_branch_name` (`branch_name`)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            ");
            error_log('update_location.php: Created branch_settings table automatically');
        }
    } catch (PDOException $tableCreateErr) {
        error_log('update_location.php: Failed to create branch_settings table: ' . $tableCreateErr->getMessage());
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Database setup failed. Please contact administrator.']);
        exit;
    }

    // Check if setting_id exists
    try {
        $checkStmt = $pdo->query("SELECT setting_id FROM branch_settings ORDER BY setting_id ASC LIMIT 1");
        $existingRow = $checkStmt ? $checkStmt->fetch(PDO::FETCH_ASSOC) : null;
    } catch (PDOException $e) {
        $existingRow = null;
    }

    if ($existingRow && isset($existingRow['setting_id'])) {
        // UPDATE existing record
        $stmt = $pdo->prepare("
            UPDATE branch_settings SET
                branch_name = ?,
                latitude = ?,
                longitude = ?,
                radius_meters = ?,
                geofence_enabled = ?,
                updated_by = ?,
                updated_at = NOW()
            WHERE setting_id = ?
        ");
        $stmt->execute([
            $branchName,
            $lat,
            $lng,
            $rad,
            $enabled,
            (int)$authUser['user_id'],
            (int)$existingRow['setting_id']
        ]);
    } else {
        // INSERT new record with setting_id = 1
        $stmt = $pdo->prepare("
            INSERT INTO branch_settings (setting_id, branch_name, latitude, longitude, radius_meters, geofence_enabled, updated_by, created_at, updated_at)
            VALUES (1, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        ");
        $stmt->execute([
            $branchName,
            $lat,
            $lng,
            $rad,
            $enabled,
            (int)$authUser['user_id']
        ]);
    }

    logActivity($pdo, $authUser['user_id'], $authUser['username'], $authUser['role'],
        'SETTINGS_LOCATION', "Updated branch location/radius",
        'branch_settings', 1);

    echo json_encode(['success' => true, 'message' => 'Location settings saved successfully']);
} catch (PDOException $e) {
    error_log('update_location.php PDO: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Database error occurred while saving location settings']);
} catch (\Throwable $e) {
    error_log('update_location.php THROW: ' . $e->getMessage() . ' at line ' . $e->getLine());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'An unexpected error occurred while saving location settings']);
}