<?php
// backend/date_window_helper.php
// REQ-049: Supervisor 31-day rolling data-window helper.

/**
 * Enforce the Supervisor 31-day ROLLING data window (today-31 .. today).
 *
 * Signal design (explicit, no silent clamping):
 *   [
 *     'from'    => 'Y-m-d' | null,
 *     'to'      => 'Y-m-d' | null,
 *     'blocked' => bool,
 *   ]
 *
 * - blocked === true  : the requested range is OUTSIDE the window. 'from'/'to'
 *                       are null — the caller MUST emit the hard-block error
 *                       JSON and stop (never use the returned nulls as a query).
 * - blocked === false : 'from'/'to' contain the enforced range. A missing/empty
 *                       bound is defaulted to the corresponding window edge so
 *                       a Supervisor without explicit dates still only sees the
 *                       last 31 days.
 *
 * Rules that mark a range as blocked:
 *   - dateFrom < today-31
 *   - dateFrom > today
 *   - dateTo   < today-31
 *   - dateTo   > today
 *   - span (dateTo - dateFrom) > 31 days
 *   - dateFrom > dateTo (inverted range)
 *   - malformed date value
 */
function hof_month_window(?string $dateFrom, ?string $dateTo): array
{
    $today = new DateTimeImmutable(date('Y-m-d'));
    $minDate = $today->modify('-31 days');

    $minStr = $minDate->format('Y-m-d');
    $maxStr = $today->format('Y-m-d');

    $from = ($dateFrom !== null && $dateFrom !== '') ? $dateFrom : null;
    $to   = ($dateTo   !== null && $dateTo   !== '') ? $dateTo   : null;

    // Validate format strictly (Y-m-d). Note: createFromFormat without a time
    // part keeps the CURRENT time-of-day, so never compare DateTime objects
    // built this way — compare the normalized 'Y-m-d' strings instead.
    if ($from !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
        return ['from' => null, 'to' => null, 'blocked' => true];
    }
    if ($to !== null && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
        return ['from' => null, 'to' => null, 'blocked' => true];
    }

    // Sanity-check that 'Y-m-d' is a real calendar date (e.g. rejects 2026-02-31).
    if ($from !== null) {
        $d = DateTimeImmutable::createFromFormat('Y-m-d', $from);
        if ($d === false || $d->format('Y-m-d') !== $from) {
            return ['from' => null, 'to' => null, 'blocked' => true];
        }
    }
    if ($to !== null) {
        $d = DateTimeImmutable::createFromFormat('Y-m-d', $to);
        if ($d === false || $d->format('Y-m-d') !== $to) {
            return ['from' => null, 'to' => null, 'blocked' => true];
        }
    }

    // ISO 'Y-m-d' strings compare lexicographically == chronologically.
    if ($from !== null && ($from < $minStr || $from > $maxStr)) {
        return ['from' => null, 'to' => null, 'blocked' => true];
    }
    if ($to !== null && ($to < $minStr || $to > $maxStr)) {
        return ['from' => null, 'to' => null, 'blocked' => true];
    }
    if ($from !== null && $to !== null) {
        if ($to < $from) {
            return ['from' => null, 'to' => null, 'blocked' => true];
        }
        $span = (int)((strtotime($to) - strtotime($from)) / 86400);
        if ($span > 31) {
            return ['from' => null, 'to' => null, 'blocked' => true];
        }
    }

    return [
        'from'    => $from ?? $minStr,
        'to'      => $to   ?? $maxStr,
        'blocked' => false,
    ];
}
