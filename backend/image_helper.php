<?php
/**
 * ============================================================
 * House of Fries - Image URL Normalizer
 * ------------------------------------------------------------
 * Menu image paths in the DB are inconsistent across imports:
 *   /HOF1/images/menu/fries.png     (legacy local folder)
 *   images/menu/fries.jpg           (relative)
 *   /images/menu/fries.png          (correct root-absolute)
 *
 * The production site is deployed at the DOMAIN ROOT, so this
 * helper rewrites everything to /images/<folder>/<filename>.
 * Missing files simply fall through - <img onerror> handles it.
 * ============================================================
 */

if (!function_exists('hof_normalize_image')) {
    function hof_normalize_image($url, $folder = 'menu') {
        if (empty($url)) return null;

        $url = trim((string)$url);

        // Already a full external URL - leave untouched
        if (preg_match('#^https?://#i', $url)) return $url;

        // Extract just the filename (handles any legacy prefix depth)
        $filename = basename(parse_url($url, PHP_URL_PATH) ?: $url);

        if ($filename === '' || $filename === '/') return null;

        return '/images/' . $folder . '/' . $filename;
    }
}

if (!function_exists('hof_normalize_menu_images')) {
    /**
     * Normalize the image_url column of an array of menu rows in-place.
     */
    function hof_normalize_menu_images(array &$items) {
        foreach ($items as &$item) {
            if (array_key_exists('image_url', $item)) {
                $item['image_url'] = hof_normalize_image($item['image_url'], 'menu');
            }
        }
        unset($item);
    }
}
