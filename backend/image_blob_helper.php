<?php
/**
 * ============================================================
 * backend/image_blob_helper.php  (REQ-057)
 * ------------------------------------------------------------
 * Shared helper for LONGBLOB image columns (menu_items.image_blob,
 * raw_materials.image_blob, menu_item_choices.image_blob,
 * menu_item_addons.image_blob, spoilage.photo).
 *
 * PDO returns LONGBLOB values as raw binary strings. This helper
 * base64-encodes them so JSON responses can render the image as a
 * data URI (data:image/jpeg;base64,...) without ever interpolating
 * raw bytes. Consumers on the JS side use HOFImage.blobSrc().
 * ============================================================
 */

if (!function_exists('hof_blob_data_uri')) {
    /**
     * Convert a raw LONGBLOB binary value into a data-URI string.
     * Returns null for empty values (avoids huge base64 for NULL/'').
     */
    function hof_blob_data_uri(?string $blob): ?string
    {
        if ($blob === null || $blob === '') {
            return null;
        }
        return 'data:image/jpeg;base64,' . base64_encode($blob);
    }
}

if (!function_exists('hof_encode_blob_columns')) {
    /**
     * In-place base64-encode listed BLOB columns on a row array.
     * $cols is a map of column => output field:
     *   ['image_blob' => 'image_blob']  (same name)
     *   ['photo' => 'photo_data_uri']   (renamed output)
     * Unset columns are removed unless $keepMissing is true.
     */
    function hof_encode_blob_columns(array &$rows, array $cols, bool $keepMissing = false): void
    {
        foreach ($rows as &$row) {
            foreach ($cols as $dbCol => $outCol) {
                $raw = isset($row[$dbCol]) ? $row[$dbCol] : null;
                if ($raw !== null && $raw !== '') {
                    $row[$outCol] = hof_blob_data_uri($raw);
                } else {
                    $row[$outCol] = null;
                }
                if (!$keepMissing) {
                    unset($row[$dbCol]);
                }
            }
        }
        unset($row);
    }
}
