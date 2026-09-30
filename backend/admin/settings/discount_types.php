<?php
/**
 * Admin settings endpoint: Discount Types CRUD (REQ-049).
 *
 * POST body (JSON):
 *   action : 'list' | 'create' | 'update' | 'delete'
 *   For create: { name, percent }
 *   For update: { discount_type_id, name, percent, is_active }
 *   For delete: { discount_type_id }  (soft delete -> is_active = 0)
 *
 * Auth: Admin only.
 * Validation: name required, percent 0.00-100.00.
 * Deactivate is a soft delete (is_active = 0) — NO hard delete.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../../db.php';
require_once __DIR__ . '/../../auth_middleware.php';
require_once __DIR__ . '/../../log_activity_helper.php';

$auth = authenticate(['Admin']);

$rawBody = isset($GLOBALS['RAW_HTTP_BODY']) ? $GLOBALS['RAW_HTTP_BODY'] : file_get_contents('php://input');
$data = json_decode($rawBody, true);

if (!is_array($data) || empty($data['action'])) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Missing action.']);
    exit;
}

$action = (string)$data['action'];

try {
    switch ($action) {
        case 'list':
            $stmt = $pdo->prepare("
                SELECT discount_type_id, name, percent, is_active
                FROM discount_types
                ORDER BY is_active DESC, discount_type_id ASC
            ");
            $stmt->execute();
            echo json_encode([
                'success' => true,
                'types'   => $stmt->fetchAll(PDO::FETCH_ASSOC)
            ]);
            exit;

        case 'create':
            $name    = isset($data['name']) ? trim((string)$data['name']) : '';
            $percent = isset($data['percent']) ? (float)$data['percent'] : -1;

            if ($name === '') {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Discount type name is required.']);
                exit;
            }
            if (strlen($name) > 50) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Discount type name must be 50 characters or fewer.']);
                exit;
            }
            if ($percent < 0 || $percent > 100) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Discount percent must be between 0.00 and 100.00.']);
                exit;
            }

            $insert = $pdo->prepare("
                INSERT INTO discount_types (name, percent, is_active)
                VALUES (?, ?, 1)
            ");
            $insert->execute([$name, round($percent, 2)]);
            $newId = (int)$pdo->lastInsertId();

            logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
                'DISCOUNT_TYPE_CREATE', "Added discount type \"{$name}\" ({$percent}%)",
                'discount_types', $newId);

            echo json_encode(['success' => true, 'discount_type_id' => $newId]);
            exit;

        case 'update':
            $typeId = (int)($data['discount_type_id'] ?? 0);
            $name   = isset($data['name']) ? trim((string)$data['name']) : '';
            $percent = isset($data['percent']) ? (float)$data['percent'] : -1;
            $isActive = isset($data['is_active']) ? (int)(bool)$data['is_active'] : null;

            if ($typeId < 1) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Invalid discount type ID.']);
                exit;
            }
            if ($name === '') {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Discount type name is required.']);
                exit;
            }
            if (strlen($name) > 50) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Discount type name must be 50 characters or fewer.']);
                exit;
            }
            if ($percent < 0 || $percent > 100) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Discount percent must be between 0.00 and 100.00.']);
                exit;
            }

            if ($isActive === null) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'is_active is required.']);
                exit;
            }

            $update = $pdo->prepare("
                UPDATE discount_types
                SET name = ?, percent = ?, is_active = ?
                WHERE discount_type_id = ?
            ");
            $update->execute([$name, round($percent, 2), $isActive, $typeId]);

            logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
                'DISCOUNT_TYPE_UPDATE', "Updated discount type #{$typeId} \"{$name}\" ({$percent}%) active=" . ($isActive ? '1' : '0'),
                'discount_types', $typeId);

            echo json_encode(['success' => true]);
            exit;

        case 'delete':
            $typeId = (int)($data['discount_type_id'] ?? 0);
            if ($typeId < 1) {
                http_response_code(400);
                echo json_encode(['success' => false, 'message' => 'Invalid discount type ID.']);
                exit;
            }

            // Soft delete only — preserve history.
            $stmt = $pdo->prepare("SELECT name FROM discount_types WHERE discount_type_id = ?");
            $stmt->execute([$typeId]);
            $existing = $stmt->fetch(PDO::FETCH_ASSOC);
            if (!$existing) {
                http_response_code(404);
                echo json_encode(['success' => false, 'message' => 'Discount type not found.']);
                exit;
            }

            $softDelete = $pdo->prepare("UPDATE discount_types SET is_active = 0 WHERE discount_type_id = ?");
            $softDelete->execute([$typeId]);

            logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
                'DISCOUNT_TYPE_UPDATE', "Deactivated discount type \"{$existing['name']}\"",
                'discount_types', $typeId);

            echo json_encode(['success' => true]);
            exit;

        default:
            http_response_code(400);
            echo json_encode(['success' => false, 'message' => 'Unknown action.']);
            exit;
    }
} catch (Exception $e) {
    error_log('discount_types error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'An error occurred.']);
}
