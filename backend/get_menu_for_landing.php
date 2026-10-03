<?php
/**
 * Get Menu for Landing Page - House of Fries
 * Public, read-only JSON endpoint for the landing page menu.
 * Self-contained: has its own connection + path normalizer so it works
 * even if only this file is present in /backend on the live host.
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

/**
 * REQ-059: Schema-agnostic guard — check a column exists before SELECTing it,
 * so this public endpoint keeps working on DBs that predate the image_blob
 * / choices / addons schema (MySQL errors on unknown columns otherwise).
 */
function hof_landing_column_exists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?");
    $stmt->execute([$table, $column]);
    return (int)$stmt->fetchColumn() > 0;
}

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

    $cats = $pdo->query(
        "SELECT category_id, category_name FROM menu_categories WHERE status = 'Active' ORDER BY category_id"
    )->fetchAll();

    $hasItemBlob = hof_landing_column_exists($pdo, 'menu_items', 'image_blob');
    $blobCol = $hasItemBlob ? ', image_blob' : '';

    $items = $pdo->query(
        "SELECT menu_item_id, item_name, category_id, CAST(price AS DOUBLE) AS price, image_url$blobCol
         FROM menu_items
         WHERE status = 'Available'
         ORDER BY category_id, menu_item_id"
    )->fetchAll();

    // REQ-059: prefer the raw LONGBLOB photo when present — base64-encode it to
    // a data URI so the modal (and signature cards) render it directly.
    if ($hasItemBlob && file_exists(__DIR__ . '/image_blob_helper.php')) {
        require_once __DIR__ . '/image_blob_helper.php';
        if (function_exists('hof_encode_blob_columns')) {
            // keepMissing=true: preserve the image_blob key — the helper writes the
            // data URI into the SAME key, and unsetting it would hide the blob from JS.
            hof_encode_blob_columns($items, ['image_blob' => 'image_blob'], true);
        }
    }

    // REQ-059: choices + add-ons (informational for the modal).
    // Graceful: missing tables/columns never kill the endpoint.
    $choices = [];
    $addons = [];
    try {
        $hasChoiceBlob = hof_landing_column_exists($pdo, 'menu_item_choices', 'image_blob');
        $hasAddonBlob  = hof_landing_column_exists($pdo, 'menu_item_addons', 'image_blob');

        $choiceBlobCol = $hasChoiceBlob ? ', image_blob' : '';
        $choicesStmt = $pdo->query(
            "SELECT menu_choice_id, menu_item_id, group_name, choice_name$choiceBlobCol
             FROM menu_item_choices
             WHERE status = 'Active'
             ORDER BY sort_order, menu_choice_id"
        );
        $choicesByItem = [];
        foreach ($choicesStmt->fetchAll() as $row) {
            $id = (int)$row['menu_item_id'];
            if (!isset($choicesByItem[$id])) { $choicesByItem[$id] = []; }
            $group = $row['group_name'];
            if (!isset($choicesByItem[$id][$group])) { $choicesByItem[$id][$group] = []; }
            $choicesByItem[$id][$group][] = [
                'menu_choice_id' => (int)$row['menu_choice_id'],
                'choice_name'    => $row['choice_name'],
                'image_blob'     => $row['image_blob'] ?? null,
            ];
        }
        foreach ($choicesByItem as &$groups) {
            foreach ($groups as &$options) {
                if (function_exists('hof_encode_blob_columns')) {
                    hof_encode_blob_columns($options, ['image_blob' => 'image_blob'], true);
                }
            }
            unset($options);
        }
        unset($groups);
        foreach ($choicesByItem as $itemId => $groups) {
            $list = [];
            foreach ($groups as $groupName => $options) {
                $list[] = ['group_name' => $groupName, 'options' => $options];
            }
            $choices[] = ['menu_item_id' => $itemId, 'groups' => $list];
        }

        $addonBlobCol = $hasAddonBlob ? ', image_blob' : '';
        $addonsStmt = $pdo->query(
            "SELECT menu_addon_id, addon_name, price$addonBlobCol
             FROM menu_item_addons
             WHERE status = 'Active'
             ORDER BY sort_order"
        );
        $addons = $addonsStmt->fetchAll();
        foreach ($addons as &$a) {
            $a['menu_addon_id'] = (int)$a['menu_addon_id'];
            $a['price'] = (float)$a['price'];
        }
        unset($a);
        if (function_exists('hof_encode_blob_columns')) {
            hof_encode_blob_columns($addons, ['image_blob' => 'image_blob'], true);
        }
    } catch (Throwable $e) {
        error_log('get_menu_for_landing choices/addons degrade: ' . $e->getMessage());
        $choices = [];
        $addons = [];
    }

    // Prefer optimized WebP thumb (/landing/images/m/…) when it exists,
    // otherwise fall back to the original root-absolute /images/menu/<file>.
    foreach ($items as &$it) {
        $u = trim((string)$it['image_url']);
        if ($u === '') { $it['image_url'] = null; continue; }
        if (preg_match('#^https?://#i', $u)) continue; // external URL: leave as-is
        $file = basename(parse_url($u, PHP_URL_PATH) ?: $u);
        if ($file === '') { $it['image_url'] = null; continue; }
        $base  = substr(pathinfo($file, PATHINFO_FILENAME), 0, 40);
        $base  = str_replace(' ', '_', $base);
        $thumb = '/landing/images/m/' . $base . '.webp';
        if (file_exists($_SERVER['DOCUMENT_ROOT'] . $thumb)) {
            $it['image_url'] = $thumb;
        } else {
            $it['image_url'] = '/images/menu/' . str_replace(' ', '%20', $file);
        }
    }
    unset($it);

    echo json_encode(
        ['success' => true, 'categories' => $cats, 'items' => $items, 'choices' => $choices, 'addons' => $addons],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE
    );
} catch (Exception | PDOException $e) {
    http_response_code(500);
    echo json_encode(['success' => false, 'message' => 'Failed to load menu']);
}
