<?php
/**
 * ============================================================
 * HOF Requirement #70 helper - shared temp-code generator
 * 6-character code (uppercase + digits, ambiguous I/O/0/1 excluded
 * so it is easy to read aloud or type on a phone).
 * ============================================================
 */

if (!function_exists('hof_generate_temp_code')) {
    function hof_generate_temp_code($length = 8) {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $code = '';
        $max = strlen($alphabet) - 1;
        for ($i = 0; $i < $length; $i++) {
            $code .= $alphabet[random_int(0, $max)];
        }
        return $code;
    }
}
