<?php
/**
 * HOF Kitchen API - Menu Availability Toggle
 * GET: list all menu items with status
 * POST: {menu_item_id, status} — toggle between 'Available' and 'Unavailable'
 * Broadcasts on hof-menu channel, menu-availability-changed event.
 */
header('Content-Type: application/json');
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../auth_middleware.php';
require_once __DIR__ . '/../pusher_helper.php';
require_once __DIR__ . '/../log_activity_helper.php';
require_once __DIR__ . '/../debug_helper.php';

$auth = authenticate(['Kitchen Staff', 'Supervisor', 'Admin']);
$userId = (int)$auth['user_id'];
$username = $auth['username'] ?? 'unknown';
$role = $auth['role'] ?? '';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    try {
        $stmt = $pdo->query("
            SELECT mi.menu_item_id, mi.item_name, mi.description, mi.image_url, mi.price, mi.status,
                   mc.category_name
            FROM menu_items mi
            JOIN menu_categories mc ON mi.category_id = mc.category_id
            ORDER BY mc.category_name, mi.item_name
        ");
        $items = $stmt->fetchAll(PDO::FETCH_ASSOC);
        echo json_encode(['success' => true, 'items' => $items]);
    } catch (Exception $e) {
        error_log('menu_availability GET error: ' . $e->getMessage());
        echo json_encode(['success' => false, 'message' => 'Failed to load menu.']);
    }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $data = json_decode(file_get_contents('php://input'), true);
    $menuItemId = (int)($data['menu_item_id'] ?? 0);
    $newStatus = trim($data['status'] ?? '');

    if (!$menuItemId || !in_array($newStatus, ['Available', 'Unavailable'], true)) {
        echo json_encode(['success' => false, 'message' => 'Invalid menu_item_id or status.']);
        exit;
    }

    try {
        $pdo->beginTransaction();

        $stmt = $pdo->prepare("SELECT item_name, status FROM menu_items WHERE menu_item_id = ?");
        $stmt->execute([$menuItemId]);
        $item = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$item) {
            $pdo->rollBack();
            echo json_encode(['success' => false, 'message' => 'Menu item not found.']);
            exit;
        }

        $oldStatus = $item['status'];
        if ($oldStatus === $newStatus) {
            $pdo->rollBack();
            echo json_encode(['success' => true, 'message' => 'Status unchanged.', 'item_name' => $item['item_name'], 'status' => $newStatus]);
            exit;
        }

        $updateStmt = $pdo->prepare("UPDATE menu_items SET status = ? WHERE menu_item_id = ?");
        $updateStmt->execute([$newStatus, $menuItemId]);

        $pdo->commit();

        logActivity($pdo, $userId, $username, $role, 'MENU_STATUS_CHANGE',
            "Changed '{$item['item_name']}' from {$oldStatus} to {$newStatus}",
            'menu_item', $menuItemId, null, $newStatus);

        broadcastMenuUpdate($menuItemId, $newStatus, $item['item_name']);

        echo json_encode(['success' => true, 'message' => "{$item['item_name']} is now {$newStatus}.", 'item_name' => $item['item_name'], 'status' => $newStatus]);
    } catch (Exception $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('menu_availability POST error: ' . $e->getMessage());
        echo json_encode(array_merge(
            ['success' => false, 'message' => 'Failed to update menu item status.'],
            hof_debug_detail($e)
        ));
    }
    exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'message' => 'Method not allowed.']);