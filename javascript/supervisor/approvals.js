// ==========================================
// House of Fries - Supervisor Approvals
// ==========================================

const APP_ROOT = (() => {
    const path = window.location.pathname;
    const match = path.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
    return match && match[1] ? match[1] : '';
})();

const API_BASE = `${APP_ROOT}/backend/supervisor/`;
const token = localStorage.getItem('hof_token');

function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
    const isGet = options.method === 'GET' || !options.method;
    const fetchOptions = {
        ...options,
        headers: { ...headers, ...options.headers },
    };
    if (!isGet && options.body) {
        fetchOptions.body = JSON.stringify(options.body);
    }
    return fetch(url, fetchOptions).then(res => res.json());
}

function escapeHtml(text) {
    if (!text) return '';
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}

function statusPill(status) {
    if (!status) return '<span class="badge bg-secondary">UNKNOWN</span>';
    const map = {
        'PENDING': 'bg-warning text-dark',
        'APPROVED': 'bg-success',
        'REJECTED': 'bg-danger'
    };
    const cls = map[status.toUpperCase()] || 'bg-secondary';
    return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function formatPeso(amount) {
    const num = parseFloat(amount) || 0;
    return '₱' + num.toFixed(2);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const d = new Date(dateString);
    return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

document.addEventListener("DOMContentLoaded", () => {
    loadApprovals();
});

async function loadApprovals(type = 'all') {
    try {
        const data = await apiFetch(`get_approvals.php?type=${type}`);
        if (!data.success) return;

        // Stock In Requests
        const siTbody = document.getElementById('siTableBody');
        if (siTbody && data.data.stock_in) {
            if (data.data.stock_in.length === 0) {
                siTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No stock-in requests</td></tr>';
            } else {
                siTbody.innerHTML = data.data.stock_in.map(r => `
                    <tr>
                        <td class="fw-semibold">#SI-${r.request_id}</td>
                        <td>${r.item_count || 0} items</td>
                        <td>${formatPeso(r.total_cost)}</td>
                        <td>${escapeHtml(r.submitted_by || 'System')}</td>
                        <td>${statusPill(r.status)}</td>
                        <td>
                            ${r.status === 'PENDING' ? `
                                <button class="btn btn-sm btn-success" onclick="handleApproval('stock_in', ${r.request_id}, 'APPROVED')"><i class="bi bi-check-lg"></i></button>
                                <button class="btn btn-sm btn-outline-danger" onclick="handleApproval('stock_in', ${r.request_id}, 'REJECTED')"><i class="bi bi-x-lg"></i></button>
                            ` : '<span class="text-muted">&mdash;</span>'}
                        </td>
                    </tr>
                `).join('');
            }
        }

        // Stock Out Requests
        const soTbody = document.getElementById('soTableBody');
        if (soTbody && data.data.stock_out) {
            if (data.data.stock_out.length === 0) {
                soTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No stock-out requests</td></tr>';
            } else {
                soTbody.innerHTML = data.data.stock_out.map(r => `
                    <tr>
                        <td class="fw-semibold">#SO-${r.request_id}</td>
                        <td>${escapeHtml(r.reason || '-')}</td>
                        <td>${escapeHtml(r.submitted_by || 'System')}</td>
                        <td>${statusPill(r.status)}</td>
                        <td>${formatDate(r.submitted_at)}</td>
                        <td>
                            ${r.status === 'PENDING' ? `
                                <button class="btn btn-sm btn-success" onclick="handleApproval('stock_out', ${r.request_id}, 'APPROVED')"><i class="bi bi-check-lg"></i></button>
                                <button class="btn btn-sm btn-outline-danger" onclick="handleApproval('stock_out', ${r.request_id}, 'REJECTED')"><i class="bi bi-x-lg"></i></button>
                            ` : '<span class="text-muted">&mdash;</span>'}
                        </td>
                    </tr>
                `).join('');
            }
        }

        // Spoilage Reports
        const spTbody = document.getElementById('spTableBody');
        if (spTbody && data.data.spoilage) {
            if (data.data.spoilage.length === 0) {
                spTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No spoilage reports</td></tr>';
            } else {
                spTbody.innerHTML = data.data.spoilage.map(r => `
                    <tr>
                        <td class="fw-semibold">#SP-${r.request_id}</td>
                        <td>${escapeHtml(r.item_name)}</td>
                        <td>${r.quantity || 0}</td>
                        <td>${escapeHtml(r.reason || '-')}</td>
                        <td>${escapeHtml(r.submitted_by || 'System')}</td>
                        <td>${statusPill(r.status)}</td>
                        <td>
                            ${r.status === 'PENDING' ? `
                                <button class="btn btn-sm btn-success" onclick="handleApproval('spoilage', ${r.request_id}, 'APPROVED')"><i class="bi bi-check-lg"></i></button>
                                <button class="btn btn-sm btn-outline-danger" onclick="handleApproval('spoilage', ${r.request_id}, 'REJECTED')"><i class="bi bi-x-lg"></i></button>
                            ` : '<span class="text-muted">&mdash;</span>'}
                        </td>
                    </tr>
                `).join('');
            }
        }

        // Inventory Adjustments
        const adjTbody = document.getElementById('adjTableBody');
        if (adjTbody && data.data.inventory) {
            if (data.data.inventory.length === 0) {
                adjTbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-4">No inventory adjustments</td></tr>';
            } else {
                adjTbody.innerHTML = data.data.inventory.map(a => `
                    <tr>
                        <td class="fw-semibold">#ADJ-${a.request_id}</td>
                        <td>${escapeHtml(a.item_name)}</td>
                        <td><span class="badge ${(a.adjustment_type || '').toLowerCase() === 'add' ? 'bg-success' : 'bg-danger'}">${escapeHtml(a.adjustment_type)}</span></td>
                        <td>${a.change_amount || 0}</td>
                        <td>${escapeHtml(a.reason || '-')}</td>
                        <td>${statusPill(a.status)}</td>
                        <td>${formatDate(a.submitted_at)}</td>
                        <td>
                            ${a.status === 'PENDING' ? `
                                <button class="btn btn-sm btn-success" onclick="handleApproval('inv', ${a.request_id}, 'APPROVED')"><i class="bi bi-check-lg"></i></button>
                                <button class="btn btn-sm btn-outline-danger" onclick="handleApproval('inv', ${a.request_id}, 'REJECTED')"><i class="bi bi-x-lg"></i></button>
                            ` : '<span class="text-muted">&mdash;</span>'}
                        </td>
                    </tr>
                `).join('');
            }
        }

        // Purchase Plans
        const ppTbody = document.getElementById('ppTableBody');
        if (ppTbody && data.data.purchase_plans) {
            if (data.data.purchase_plans.length === 0) {
                ppTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">No purchase plans</td></tr>';
            } else {
                ppTbody.innerHTML = data.data.purchase_plans.map(p => `
                    <tr>
                        <td class="fw-semibold">Plan #${p.request_id}</td>
                        <td>${p.item_count || 0} items</td>
                        <td>${formatPeso(p.total_estimated_cost || 0)}</td>
                        <td>${escapeHtml(p.submitted_by || 'System')}</td>
                        <td>${statusPill(p.status)}</td>
                        <td>
                            ${p.status === 'PENDING' ? `
                                <button class="btn btn-sm btn-success" onclick="handleApproval('purchase_plan', ${p.request_id}, 'APPROVED')"><i class="bi bi-check-lg"></i></button>
                                <button class="btn btn-sm btn-outline-danger" onclick="handleApproval('purchase_plan', ${p.request_id}, 'REJECTED')"><i class="bi bi-x-lg"></i></button>
                            ` : '<span class="text-muted">&mdash;</span>'}
                        </td>
                    </tr>
                `).join('');
            }
        }
    } catch (e) { console.error('Failed to load approvals:', e); }
}

async function handleApproval(type, requestId, status) {
    try {
        const data = await apiFetch(`update_approval.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: { type, request_id: requestId, status }
        });
        
        if (data.success) {
            Swal.fire({ icon: 'success', title: status === 'APPROVED' ? 'Approved' : 'Rejected', timer: 1500, showConfirmButton: false });
            loadApprovals();
        } else {
            Swal.fire({ icon: 'error', title: 'Error', text: data.message || 'Failed to update' });
        }
    } catch (e) {
        Swal.fire({ icon: 'error', title: 'Error', text: 'Network error' });
    }
}