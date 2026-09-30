<?php
// Prevent output buffering layout collision pollution
ob_start();

require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php'; // REQ-050
$auth = authenticate(['Admin']);

// Set script timeout thresholds high enough to accommodate expanding enterprise datasets safely
set_time_limit(300);
ini_set('memory_limit', '512M');

$action = isset($_GET['action']) ? $_GET['action'] : 'manual_download';

try {
    // 1. Fetch entire workspace relational architecture layouts
    $tables = [];
    $result = $pdo->query("SHOW TABLES");
    while ($row = $result->fetch(PDO::FETCH_NUM)) {
        $tables[] = $row[0];
    }

    $sqlDumpOutput = "-- ======================================================\n";
    $sqlDumpOutput .= "-- HOUSE OF FRIES - CORE DATA SECURITY SNAPSHOT MIGRATION\n";
    $sqlDumpOutput .= "-- Generated: " . date('Y-m-d H:i:s') . "\n";
    $sqlDumpOutput .= "-- Engine Protocol Interface: PDO MySQL Schema Extractor\n";
    $sqlDumpOutput .= "-- ======================================================\n\n";
    $sqlDumpOutput .= "SET FOREIGN_KEY_CHECKS=0;\n\n";

    // 2. Loop through every table to compile structures and data inputs
    foreach ($tables as $table) {
        // Table Reconstruction Blueprints
        $createTableStmt = $pdo->query("SHOW CREATE TABLE `$table`")->fetch(PDO::FETCH_ASSOC);
        $sqlDumpOutput .= "DROP TABLE IF EXISTS `$table`;\n";
        $sqlDumpOutput .= $createTableStmt['Create Table'] . ";\n\n";

        // Extract raw data row contexts sequentially
        $rowsDataStmt = $pdo->query("SELECT * FROM `$table`");
        while ($row = $rowsDataStmt->fetch(PDO::FETCH_ASSOC)) {
            $sqlDumpOutput .= "INSERT INTO `$table` VALUES(";
            $values = [];
            foreach ($row as $fieldValue) {
                if ($fieldValue === null) {
                    $values[] = "NULL";
                } else {
                    // Properly escape special characters to prevent corrupted injection structures on restoration imports
                    $escapedValue = str_replace(array("\x00", "\n", "\r", "\\", "'", "\x1a"), array('\\0', '\\n', '\\r', '\\\\', "\'", '\\Z'), $fieldValue);
                    $values[] = "'" . $escapedValue . "'";
                }
            }
            $sqlDumpOutput .= implode(",", $values) . ");\n";
        }
        $sqlDumpOutput .= "\n\n";
    }

    $sqlDumpOutput .= "SET FOREIGN_KEY_CHECKS=1;\n";

    // REQ-050: log backup action (before streaming; not inside the dump loop)
    logActivity($pdo, (int)$auth['user_id'], $auth['username'] ?? 'admin', $auth['role'] ?? 'Admin',
        'SETTINGS_BACKUP', "Database " . ($action === 'hourly_auto_save' ? 'auto-saved (hourly)' : 'exported (manual download)') . " by " . ($auth['username'] ?? 'admin'),
        null, null, null, 'COMPLETED');

    // Clear output buffering data before streaming payload handles
    ob_clean();

    // 3. ROUTE TRAFFIC TO ACCURATE PIPELINE DISPATCH CONTROLLER ACTION
    if ($action === 'manual_download') {
        // Stream attachment data payload strings directly to browser anchor triggers
        header('Content-Description: File Transfer');
        header('Content-Type: application/octet-stream');
        header('Content-Disposition: attachment; filename="HOF_DATA_EXPORT_' . date('Ymd_His') . '.sql"');
        header('Expires: 0');
        header('Cache-Control: must-revalidate');
        header('Pragma: public');
        header('Content-Length: ' . strlen($sqlDumpOutput));

        echo $sqlDumpOutput;
        exit();
    } else if ($action === 'hourly_auto_save') {
        // Write the compiled database string directly to a file on your server
        $backupDirectory = __DIR__ . '/backups/';

        // Safety validation checklist: Ensure automated save storage target directories exist cleanly
        if (!file_exists($backupDirectory)) {
            mkdir($backupDirectory, 0755, true);
        }

        // Keep filenames clean using hourly intervals (e.g., auto_backup_1400.sql)
        $autoFileName = 'auto_backup_' . date('H00') . '.sql';
        file_put_contents($backupDirectory . $autoFileName, $sqlDumpOutput);

        header('Content-Type: application/json');
        echo json_encode(['status' => 'success', 'message' => 'Hourly background data trace serialized successfully.']);
        exit();
    }
} catch (Exception $e) {
    ob_clean();
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'An error occurred.'
    ]);
    error_log($e->getMessage());
    exit();
}
