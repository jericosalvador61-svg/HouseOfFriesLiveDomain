// ==========================================
// SPOILAGE / DAMAGE - Inventory Staff Module
// LOSS from raw stock OR kitchen → deducts inventory
// Consistent flow: staging table → duplicate detection → review modal → pending
// ==========================================
document.addEventListener('DOMContentLoaded', function () {
    let allSpoilageRecords = [];
    let spoilageItems = [];

    // --- 1. INITIAL LOAD ---
    fetchMaterialsAndStats();
    fetchSpoilageHistory();

    const inputMaterial = document.getElementById('inputMaterial');
    const addToListBtn = document.getElementById('addToListBtn');
    const spoilageForm = document.getElementById('spoilageForm');
    const spoilageStagingBody = document.getElementById('spoilageStagingBody');
    const spoilageStagingContainer = document.getElementById('spoilageStagingContainer');

    // Search/filter
    const searchInput = document.getElementById("searchInventory");
    const statusFilter = document.getElementById("filterStatus");
    const dateFilter = document.getElementById("filterDate");
    if (searchInput) searchInput.addEventListener("input", applySpoilageFilters);
    if (statusFilter) statusFilter.addEventListener("change", applySpoilageFilters);
    if (dateFilter) dateFilter.addEventListener("change", applySpoilageFilters);

    function getAuthHeaders(contentType = "application/json") {
        const token = localStorage.getItem("hof_token");
        const headers = { "Authorization": `Bearer ${token}` };
        if (contentType) headers["Content-Type"] = contentType;
        return headers;
    }

    function fetchMaterialsAndStats() {
        fetch("/backend/inventoryStaff/spoilage/get_materials.php", {
            method: "GET", headers: getAuthHeaders(null)
        })
            .then(r => r.json())
            .then(result => {
                if (result.status === 'success' || result.success) {
                    const stats = result.stats;
                    updateCount('totalItems', stats.total);
                    updateCount('lowStock', stats.low);
                    updateCount('outStock', stats.out);
                    updateCount('damagedStock', stats.damaged);
                    checkStockAlerts(result.data);
                    if (inputMaterial && Array.isArray(result.data)) {
                        inputMaterial.innerHTML = '<option value="" selected disabled>Select Material...</option>';
                        result.data.forEach(material => {
                            const stock = parseFloat(material.current_quantity);
                            const batchSum = parseFloat(material.available_batch_sum) || stock;
                            const truth = Math.min(stock, batchSum);
                            const diff = Math.abs(stock - batchSum) > 0.001;
                            const suffix = diff ? ' (inconsistent)' : '';
                            const opt = document.createElement('option');
                            opt.value = material.raw_material_id;
                            opt.dataset.name = material.raw_material_name;
                            opt.dataset.unit = material.unit;
                            opt.textContent = `${material.raw_material_name} (${truth} ${material.unit} available${suffix})`;
                            inputMaterial.appendChild(opt);
                        });
                    }
                }
            })
            .catch(err => console.error('Error fetching stats:', err));
    }

    function fetchSpoilageHistory() {
        const tableBody = document.getElementById('spoilageTableBody');
        if (!tableBody) return;

        fetch("/backend/inventoryStaff/spoilage/get_spoilage_history.php", {
            method: "GET", headers: getAuthHeaders(null)
        })
            .then(r => r.json())
            .then(result => {
                if (result.status === 'success' || result.success) {
                    allSpoilageRecords = result.data || [];
                    renderSpoilageRows(allSpoilageRecords);
                }
            })
            .catch(err => console.error('Error fetching spoilage:', err));
    }

    function applySpoilageFilters() {
        if (!allSpoilageRecords || allSpoilageRecords.length === 0) return;
        const searchValue = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const statusValue = statusFilter ? statusFilter.value.toLowerCase().trim() : "";
        const dateValue = dateFilter ? dateFilter.value : "";

        const filtered = allSpoilageRecords.filter(row => {
            const matchesSearch = (row.raw_material_name || '').toLowerCase().includes(searchValue);
            const currentStatus = (row.status || "Pending").toLowerCase().trim();
            let matchesStatus = !statusValue;
            if (statusValue === "approved" && currentStatus === "approved") matchesStatus = true;
            else if (statusValue === "pending" && currentStatus === "pending") matchesStatus = true;
            else if (statusValue === "rejected" && currentStatus === "rejected") matchesStatus = true;
            else if (statusValue === "in" && currentStatus === "approved") matchesStatus = true;
            else if (statusValue === "low" && currentStatus === "pending") matchesStatus = true;
            else if (statusValue === "out" && currentStatus === "rejected") matchesStatus = true;
            const pureDate = row.spoilage_date ? row.spoilage_date.split(" ")[0] : "";
            return matchesSearch && matchesStatus && (!dateValue || pureDate === dateValue);
        });
        renderSpoilageRows(filtered);
    }

    function renderSpoilageRows(dataArray) {
        const tableBody = document.getElementById('spoilageTableBody');
        if (!tableBody) return;
        if (!dataArray || dataArray.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted">No spoilage records found.</td></tr>`;
            return;
        }
        tableBody.innerHTML = '';
        dataArray.forEach(row => {
            const fd = row.spoilage_date ? new Date(row.spoilage_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
            const s = (row.status || 'Pending').toUpperCase();
            let badge = 'bg-warning text-dark';
            if (s === 'APPROVED') badge = 'bg-success text-white';
            else if (s === 'REJECTED' || s === 'CANCELLED') badge = 'bg-danger text-white';
            tableBody.innerHTML += `<tr>
                <td class="ps-4"><div class="fw-bold text-dark">${row.raw_material_name}</div><small class="text-muted">${row.remarks || ''}</small></td>
                <td><span class="badge bg-light text-danger border">${row.quantity_lost} ${row.unit || ''}</span></td>
                <td><span class="text-secondary">${row.spoilage_type}</span><br><small class="text-muted">Source: ${row.source}</small></td>
                <td class="text-end pe-4 text-muted">${fd}</td>
                <td><span class="badge ${badge}">${row.status || 'Pending'}</span></td>
                <td><button type="button" class="btn btn-sm btn-primary view-spoilage-btn" data-id="${row.spoilage_id || ''}"><i class="bi bi-eye"></i></button></td>
            </tr>`;
        });
        document.querySelectorAll('.view-spoilage-btn').forEach(btn => {
            btn.onclick = function () { showSpoilageDetailsSwal(this.getAttribute('data-id')); };
        });
    }

    function updateCount(id, val) { const el = document.getElementById(id); if (el) el.textContent = val ?? 0; }

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
            const source = document.getElementById('inputSource').value;
            const qty = parseFloat(document.getElementById('inputQty').value);

            if (!materialId || !qty || qty <= 0) {
                Swal.fire({ title: 'Error', text: 'Select material and enter a valid quantity.', icon: 'warning', confirmButtonColor: '#FFB800' });
                return;
            }

            // Duplicate detection
            const existing = spoilageItems.find(i => i.material_id === materialId);
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
                        renderStaging();
                    }
                });
                return;
            }

            spoilageItems.push({ material_id: materialId, material_name: materialName, unit, type, source, quantity: qty });
            renderStaging();
            inputMaterial.value = '';
            document.getElementById('inputQty').value = '';
        });
    }

    function renderStaging() {
        if (!spoilageStagingBody || !spoilageStagingContainer) return;
        spoilageStagingContainer.classList.toggle('d-none', spoilageItems.length === 0);
        spoilageStagingBody.innerHTML = '';
        spoilageItems.forEach((item, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.material_name}</td>
                <td>${item.type}</td>
                <td>${item.source}</td>
                <td>${item.quantity} ${item.unit}</td>
                <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger remove-staging-item" data-index="${i}"><i class="bi bi-trash"></i></button></td>
            `;
            spoilageStagingBody.appendChild(tr);
        });
        spoilageStagingBody.querySelectorAll('.remove-staging-item').forEach(btn => {
            btn.onclick = function () {
                spoilageItems.splice(parseInt(this.dataset.index), 1);
                renderStaging();
            };
        });
    }

    // ==========================================
    // FORM SUBMIT → REVIEW MODAL
    // ==========================================
    if (spoilageForm) {
        spoilageForm.addEventListener('submit', function (e) {
            e.preventDefault();
            if (spoilageItems.length === 0) {
                Swal.fire({ title: 'Empty List', text: 'Add at least one item first.', icon: 'warning', confirmButtonColor: '#FFB800' });
                return;
            }

            let itemsHtml = spoilageItems.map(item => `
                <tr>
                    <td class="fw-bold">${item.material_name}</td>
                    <td>${item.type}</td>
                    <td>${item.source}</td>
                    <td>${item.quantity} ${item.unit}</td>
                </tr>
            `).join('');

            const date = document.getElementById('spoilageDateDefault')?.value || 'N/A';
            const remarks = document.querySelector('input[name="remarks"]')?.value || '';

            Swal.fire({
                title: 'Review Spoilage / Damage',
                html: `
                    <div class="text-start">
                        <table class="table table-sm table-borderless mb-2">
                            <tr><td class="text-muted">Date:</td><td class="fw-bold">${date}</td></tr>
                            <tr><td class="text-muted">Remarks:</td><td class="fw-bold">${remarks || '—'}</td></tr>
                        </table>
                        <hr>
                        <h6 class="fw-bold">Items to record as LOST:</h6>
                        <div class="table-responsive" style="max-height:200px;overflow-y:auto;">
                            <table class="table table-sm table-bordered">
                                <thead class="table-light"><tr><th>Material</th><th>Type</th><th>Source</th><th>Qty</th></tr></thead>
                                <tbody>${itemsHtml}</tbody>
                            </table>
                        </div>
                    </div>`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#FFB800',
                confirmButtonText: '<i class="bi bi-check-lg"></i> Confirm Spoilage',
                cancelButtonText: 'Cancel',
                width: '550px'
            }).then(result => {
                if (!result.isConfirmed) return;

                const submitBtn = spoilageForm.querySelector('button[type="submit"]');
                LoadingManager.show(submitBtn || spoilageForm, { text: 'Recording...' });

                const payload = {
                    spoilage_date: date,
                    remarks: remarks,
                    items: spoilageItems.map(i => ({
                        raw_material_id: i.material_id,
                        type: i.type,
                        source: i.source,
                        quantity: i.quantity
                    }))
                };

                fetch("/backend/inventoryStaff/spoilage/record_spoilage.php", {
                    method: "POST", headers: getAuthHeaders('application/json'),
                    body: JSON.stringify(payload)
                })
                    .then(r => r.json())
                    .then(result => {
                        if (result.status === 'success' || result.success) {
                            Swal.fire({ icon: 'success', title: 'Spoilage Recorded', text: result.message, confirmButtonColor: '#FFB800' }).then(() => location.reload());
                        } else {
                            Swal.fire({ icon: 'error', title: 'Error', text: result.message, confirmButtonColor: '#FFB800' });
                        }
                    })
                    .catch(err => { console.error(err); Swal.fire({ icon: 'error', title: 'Error', text: 'Server error.', confirmButtonColor: '#FFB800' }); })
                    .finally(() => LoadingManager.hide(submitBtn || spoilageForm));
            });
        });
    }

    function checkStockAlerts(materialsList) {
        const badge = document.getElementById('notificationBadge');
        const menu = document.getElementById('notificationMenu');
        if (!menu || !badge || !Array.isArray(materialsList)) return;
        let alerts = [];
        materialsList.forEach(m => {
            const qty = parseFloat(m.current_quantity);
            const rl = parseFloat(m.reorder_level);
            if (!isNaN(qty) && !isNaN(rl)) {
                if (qty <= 0) alerts.push({ text: `⚠️ <strong>${m.raw_material_name}</strong> is out of stock!`, critical: true });
                else if (qty <= rl) alerts.push({ text: `⚠️ <strong>${m.raw_material_name}</strong> is low (${qty} ${m.unit || 'pcs'})`, critical: false });
            }
        });
        menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';
        if (alerts.length > 0) {
            alerts.forEach(a => { menu.innerHTML += `<li><a class="dropdown-item py-2 border-bottom text-wrap" href="manage_inventory.html"><div style="color:${a.critical ? '#dc3545' : '#b57d00'};">${a.text}</div></a></li>`; });
            badge.textContent = alerts.length; badge.classList.remove('d-none');
        } else { badge.classList.add('d-none'); menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All normal.</span></li>`; }
    }

    function showSpoilageDetailsSwal(id) {
        const item = allSpoilageRecords.find(r => String(r.spoilage_id) === String(id));
        if (!item) { Swal.fire('Error', 'Record not found.', 'error'); return; }
        const fd = item.spoilage_date ? new Date(item.spoilage_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A';
        const cs = (item.status || 'Pending').toUpperCase();
        Swal.fire({
            title: 'Spoilage Details',
            html: `<div class="text-start px-2" style="font-size:0.9rem;">
                <table class="table table-sm table-borderless">
                    <tr><td class="text-muted">Material:</td><td class="fw-bold">${item.raw_material_name}</td></tr>
                    <tr><td class="text-muted">Qty Lost:</td><td class="text-danger fw-bold">${item.quantity_lost} ${item.unit || ''}</td></tr>
                    <tr><td class="text-muted">Type:</td><td>${item.spoilage_type || 'N/A'}</td></tr>
                    <tr><td class="text-muted">Source:</td><td>${item.source || 'RAW'}</td></tr>
                    <tr><td class="text-muted">Date:</td><td>${fd}</td></tr>
                    <tr><td class="text-muted">Remarks:</td><td>${item.remarks || '—'}</td></tr>
                    <tr><td class="text-muted">Status:</td><td><span class="badge ${cs === 'APPROVED' ? 'bg-success' : cs === 'PENDING' ? 'bg-warning text-dark' : 'bg-danger'}">${item.status || 'Pending'}</span></td></tr>
                </table></div>`,
            icon: cs === 'APPROVED' ? 'success' : cs === 'PENDING' ? 'info' : 'error',
            confirmButtonText: 'Close',
            confirmButtonColor: '#FFB800'
        });
    }

    // Initialize date to today
    const dateInput = document.getElementById('spoilageDateDefault');
    if (dateInput) dateInput.valueAsDate = new Date();
});