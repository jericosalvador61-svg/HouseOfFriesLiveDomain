<?php
require_once __DIR__ . "/../../db.php";
require_once __DIR__ . "/../../auth_middleware.php";
$auth = authenticate(['Admin']);
require_once __DIR__ . "/../../log_activity_helper.php";
header("Content-Type: application/json");

$data = json_decode(file_get_contents("php://input"), true);
if (!is_array($data)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Invalid JSON body."]);
    exit;
}

// REQ-057: decode a base64 data-URI (strip scheme) into raw BLOB bytes.
function hof_decode_blob_upload(?string $b64): ?string
{
    if ($b64 === null || trim($b64) === '') {
        return null;
    }
    if (strpos($b64, 'base64,') !== false) {
        $b64 = substr($b64, strpos($b64, 'base64,') + 7);
    }
    $decoded = base64_decode($b64, true);
    return ($decoded !== false && $decoded !== '') ? $decoded : null;
}

try {
    $pdo->beginTransaction();

    // ── MODE A: reconcile per-item choices ─────────────────────────────
    if (isset($data['menu_item_id'])) {
        $menuItemId = (int)($data['menu_item_id'] ?? 0);
        $groups     = is_array($data['groups'] ?? null) ? $data['groups'] : [];
        $deleteIds  = is_array($data['delete_choice_ids'] ?? null) ? array_map('intval', $data['delete_choice_ids']) : [];

        if ($menuItemId < 1) {
            $pdo->rollBack();
            http_response_code(400);
            echo json_encode(["success" => false, "message" => "Menu item is required."]);
            exit;
        }

        // Verify the menu item exists (defensive; protects against stray writes)
        $check = $pdo->prepare("SELECT COUNT(*) FROM menu_items WHERE menu_item_id = ?");
        $check->execute([$menuItemId]);
        if ((int)$check->fetchColumn() < 1) {
            $pdo->rollBack();
            http_response_code(404);
            echo json_encode(["success" => false, "message" => "Menu item not found."]);
            exit;
        }

        // Current rows for this item (id => group_name), so we can reuse an
        // existing group's name when a new option has no menu_choice_id.
        $curStmt = $pdo->prepare("SELECT menu_choice_id, group_name FROM menu_item_choices WHERE menu_item_id = ?");
        $curStmt->execute([$menuItemId]);
        $curGroups = [];
        foreach ($curStmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $curGroups[(int)$row['menu_choice_id']] = $row['group_name'];
        }

        $sortIndex = 0;
        foreach ($groups as $group) {
            if (!is_array($group)) continue;
            $groupName  = trim((string)($group['group_name'] ?? ''));
            $options    = is_array($group['options'] ?? null) ? $group['options'] : [];
            if ($groupName === '' || $options === []) continue;

            foreach ($options as $option) {
                if (!is_array($option)) continue;
                $choiceName = trim((string)($option['choice_name'] ?? ''));
                if ($choiceName === '') continue;

                $choiceId = isset($option['menu_choice_id']) ? (int)$option['menu_choice_id'] : 0;

                // REQ-057: optional per-choice BLOB image (base64 data URI).
                $choiceBlob = hof_decode_blob_upload($option['image_blob'] ?? null);

                if ($choiceId > 0) {
                    // Update name + group (in case admin moved it) and preserve sort_order
                    $upd = $pdo->prepare("
                        UPDATE menu_item_choices
                        SET group_name = :group_name, choice_name = :choice_name,
                            sort_order = :sort_order, status = 'Active',
                            image_blob = COALESCE(:image_blob, image_blob)
                        WHERE menu_choice_id = :menu_choice_id AND menu_item_id = :menu_item_id
                    ");
                    $upd->execute([
                        ':group_name'      => $groupName,
                        ':choice_name'     => $choiceName,
                        ':sort_order'      => $sortIndex,
                        ':image_blob'      => $choiceBlob,
                        ':menu_choice_id'  => $choiceId,
                        ':menu_item_id'    => $menuItemId
                    ]);
                } else {
                    // New option (no id): reuse an existing group name when one
                    // matches, and reactivate a soft-deleted row of the same
                    // name+group instead of creating a duplicate.
                    $resolvedGroup = $groupName;
                    foreach ($curGroups as $existingId => $existingGroup) {
                        if (strcasecmp($existingGroup, $groupName) === 0) {
                            $resolvedGroup = $existingGroup;
                            break;
                        }
                    }

                    $existing = $pdo->prepare("
                        SELECT menu_choice_id FROM menu_item_choices
                        WHERE menu_item_id = :menu_item_id
                          AND group_name = :group_name
                          AND choice_name = :choice_name
                        ORDER BY status = 'Inactive' DESC, menu_choice_id ASC
                        LIMIT 1
                    ");
                    $existing->execute([
                        ':menu_item_id' => $menuItemId,
                        ':group_name'   => $resolvedGroup,
                        ':choice_name'  => $choiceName
                    ]);
                    $existingId = $existing->fetchColumn();

                    if ($existingId) {
                        $upd = $pdo->prepare("
                            UPDATE menu_item_choices
                            SET status = 'Active', sort_order = :sort_order,
                                image_blob = COALESCE(:image_blob, image_blob)
                            WHERE menu_choice_id = :menu_choice_id
                        ");
                        $upd->execute([
                            ':sort_order'      => $sortIndex,
                            ':image_blob'      => $choiceBlob,
                            ':menu_choice_id'  => (int)$existingId
                        ]);
                        $curGroups[(int)$existingId] = $resolvedGroup;
                    } else {
                        $ins = $pdo->prepare("
                            INSERT INTO menu_item_choices
                                (menu_item_id, group_name, choice_name, sort_order, status, image_blob)
                            VALUES
                                (:menu_item_id, :group_name, :choice_name, :sort_order, 'Active', :image_blob)
                        ");
                        $ins->execute([
                            ':menu_item_id' => $menuItemId,
                            ':group_name'   => $resolvedGroup,
                            ':choice_name'  => $choiceName,
                            ':sort_order'   => $sortIndex,
                            ':image_blob'   => $choiceBlob
                        ]);

                        $newId = (int)$pdo->lastInsertId();
                        $curGroups[$newId] = $resolvedGroup;
                    }
                }

                $sortIndex++;
            }
        }

        // Soft-delete (status='Inactive') any rows the admin removed
        $deleteStmt = null;
        foreach ($deleteIds as $choiceId) {
            if ($choiceId < 1) continue;
            if ($deleteStmt === null) {
                $deleteStmt = $pdo->prepare("
                    UPDATE menu_item_choices
                    SET status = 'Inactive'
                    WHERE menu_choice_id = ? AND menu_item_id = ?
                ");
            }
            $deleteStmt->execute([$choiceId, $menuItemId]);
        }

        $pdo->commit();
        logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
            'MENU_CHOICES_UPDATE', "Updated choices for menu item #{$menuItemId}",
            'menu_item', $menuItemId, (string)$menuItemId);

        echo json_encode(["success" => true, "message" => "Choices saved."]);
        exit;
    }

    // ── MODE B: reconcile global add-ons ───────────────────────────────
    if (isset($data['addons'])) {
        $addons    = is_array($data['addons']) ? $data['addons'] : [];
        $deleteIds = is_array($data['delete_addon_ids'] ?? null) ? array_map('intval', $data['delete_addon_ids']) : [];

        $sortIndex = 0;
        foreach ($addons as $addon) {
            if (!is_array($addon)) continue;
            $addonName = trim((string)($addon['addon_name'] ?? ''));
            $price     = (float)($addon['price'] ?? 0);
            if ($addonName === '') continue;

            $addonId = isset($addon['menu_addon_id']) ? (int)$addon['menu_addon_id'] : 0;

            // REQ-057: optional per-addon BLOB image (base64 data URI).
            $addonBlob = hof_decode_blob_upload($addon['image_blob'] ?? null);

            if ($addonId > 0) {
                $upd = $pdo->prepare("
                    UPDATE menu_item_addons
                    SET addon_name = :addon_name, price = :price,
                        sort_order = :sort_order, status = 'Active',
                        image_blob = COALESCE(:image_blob, image_blob)
                    WHERE menu_addon_id = :menu_addon_id
                ");
                $upd->execute([
                    ':addon_name'    => $addonName,
                    ':price'         => $price,
                    ':sort_order'    => $sortIndex,
                    ':image_blob'    => $addonBlob,
                    ':menu_addon_id' => $addonId
                ]);
            } else {
                // Reactivate a soft-deleted add-on of the same name instead of duplicating
                $existing = $pdo->prepare("
                    SELECT menu_addon_id FROM menu_item_addons
                    WHERE addon_name = :addon_name
                    ORDER BY status = 'Inactive' DESC, menu_addon_id ASC
                    LIMIT 1
                ");
                $existing->execute([':addon_name' => $addonName]);
                $existingId = $existing->fetchColumn();

                if ($existingId) {
                    $upd = $pdo->prepare("
                        UPDATE menu_item_addons
                        SET price = :price, sort_order = :sort_order, status = 'Active',
                            image_blob = COALESCE(:image_blob, image_blob)
                        WHERE menu_addon_id = :menu_addon_id
                    ");
                    $upd->execute([
                        ':price'         => $price,
                        ':sort_order'    => $sortIndex,
                        ':image_blob'    => $addonBlob,
                        ':menu_addon_id' => (int)$existingId
                    ]);
                } else {
                    $ins = $pdo->prepare("
                        INSERT INTO menu_item_addons (addon_name, price, sort_order, status, image_blob)
                        VALUES (:addon_name, :price, :sort_order, 'Active', :image_blob)
                    ");
                    $ins->execute([
                        ':addon_name' => $addonName,
                        ':price'      => $price,
                        ':sort_order' => $sortIndex,
                        ':image_blob' => $addonBlob
                    ]);
                }
            }

            $sortIndex++;
        }

        // Soft-delete (status='Inactive') removed add-ons
        $deleteStmt = null;
        foreach ($deleteIds as $addonId) {
            if ($addonId < 1) continue;
            if ($deleteStmt === null) {
                $deleteStmt = $pdo->prepare("
                    UPDATE menu_item_addons
                    SET status = 'Inactive'
                    WHERE menu_addon_id = ?
                ");
            }
            $deleteStmt->execute([$addonId]);
        }

        $pdo->commit();
        logActivity($pdo, $auth['user_id'], $auth['username'], $auth['role'],
            'MENU_ADDONS_UPDATE', 'Updated global add-on catalog',
            'menu_addon', null, null);

        echo json_encode(["success" => true, "message" => "Add-ons saved."]);
        exit;
    }

    $pdo->rollBack();
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "No valid payload provided."]);
} catch (PDOException $e) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    error_log('save_choices error: ' . $e->getMessage());
    http_response_code(500);
    echo json_encode(["success" => false, "message" => "Failed to save. Please try again."]);
}
