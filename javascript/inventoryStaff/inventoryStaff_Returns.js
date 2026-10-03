// ==========================================
// RETURNS - Inventory Staff Module
// Items COMING BACK from kitchen → raw inventory (adds to stock)
// Consistent flow: staging table → duplicate detection → review modal → pending
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    let allReturnsRecords = [];
    let returnsItems = [];
    let returnsPage = 1;
    let returnsTotal = 0;

    function renderReturnsPager() {
        const pagerEl = document.getElementById('returnsPager');
        if (!pagerEl) return;
        const pages = Math.max(1, Math.ceil(returnsTotal / 10));
        let html = '';
        for (let i = 1; i <= pages; i++) {
            html += `<li class="page-item ${i === returnsPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
        }
        pagerEl.innerHTML = html;
        pagerEl.querySelectorAll('a[data-page]').forEach(a => {
            a.addEventListener('click', e => {
                e.preventDefault();
                returnsPage = parseInt(a.dataset.page, 10);
                fetchReturnsHistory();
            });
        });
    }

    // --- 1. INITIAL LOAD ---
    fetchMaterialsAndStats();
    fetchReturnsHistory();

    const inputMaterial = document.getElementById('inputMaterial');
    const addToListBtn = document.getElementById('addToListBtn');
    const returnsForm = document.getElementById('returnsForm');
    const returnsStagingBody = document.getElementById('returnsStagingBody');
    const returnsStagingContainer = document.getElementById('returnsStagingContainer');

    const searchInput = document.getElementById("searchInventory");
    const statusFilter = document.getElementById("filterStatus");
    const dateFilter = document.getElementById("filterDate");
    if (searchInput) searchInput.addEventListener("input", applyReturnsFilters);
    if (statusFilter) statusFilter.addEventListener("change", applyReturnsFilters);
    if (dateFilter) dateFilter.addEventListener("change", applyReturnsFilters);

    function getAuthHeaders(contentType) {
        const token = localStorage.getItem("hof_token");
        const headers = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (contentType) headers["Content-Type"] = contentType;
        return headers;
    }

    function fetchMaterialsAndStats() {
        fetch("/backend/inventoryStaff/InventoryStaffDashboard/get_raw_materials.php", {
            method: "GET", headers: getAuthHeaders(null)
        })
            .then(r => r.json())
            .then(result => {
                const materials = Array.isArray(result) ? result : (result.data || []);
                const stats = result.stats || { total: 0, low: 0, out: 0, damaged: 0 };
                updateCount('totalItems', stats.total);
                updateCount('lowStock', stats.low);
                updateCount('outStock', stats.out);
                updateCount('damagedStock', stats.damaged);
                checkStockAlerts(result.data);

                if (inputMaterial && materials.length > 0) {
                    inputMaterial.innerHTML = '<option value="" selected disabled>Select Material...</option>';
                    materials.forEach(m => {
                        const stock = parseFloat(m.current_quantity);
                        const batchSum = parseFloat(m.available_batch_sum) || stock;
                        const truth = Math.min(stock, batchSum);
                        const diff = Math.abs(stock - batchSum) > 0.001;
                        const suffix = diff ? ' (inconsistent)' : '';
                        const opt = document.createElement('option');
                        opt.value = m.raw_material_id;
                        opt.dataset.name = m.raw_material_name;
                        opt.dataset.unit = m.unit || '';
                        opt.dataset.cost = m.cost_per_unit || 0;
                        opt.textContent = `${m.raw_material_name} (${truth} ${m.unit}${suffix})`;
                        inputMaterial.appendChild(opt);
                    });
                }
            })
            .catch(err => console.error('Error fetching materials:', err));
    }

    function fetchReturnsHistory() {
        const tableBody = document.getElementById('returnsTableBody');
        if (!tableBody) return;
        fetch("/backend/inventoryStaff/InventoryStaffDashboard/get_returns.php?page=" + returnsPage, {
            method: "GET", headers: getAuthHeaders(null)
        })
            .then(r => r.json())
            .then(result => {
                if (result.success) {
                    allReturnsRecords = result.data || [];
                    returnsTotal = (result.pagination && result.pagination.total) || allReturnsRecords.length;
                    renderReturnsRows(allReturnsRecords);
                    renderReturnsPager();
                }
            })
            .catch(err => console.error('Error fetching returns:', err));
    }

    function applyReturnsFilters() {
        if (!allReturnsRecords || allReturnsRecords.length === 0) return;
        const searchValue = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const statusValue = statusFilter ? statusFilter.value.toLowerCase().trim() : "";
        const dateValue = dateFilter ? dateFilter.value : "";

        const filtered = allReturnsRecords.filter(row => {
            const ref = (row.reference_number || '').toLowerCase();
            const reason = (row.reason || '').toLowerCase();
            const itemsStr = (row.items || []).map(i => (i.material || '').toLowerCase()).join(' ');
            const matchesSearch = ref.includes(searchValue) || reason.includes(searchValue) || itemsStr.includes(searchValue);
            const currentStatus = (row.status || 'Pending').toLowerCase().trim();
            let matchesStatus = !statusValue || currentStatus === statusValue;
            if (!matchesStatus && statusValue === 'approved') matchesStatus = currentStatus === 'approved';
            else if (!matchesStatus && statusValue === 'pending') matchesStatus = currentStatus === 'pending';
            else if (!matchesStatus && statusValue === 'rejected') matchesStatus = currentStatus === 'rejected';
            const pureDate = row.return_date ? row.return_date.split(' ')[0] : '';
            return matchesSearch && matchesStatus && (!dateValue || pureDate === dateValue);
        });
        renderReturnsRows(filtered);
    }

    function renderReturnsRows(dataArray) {
        const tableBody = document.getElementById('returnsTableBody');
        if (!tableBody) return;
        if (!dataArray || dataArray.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-5 text-muted">No return records found.</td></tr>`;
            return;
        }
        tableBody.innerHTML = '';
        dataArray.forEach(row => {
            const items = row.items || [];
            const fd = row.return_date ? new Date(row.return_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
            let badge = 'bg-warning text-dark';
            const s = (row.status || '').toLowerCase();
            if (s === 'approved') badge = 'bg-success text-white';
            else if (s === 'rejected') badge = 'bg-danger text-white';

            if (items.length === 0) {
                tableBody.innerHTML += `<tr>
                    <td class="ps-4"><span class="fw-bold">${row.reference_number || 'N/A'}</span></td>
                    <td colspan="2" class="text-muted">No items</td>
                    <td>${row.return_type || 'OTHER'}</td>
                    <td>${row.reason || ''}</td>
                    <td class="text-end pe-4">${fd}</td>
                    <td><span class="badge ${badge}">${row.status || 'Pending'}</span></td>
                </tr>`;
            } else {
                items.forEach((item, idx) => {
                    const isFirst = idx === 0;
                    tableBody.innerHTML += `<tr>
                        <td class="ps-4">${isFirst ? `<span class="fw-bold">${row.reference_number || 'N/A'}</span>` : ''}</td>
                        <td>${item.material || 'Unknown'}</td>
                        <td><span class="badge bg-light text-dark border">${item.quantity || 0} ${item.unit || ''}</span></td>
                        <td>${isFirst ? (row.return_type || 'OTHER') : ''}</td>
                        <td>${isFirst ? (row.reason || '') : ''}</td>
                        <td class="text-end pe-4">${isFirst ? fd : ''}</td>
                        <td>${isFirst ? `<span class="badge ${badge}">${row.status || 'Pending'}</span>` : ''}</td>
                    </tr>`;
                });
            }
        });
    }

    // --- AUTO-POPULATE UNIT COST ON MATERIAL SELECT ---
    if (inputMaterial) {
        inputMaterial.addEventListener('change', function () {
            const selected = this.options[this.selectedIndex];
            const cost = selected ? parseFloat(selected.dataset.cost) || 0 : 0;
            const costInput = document.getElementById('inputCost');
            if (costInput) costInput.value = cost.toFixed(2);
            const qty = parseFloat(document.getElementById('inputQty')?.value) || 0;
            const totalInput = document.getElementById('inputTotal');
            if (totalInput) totalInput.value = (qty * cost).toFixed(2);
        });
    }

    const qtyInput = document.getElementById('inputQty');
    if (qtyInput) {
        qtyInput.addEventListener('input', function () {
            const qty = parseFloat(this.value) || 0;
            const cost = parseFloat(document.getElementById('inputCost')?.value) || 0;
            const totalInput = document.getElementById('inputTotal');
            if (totalInput) totalInput.value = (qty * cost).toFixed(2);
        });
    }

    // ==========================================
    // ADD ITEM TO STAGING (with duplicate detection)
    // ==========================================
    if (addToListBtn) {
        addToListBtn.addEventListener('click', function () {
            const materialId = inputMaterial.value;
            const opt = inputMaterial.options[inputMaterial.selectedIndex];
            const materialName = opt?.dataset?.name || (opt ? opt.text.split('(')[0].trim() : '');
            const unit = opt?.dataset?.unit || '';
            const type = document.getElementById('inputType').value;
            const qty = parseFloat(document.getElementById('inputQty').value);
            const cost = parseFloat(document.getElementById('inputCost').value) || 0;

            if (!materialId || !qty || qty <= 0) {
                Swal.fire({ title: 'Error', text: 'Select material and enter a valid quantity.', icon: 'warning', confirmButtonColor: '#FFB800' });
                return;
            }

            // Duplicate detection (like Stock In)
            const existing = returnsItems.find(i => i.material_id === materialId);
            if (existing) {
                Swal.fire({
                    title: 'Already Added',
                    text: `"${materialName}" is already in your list. Combine quantities?`,
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, merge!',
                    confirmButtonColor: '#FFB800'
                }).then(result => {
                    if (result.isConfirmed) {
                        existing.quantity += qty;
                        existing.unit_cost = (existing.unit_cost + cost) / 2; // average cost
                        renderStaging();
                    }
                });
                return;
            }

            returnsItems.push({ material_id: materialId, material_name: materialName, unit, type, quantity: qty, unit_cost: cost });
            renderStaging();
            inputMaterial.value = '';
            document.getElementById('inputQty').value = '';
            document.getElementById('inputCost').value = '';
            document.getElementById('inputTotal').value = '0.00';
        });
    }

    function renderStaging() {
        if (!returnsStagingBody || !returnsStagingContainer) return;
        returnsStagingContainer.classList.toggle('d-none', returnsItems.length === 0);
        returnsStagingBody.innerHTML = '';
        returnsItems.forEach((item, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.material_name}</td>
                <td>${item.type}</td>
                <td>${item.quantity} ${item.unit}</td>
                <td>₱${item.unit_cost.toFixed(2)}</td>
                <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger remove-staging-item" data-index="${i}"><i class="bi bi-trash"></i></button></td>
            `;
            returnsStagingBody.appendChild(tr);
        });
        returnsStagingBody.querySelectorAll('.remove-staging-item').forEach(btn => {
            btn.onclick = function () {
                returnsItems.splice(parseInt(this.dataset.index), 1);
                renderStaging();
            };
        });
    }

    // ==========================================
    // FORM SUBMIT → REVIEW MODAL
    // ==========================================
    if (returnsForm) {
        returnsForm.addEventListener('submit', function (e) {
            e.preventDefault();
            if (returnsItems.length === 0) {
                Swal.fire({ title: 'Empty List', text: 'Add at least one item first.', icon: 'warning', confirmButtonColor: '#FFB800' });
                return;
            }

            let itemsHtml = returnsItems.map(item => `
                <tr>
                    <td class="fw-bold">${item.material_name}</td>
                    <td>${item.type}</td>
                    <td>${item.quantity} ${item.unit}</td>
                    <td>₱${item.unit_cost.toFixed(2)}</td>
                </tr>
            `).join('');

            const date = document.getElementById('returnsDateDefault')?.value || 'N/A';
            const reason = document.querySelector('input[name="reason"]')?.value || '';

            Swal.fire({
                title: 'Review Return',
                html: `
                    <div class="text-start">
                        <table class="table table-sm table-borderless mb-2">
                            <tr><td class="text-muted">Date:</td><td class="fw-bold">${date}</td></tr>
                            <tr><td class="text-muted">Reason:</td><td class="fw-bold">${reason || '—'}</td></tr>
                        </table>
                        <hr>
                        <h6 class="fw-bold text-success">Items to be RETURNED to raw inventory:</h6>
                        <div class="table-responsive" style="max-height:200px;overflow-y:auto;">
                            <table class="table table-sm table-bordered">
                                <thead class="table-light"><tr><th>Material</th><th>Type</th><th>Qty</th><th>Cost</th></tr></thead>
                                <tbody>${itemsHtml}</tbody>
                            </table>
                        </div>
                    </div>`,
                icon: 'success',
                showCancelButton: true,
                confirmButtonColor: '#FFB800',
                confirmButtonText: '<i class="bi bi-check-lg"></i> Confirm Return',
                cancelButtonText: 'Cancel',
                width: '550px'
            }).then(result => {
                if (!result.isConfirmed) return;

                const submitBtn = returnsForm.querySelector('button[type="submit"]');
                if (typeof LoadingManager !== 'undefined') {
                    LoadingManager.show(submitBtn || returnsForm, { text: 'Submitting...' });
                }

                const payload = {
                    return_date: date,
                    reason: reason,
                    return_type: document.getElementById('inputType')?.value || 'OTHER',
                    items: returnsItems.map(item => ({
                        raw_material_id: item.material_id,
                        quantity: item.quantity,
                        unit_cost: item.unit_cost
                    }))
                };

                fetch("/backend/inventoryStaff/InventoryStaffDashboard/add_return.php", {
                    method: "POST", headers: getAuthHeaders('application/json'),
                    body: JSON.stringify(payload)
                })
                    .then(r => r.json())
                    .then(result => {
                        if (result.success) {
                            Swal.fire({ icon: 'success', title: 'Success', text: result.message, confirmButtonColor: '#FFB800' }).then(() => location.reload());
                        } else {
                            Swal.fire({ icon: 'error', title: 'Error', text: result.message, confirmButtonColor: '#FFB800' });
                        }
                    })
                    .catch(err => { console.error(err); Swal.fire({ icon: 'error', title: 'Error', text: 'Server error.', confirmButtonColor: '#FFB800' }); })
                    .finally(() => {
                        if (typeof LoadingManager !== 'undefined') {
                            LoadingManager.hide(submitBtn || returnsForm);
                        }
                    });
            });
        });
    }

    function updateCount(id, val) { const el = document.getElementById(id); if (el) el.textContent = val || 0; }

    function checkStockAlerts(materialsList) {
        const badge = document.getElementById('notificationBadge');
        const menu = document.getElementById('notificationMenu');
        if (!menu || !badge || !Array.isArray(materialsList)) return;
        let alerts = [];
        materialsList.forEach(m => {
            const qty = parseFloat(m.current_quantity);
            const rl = parseFloat(m.reorder_level);
            let alertText = "";
            let isCritical = false;
            if (!isNaN(qty) && !isNaN(rl)) {
                if (qty <= 0) { alertText = `⚠️ <strong>${m.raw_material_name}</strong> is out of stock!`; isCritical = true; }
                else if (qty <= rl) { alertText = `⚠️ <strong>${m.raw_material_name}</strong> is low (${qty} ${m.unit || 'pcs'} left).`; }
            }
            if (alertText) alerts.push({ text: alertText, isCritical, updatedAt: m.updated_at ? new Date(m.updated_at).getTime() : 0 });
        });
        menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';
        if (alerts.length > 0) {
            alerts.sort((a, b) => b.updatedAt - a.updatedAt);
            alerts.forEach(a => { menu.innerHTML += `<li><a class="dropdown-item py-2 border-bottom text-wrap" href="inventoryStaff_RawMaterials.html"><div style="color:${a.isCritical ? '#dc3545' : '#b57d00'};">${a.text}</div></a></li>`; });
            badge.textContent = alerts.length; badge.classList.remove('d-none');
        } else { badge.classList.add('d-none'); menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All normal.</span></li>`; }
    }

    // Initialize date
    const dateInput = document.getElementById('returnsDateDefault');
    if (dateInput) dateInput.valueAsDate = new Date();
});