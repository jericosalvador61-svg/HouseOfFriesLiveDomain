/**
 * House of Fries - Admin Voids Dashboard
 * Lists every voided item with live filters (status / search / date range),
 * summary stats, pagination and CSV export.
 */
const VoidsUI = (function () {
    'use strict';

    const API = '/backend/admin/voids/get_voids.php';

    const state = {
        page: 1,
        limit: 20,
        filters: { search: '', status: '', dateFrom: '', dateTo: '' },
        isLoading: false
    };

    let el = {};

    function cacheElements() {
        el = {
            tableBody: document.getElementById('voidsTableBody'),
            search: document.getElementById('voidSearch'),
            status: document.getElementById('voidStatus'),
            dateFrom: document.getElementById('voidDateFrom'),
            dateTo: document.getElementById('voidDateTo'),
            pageInfo: document.getElementById('voidsPageInfo'),
            pagination: document.getElementById('voidsPagination'),
            statTotalItems: document.getElementById('statTotalItems'),
            statTotalValue: document.getElementById('statTotalValue'),
            statRequests: document.getElementById('statRequests'),
            statPending: document.getElementById('statPending')
        };
    }

    function buildQuery(extra = {}) {
        const p = new URLSearchParams({
            page: state.page,
            limit: state.limit,
            search: state.filters.search,
            status: state.filters.status,
            date_from: state.filters.dateFrom,
            date_to: state.filters.dateTo,
            ...extra
        });
        const token = localStorage.getItem('hof_token');
        return p.toString();
    }

    async function loadData() {
        if (state.isLoading) return;
        state.isLoading = true;
        showLoading();

        try {
            const res = await fetch(`${API}?${buildQuery()}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('hof_token') || ''}` }
            });
            const data = await res.json();

            if (data.success) {
                renderStats(data.stats);
                renderTable(data.items);
                renderPagination(data.pagination);
            } else {
                showError(data.message || 'Failed to load voids.');
            }
        } catch (err) {
            console.error('Voids load error:', err);
            showError('Could not reach the server. Please try again.');
        } finally {
            state.isLoading = false;
        }
    }

    function renderStats(stats) {
        if (!stats) return;
        el.statTotalItems.textContent = stats.total_items ?? 0;
        el.statTotalValue.textContent = '₱' + formatNumber(stats.total_voided_value);
        el.statRequests.textContent = stats.total_requests ?? 0;
        el.statPending.textContent = stats.pending_requests ?? 0;
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            el.tableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center py-5 text-muted">
                        <i class="bi bi-slash-circle fs-1 d-block mb-2 opacity-25"></i>
                        No voided items found for the selected filters.
                    </td>
                </tr>`;
            el.pageInfo.textContent = 'No results';
            el.pagination.innerHTML = '';
            return;
        }

        el.tableBody.innerHTML = items.map(item => `
            <tr>
                <td class="fw-semibold text-dark">${escapeHtml(item.reference_number || ('#' + item.order_id))}</td>
                <td>
                    <div class="fw-semibold">${escapeHtml(item.item_name)}</div>
                    ${item.reason ? `<div class="reason-cell text-muted" style="font-size:.72rem;" title="${escapeHtml(item.reason)}">${escapeHtml(item.reason)}</div>` : ''}
                </td>
                <td class="text-center fw-bold">${item.void_qty}</td>
                <td class="text-end text-muted">₱${formatNumber(item.unit_price)}</td>
                <td class="text-end fw-bold text-danger">₱${formatNumber(item.voided_amount)}</td>
                <td><span class="status-badge status-${(item.status || '').toLowerCase()}">${escapeHtml(item.status)}</span></td>
                <td class="reason-cell text-muted" title="${escapeHtml(item.reason || '')}">${escapeHtml(item.reason || '—')}</td>
                <td>
                    <div class="fw-semibold">${escapeHtml(item.requested_by_name || '—')}</div>
                    <div class="text-muted" style="font-size:.7rem;">${escapeHtml(item.requester_role || '')}</div>
                </td>
                <td class="text-muted" style="font-size:.76rem;">
                    ${formatDateTime(item.requested_at)}
                    ${item.approved_by_name ? `<div style="font-size:.68rem;"><i class="bi bi-check2 me-1"></i>${escapeHtml(item.approved_by_name)}</div>` : ''}
                </td>
            </tr>
        `).join('');
    }

    function renderPagination(p) {
        if (!p) return;
        el.pageInfo.textContent = `Showing ${p.total === 0 ? 0 : (p.page - 1) * p.limit + 1}–${Math.min(p.page * p.limit, p.total)} of ${p.total} voided items`;
        el.pagination.innerHTML = `
            <button class="btn btn-sm btn-light border me-1" ${p.page <= 1 ? 'disabled' : ''} onclick="VoidsUI.goToPage(${p.page - 1})">
                <i class="bi bi-chevron-left"></i>
            </button>
            <span class="small text-muted mx-2">Page ${p.page} of ${p.total_pages}</span>
            <button class="btn btn-sm btn-light border ms-1" ${p.page >= p.total_pages ? 'disabled' : ''} onclick="VoidsUI.goToPage(${p.page + 1})">
                <i class="bi bi-chevron-right"></i>
            </button>
        `;
    }

    function showLoading() {
        el.tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-5 text-muted">
                    <div class="spinner-border spinner-border-sm text-warning me-2" role="status"></div>
                    Loading voided items...
                </td>
            </tr>`;
    }

    function showError(message) {
        el.tableBody.innerHTML = `
            <tr>
                <td colspan="9" class="text-center py-5">
                    <div class="text-danger">
                        <i class="bi bi-exclamation-triangle fs-1 d-block mb-2"></i>
                        ${escapeHtml(message)}
                        <button class="btn btn-sm btn-outline-warning mt-2" onclick="VoidsUI.loadData()">
                            <i class="bi bi-arrow-clockwise me-1"></i> Retry
                        </button>
                    </div>
                </td>
            </tr>`;
    }

    function applyFilters() {
        state.filters.search = el.search.value.trim();
        state.filters.status = el.status.value;
        state.filters.dateFrom = el.dateFrom.value;
        state.filters.dateTo = el.dateTo.value;
        state.page = 1;
        loadData();
    }

    function clearFilters() {
        state.filters = { search: '', status: '', dateFrom: '', dateTo: '' };
        el.search.value = '';
        el.status.value = '';
        el.dateFrom.value = '';
        el.dateTo.value = '';
        state.page = 1;
        loadData();
    }

    function goToPage(page) {
        state.page = page;
        loadData();
    }

    function exportCSV() {
        window.open(`${API}?${buildQuery({ export: 'csv' })}`, '_blank');
    }

    function formatNumber(num) {
        return parseFloat(num || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function formatDateTime(str) {
        if (!str) return '—';
        try {
            const d = new Date(String(str).replace(' ', 'T'));
            return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
                   d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return str; }
    }

    function escapeHtml(s) {
        const div = document.createElement('div');
        div.textContent = s == null ? '' : String(s);
        return div.innerHTML;
    }

    // ============ INIT ============
    document.addEventListener('DOMContentLoaded', function () {
        cacheElements();

        let searchDebounce;
        el.search.addEventListener('input', () => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(applyFilters, 350);
        });
        el.search.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
        el.status.addEventListener('change', applyFilters);
        el.dateFrom.addEventListener('change', applyFilters);
        el.dateTo.addEventListener('change', applyFilters);

        loadData();
    });

    return { loadData, applyFilters, clearFilters, goToPage, exportCSV };
})();
