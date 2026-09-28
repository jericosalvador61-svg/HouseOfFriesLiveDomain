<?php
/**
 * HOF Debug Helper — controlled error visibility
 * ------------------------------------------------
 * Every endpoint here logs the real exception with error_log() and returns a
 * generic message. On InfinityFree error_log() output is effectively invisible,
 * so a schema mismatch (e.g. an UPDATE against a column that does not exist)
 * surfaced to the user as nothing but "Failed to update ...".
 *
 * This helper lets the REAL message reach the browser ONLY when debugging is
 * explicitly enabled, and never by default.
 *
 * Enable locally (never on the live host):
 *   set the environment variable HOF_DEBUG=1
 *
 * @package HOF
 */

if (!defined('HOF_DEBUG')) {
    define('HOF_DEBUG', getenv('HOF_DEBUG') === '1' || getenv('HOF_DEBUG') === 'true');
}

if (!function_exists('hof_debug_detail')) {
    /**
     * Extra payload fields to merge into a JSON error response.
     * Returns [] in production so no SQL/table detail ever leaks to a client.
     *
     * @param Throwable $e
     * @return array
     */
    function hof_debug_detail($e)
    {
        if (!HOF_DEBUG) {
            return [];
        }
        return [
            'debug' => [
                'type'    => get_class($e),
                'message' => $e->getMessage(),
                'file'    => $e->getFile() . ':' . $e->getLine(),
            ],
        ];
    }
}
