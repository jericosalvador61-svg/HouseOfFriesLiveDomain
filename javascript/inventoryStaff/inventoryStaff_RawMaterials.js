/* =====================================================
   MANAGE INVENTORY — RAW MATERIALS ONLY
===================================================== */

/* ===================== DOM & GLOBALS ===================== */
const tbody = document.getElementById("inventoryTableBody");
const thead = document.getElementById("inventoryThead");
const searchInput = document.getElementById("searchInventory");
const statusFilter = document.getElementById("filterStatus");

let allRawMaterials = []; // Master list from DB
let tempMaterials = [];   // Staging for Modal

/* ===================== UTIL ===================== */
async function fetchJSON(url, options = {}) {
    const res = await fetch(url, options);
    const text = await res.text();
    try { return JSON.parse(text); }
    catch (err) { console.error("Invalid JSON:", text); throw new Error("Server error"); }
}

/* ===================== RENDER LOGIC ===================== */
let currentRawPage = 1;

function renderPager(totalRows, perPage, pagerEl) {
    if (!pagerEl) return;
    const pages = Math.max(1, Math.ceil(totalRows / perPage));
    let html = '';
    for (let i = 1; i <= pages; i++) {
        html += `<li class="page-item ${i === currentRawPage ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
    }
    pagerEl.innerHTML = html;
    pagerEl.querySelectorAll('a[data-page]').forEach(a => {
        a.addEventListener('click', e => {
            e.preventDefault();
            currentRawPage = parseInt(a.dataset.page, 10);
            loadRawMaterials();
        });
    });
}

function renderTable(data) {
    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4 text-muted">No materials match your criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    data.forEach(mat => {
        const qty = parseFloat(mat.current_quantity) || 0;
        const reorderLevel = parseFloat(mat.reorder_level) || 0;
        const tr = document.createElement('tr');

        // Determine Status Styling based on Stock Levels
        let rowClass = '';
        if (qty <= 0) {
            rowClass = 'table-danger';
        } else if (qty <= reorderLevel) {
            rowClass = 'table-warning';
        } else {
            rowClass = 'table-success';
        }

        tr.className = rowClass;

        const isPerishable = (mat.is_perishable == 1 || mat.is_perishable === 'Yes');
        const perishableBadge = isPerishable
            ? '<span class="badge bg-success">Yes</span>'
            : '<span class="badge bg-danger">No</span>';

        tr.innerHTML = `
            <td><img src="${mat.image_blob ? 'data:image/jpeg;base64,' + mat.image_blob : '/' + (mat.img_url || 'images/placeholder.png')}" class="rounded border bg-white" width="40" alt="icon"></td>
            <td class="fw-bold">${mat.raw_material_name}</td>
            <td>${mat.description || '-'}</td>
            <td>${mat.unit}</td>
            <td class="fw-bold">${qty.toFixed(2)}</td> 
            <td>${reorderLevel}</td>
            <td>${perishableBadge}</td>
            <td><span class="badge ${mat.status === 'ACTIVE' ? 'bg-success' : 'bg-secondary'}">${mat.status}</span></td>
            <td>
                <button class="btn btn-sm btn-light border bg-white" onclick="viewMaterialBatches(${mat.raw_material_id}, '${mat.raw_material_name.replace(/'/g, "\\'")}')" title="View Stock Batches">
                    <i class="bi bi-eye text-primary"></i>
                </button>
                <button class="btn btn-sm btn-light border bg-white d-none js-material-edit-btn" onclick="openEditModal(${mat.raw_material_id})">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-light border text-danger bg-white d-none js-material-delete-btn" onclick="deleteMaterial(${mat.raw_material_id}, '${mat.raw_material_name.replace(/'/g, "\\'")}')">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/* ===================== VIEW BATCHES MODAL ===================== */
function viewMaterialBatches(materialId, materialName) {
    Swal.fire({
        title: 'Loading Batch Records...',
        allowOutsideClick: false,
        didOpen: () => { Swal.showLoading(); }
    });

    // Fetches from your existing endpoint
    fetch(`/backend/inventoryStaff/rawMaterials/get_material_batches.php?raw_material_id=${materialId}`)
        .then(res => res.json())
        .then(response => {
            if (response.status !== 'success') {
                throw new Error(response.message || 'Failed to fetch batches.');
            }

            // FIX: Changed from response.data to response.batches to match your PHP file layout
            const batches = response.batches || [];
            if (batches.length === 0) {
                Swal.fire({
                    title: materialName,
                    html: '<p class="text-muted my-3">There are currently no active incoming stock batches logged for this material.</p>',
                    icon: 'info',
                    confirmButtonColor: '#ffc107'
                });
                return;
            }

            let batchRowsHtml = '';
            batches.forEach(batch => {
                const batchQty = parseFloat(batch.quantity) || 0;

                // Formats your expiration_date column
                const expDate = batch.expiration_date
                    ? new Date(batch.expiration_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'N/A';

                // FIX: Mapped to your actual backend column 'stock_in_date'
                const deliveryDate = batch.stock_in_date
                    ? new Date(batch.stock_in_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    : 'Unknown';

                // Color batch row badge context if near expiration or expired
                const daysLeft = parseInt(batch.days_left);
                let expBadgeClass = 'bg-dark';
                if (!isNaN(daysLeft)) {
                    if (daysLeft <= 0) expBadgeClass = 'bg-danger';
                    else if (daysLeft <= 7) expBadgeClass = 'bg-warning text-dark';
                }

                batchRowsHtml += `
                    <div class="d-flex flex-column border-bottom py-2 text-start fs-6">
                        <div class="d-flex justify-content-between align-items-center mb-1">
                            <span class="fw-bold text-dark">Stock In #${batch.reference_number}</span>
                            <span class="badge bg-warning text-dark fw-bold">${batchQty.toFixed(2)}</span>
                        </div>
                        <div class="text-muted row g-0" style="font-size: 0.85rem;">
                            <div class="col-6"><strong>Received:</strong> ${deliveryDate}</div>
                            <div class="col-6 text-end"><strong>Expires:</strong> <span class="badge ${expBadgeClass}">${expDate}</span></div>
                        </div>
                    </div>`;
            });

            Swal.fire({
                title: `<span class="fs-5 fw-bold">${materialName}</span><br><small class="text-muted fs-6">Active Batch Inventory Breakdown</small>`,
                html: `<div class="mt-3 px-1" style="max-height: 350px; overflow-y: auto;">${batchRowsHtml}</div>`,
                confirmButtonText: 'Close Window',
                confirmButtonColor: '#1a1512',
                width: '480px'
            });
        })
        .catch(err => {
            console.error("Batch Fetch Failure:", err);
            Swal.fire('Error', 'Could not load active batches. Please check backend connection.', 'error');
        });
}

/* ===================== EDIT & DELETE ACTIONS ===================== */

async function openEditModal(id) {
    const mat = allRawMaterials.find(m => m.raw_material_id == id);
    if (!mat) return;

    await Swal.fire({
        title: 'Edit Raw Material',
        html: `
            <div id="swalEditContainer" class="text-start" style="font-family: Arial, sans-serif;">
                <div class="row">
                    <div class="col-md-6 border-end pr-3">
                        <label class="form-label small fw-bold">Material Name *</label>
                        <input id="edit_raw_material_name" class="form-control mb-2" value="${mat.raw_material_name}">
                        
                        <label class="form-label small fw-bold">Description</label>
                        <textarea id="edit_description" class="form-control mb-2" style="height: 100px;">${mat.description || ''}</textarea>
                        
                        <label class="form-label small fw-bold">Image Upload / URL</label>
                        <div class="input-group mb-2">
                            <input type="file" id="edit_img_file" class="form-control form-control-sm" accept="image/*">
                            <span class="input-group-text small">OR</span>
                            <input type="text" id="edit_img_url" class="form-control form-control-sm" placeholder="Paste URL" value="${mat.img_url || ''}">
                        </div>
                        
                        <div class="border rounded d-flex align-items-center justify-content-center bg-light" style="height: 150px;">
                            <img id="edit_imagePreview" src="/HOF1/${mat.img_url || 'images/placeholder.png'}" alt="Preview" class="img-fluid rounded" style="max-height: 100%;">
                        </div>
                    </div>

                    <div class="col-md-6 pl-3">
                        <label class="form-label small fw-bold">Unit *</label>
                        <select id="edit_unit" class="form-select form-select-sm mb-2">
                            <option value="">Select Unit</option>
                            <option value="Kilogram (kg)">Kilogram (kg)</option>
                            <option value="Pieces (pcs)">Pieces (pcs)</option>
                            <option value="Grams (g)">Grams (g)</option>
                            <option value="Milliliters (ml)">Milliliters (ml)</option>
                            <option value="Pack (pk)">Pack (pk)</option>
                        </select>

                        <div class="row">
                            <div class="col-6">
                                <label class="form-label small fw-bold">Current Qty</label>
                                <input type="number" id="edit_current_quantity" class="form-control form-control-sm mb-2" value="${mat.current_quantity}" readonly>
                            </div>
                            <div class="col-6">
                                <label class="form-label small fw-bold">Reorder Level</label>
                                <input type="number" id="edit_reorder_level" class="form-control form-control-sm mb-2" value="${mat.reorder_level}">
                            </div>
                        </div>

                        <label class="form-label small fw-bold">Cost Per Unit (₱)</label>
                        <input type="number" id="edit_cost_per_unit" class="form-control form-control-sm mb-2" step="0.01" value="${parseFloat(mat.cost_per_unit || 0).toFixed(2)}">

                        <div class="form-check form-switch mb-2">
                            <input class="form-check-input" type="checkbox" id="edit_track" 
                                ${(mat.expiration_tracking == 1 || mat.expiration_tracking === 'Yes') ? 'checked' : ''}>
                            <label class="form-check-label small fw-bold">Track Expiration</label>
                        </div>

                        <div class="form-check form-switch">
                            <input class="form-check-input" type="checkbox" id="edit_perish" 
                                ${(mat.is_perishable == 1 || mat.is_perishable === 'Yes') ? 'checked' : ''}>
                            <label class="form-check-label small fw-bold">Perishable Item</label>
                        </div>
                    </div>
                </div>
            </div>
        `,
        width: '800px',
        focusConfirm: false,
        showCancelButton: true,
        confirmButtonText: 'Save Changes',
        confirmButtonColor: '#7a61e3',
        didOpen: () => {
            const unitSelect = document.getElementById('edit_unit');
            const dbUnit = mat.unit ? mat.unit.toLowerCase() : "";

            Array.from(unitSelect.options).forEach(option => {
                const optVal = option.value.toLowerCase();
                if (dbUnit && (optVal === dbUnit || optVal.includes(`(${dbUnit})`) || dbUnit.includes(optVal))) {
                    option.selected = true;
                }
            });

            const fileInput = document.getElementById('edit_img_file');
            const urlInput = document.getElementById('edit_img_url');
            const preview = document.getElementById('edit_imagePreview');

            fileInput.addEventListener('change', function () {
                const file = this.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = e => preview.src = e.target.result;
                    reader.readAsDataURL(file);
                }
            });

            urlInput.addEventListener('input', function () {
                if (this.value.trim() !== '') {
                    preview.src = this.value.trim();
                } else {
                    preview.src = `/HOF1/${mat.img_url || 'images/placeholder.png'}`;
                }
            });
        },
        preConfirm: () => {
            return {
                raw_material_id: id,
                raw_material_name: document.getElementById('edit_raw_material_name').value.trim(),
                description: document.getElementById('edit_description').value,
                unit: document.getElementById('edit_unit').value,
                reorder_level: document.getElementById('edit_reorder_level').value,
                cost_per_unit: document.getElementById('edit_cost_per_unit').value,
                expiration_tracking: document.getElementById('edit_track').checked ? 'Yes' : 'No',
                is_perishable: document.getElementById('edit_perish').checked ? 'Yes' : 'No',
                img_url: document.getElementById('edit_img_url').value.trim(),
                img_file: document.getElementById('edit_img_file').files[0]
            }
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            const val = result.value;
            if (!val.raw_material_name || !val.unit) {
                Swal.fire('Error', 'Material Name and Unit are required.', 'error');
                return;
            }

            const formData = new FormData();
            Object.keys(val).forEach(key => {
                if (key === 'img_file') {
                    if (val[key]) formData.append('img_file', val[key]);
                } else {
                    formData.append(key, val[key]);
                }
            });

            try {
                const json = await fetchJSON('/backend/inventoryStaff/rawMaterials/update_raw_materials.php', {
                    method: 'POST',
                    body: formData
                });

                if (json.status === 'success') {
                    Swal.fire('Updated!', 'Inventory has been updated.', 'success');
                    loadRawMaterials();
                } else {
                    throw new Error(json.message);
                }
            } catch (err) {
                Swal.fire('Error', err.message, 'error');
            }
        }
    });
}

async function deleteMaterial(id, name) {
    const result = await Swal.fire({
        title: `Deactivate ${name}?`,
        text: "The material will be moved to INACTIVE status.",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: 'Yes, deactivate!'
    });

    if (result.isConfirmed) {
        try {
            const formData = new FormData();
            formData.append('raw_material_id', id);

            const json = await fetchJSON('/backend/inventoryStaff/rawMaterials/delete_raw_material.php', {
                method: 'POST',
                body: formData
            });

            if (json.status === 'success') {
                Swal.fire('Deactivated!', 'Material is now INACTIVE.', 'success');
                loadRawMaterials();
            } else {
                throw new Error(json.message);
            }
        } catch (err) {
            Swal.fire('Error', err.message, 'error');
        }
    }
}

/* ===================== FILTER LOGIC ===================== */
function handleFilter() {
    const searchTerm = searchInput.value.toLowerCase();
    const statusType = statusFilter.value;

    const filtered = allRawMaterials.filter(mat => {
        const nameMatch = mat.raw_material_name.toLowerCase().includes(searchTerm);
        const statusMatch = (statusType === "") || (mat.status === statusType);
        return nameMatch && statusMatch;
    });

    renderTable(filtered);
}

/* ===================== FETCH DATA ===================== */
async function loadRawMaterials() {
    try {
        const json = await fetchJSON('/backend/inventoryStaff/rawMaterials/get_materials.php?page=' + currentRawPage);
        if (json.status !== 'success') throw new Error(json.message);

        allRawMaterials = json.data;
        // REQ-068: default filter = Active (inactive hidden on first paint)
        renderTable(allRawMaterials.filter(m => (m.status || '') === 'ACTIVE'));
        renderPager(json.pagination ? json.pagination.total : allRawMaterials.length, 10, document.getElementById('rawMaterialsPager'));

        // Process Notifications inside the same data response stream!
        checkStockAlerts(allRawMaterials);

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Error loading data.</td></tr>`;
    }
}

/* ===================== ADD MATERIAL MODULE ===================== */
function initAddMaterial() {
    const form = document.getElementById('addMaterialForm');
    const tempTableBody = document.querySelector('#tempMaterialTable tbody');
    const addAnotherBtn = document.getElementById('addAnotherBtn');

    const fileInput = document.getElementById('materialFile');
    const urlInput = document.getElementById('materialUrl');
    const previewImg = document.getElementById('imagePreviewDisplay');
    const previewPlaceholder = document.getElementById('previewPlaceholder');
    const clearBtn = document.getElementById('clearPreview');

    function updatePreview(src) {
        if (src) {
            previewImg.src = src;
            previewImg.classList.remove('d-none');
            previewPlaceholder.classList.add('d-none');
            clearBtn.classList.remove('d-none');
        } else {
            previewImg.src = "#";
            previewImg.classList.add('d-none');
            previewPlaceholder.classList.remove('d-none');
            clearBtn.classList.add('d-none');
        }
    }

    fileInput?.addEventListener('change', function () {
        const file = this.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = e => {
                updatePreview(e.target.result);
                urlInput.value = '';
            };
            reader.readAsDataURL(file);
        }
    });

    urlInput?.addEventListener('input', function () {
        if (this.value.trim() !== '') {
            updatePreview(this.value.trim());
            fileInput.value = '';
        } else {
            updatePreview(null);
        }
    });

    clearBtn?.addEventListener('click', () => {
        form.reset();
        updatePreview(null);
    });

    addAnotherBtn?.addEventListener('click', () => {
        const formData = new FormData(form);
        const name = formData.get('raw_material_name')?.trim();
        const unit = formData.get('unit');

        if (!name || !unit) return Swal.fire('Error', 'Name and Unit are required', 'error');

        const material = {
            name, unit,
            current_quantity: formData.get('current_quantity') || 0,
            cost_per_unit: formData.get('cost_per_unit') || 0,
            reorder_level: formData.get('reorder_level') || 0,
            description: formData.get('description') || '',
            status: 'ACTIVE',
            is_perishable: document.getElementById('perishable').checked ? 'Yes' : 'No',
            expiration_tracking: document.getElementById('expTrack').checked ? 'Yes' : 'No',
            img_file: fileInput.files[0] || null,
            img_url: urlInput.value.trim()
        };

        tempMaterials.push(material);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${material.name}</td>
            <td>${material.unit}</td>
            <td>${material.current_quantity}</td>
            <td>₱${parseFloat(material.cost_per_unit).toFixed(2)}</td>
            <td class="text-center"><button type="button" class="btn btn-sm btn-outline-danger remove-btn"><i class="bi bi-trash"></i></button></td>
        `;

        tr.querySelector('.remove-btn').onclick = () => {
            tempMaterials = tempMaterials.filter(m => m !== material);
            tr.remove();
        };

        tempTableBody.appendChild(tr);

        form.reset();
        updatePreview(null);
    });

    form?.addEventListener('submit', async e => {
        e.preventDefault();
        if (!tempMaterials.length) return Swal.fire('Notice', 'Add items to the list first', 'info');

        const submitBtn = form.querySelector('button[type="submit"]');
        LoadingManager.show(submitBtn || form, { text: 'Saving materials...' });

        const batchForm = new FormData();
        tempMaterials.forEach((mat, i) => {
            batchForm.append(`raw_material_name[${i}]`, mat.name);
            batchForm.append(`description[${i}]`, mat.description);
            batchForm.append(`unit[${i}]`, mat.unit);
            batchForm.append(`current_quantity[${i}]`, mat.current_quantity);
            batchForm.append(`reorder_level[${i}]`, mat.reorder_level);
            batchForm.append(`cost_per_unit[${i}]`, mat.cost_per_unit);
            batchForm.append(`status[${i}]`, mat.status);
            batchForm.append(`expiration_tracking[${i}]`, mat.expiration_tracking);
            batchForm.append(`is_perishable[${i}]`, mat.is_perishable);
            batchForm.append(`img_url[${i}]`, mat.img_url);
            if (mat.img_file) batchForm.append(`img_file[${i}]`, mat.img_file);
        });

        const json = await fetchJSON('/backend/inventoryStaff/rawMaterials/add_raw_material.php', { method: 'POST', body: batchForm });
        LoadingManager.hide(submitBtn || form);
        Swal.fire(json.status === 'success' ? 'Saved!' : 'Error', json.message, json.status).then(() => {
            if (json.status === 'success') location.reload();
        });
    });
}

/* ===================== NOTIFICATION LIVE ALERTS ===================== */
function checkStockAlerts(materialsList) {
    const badge = document.getElementById('notificationBadge');
    const menu = document.getElementById('notificationMenu');
    if (!menu || !badge || !Array.isArray(materialsList)) return;

    let activeAlerts = [];

    materialsList.forEach(material => {
        const qty = parseFloat(material.current_quantity) || 0;
        const reorderLevel = parseFloat(material.reorder_level) || 0;

        let alertText = "";
        let isCritical = false;

        if (qty <= 0) {
            alertText = `⚠️ <strong>${material.raw_material_name}</strong> is completely out of stock! Restock immediately.`;
            isCritical = true;
        } else if (qty <= reorderLevel) {
            alertText = `⚠️ <strong>${material.raw_material_name}</strong> is low on stock (${qty} ${material.unit} left). Restock soon!`;
            isCritical = false;
        }

        if (alertText) {
            activeAlerts.push({
                text: alertText,
                isCritical: isCritical,
                updatedAt: material.updated_at ? new Date(material.updated_at).getTime() : 0
            });
        }
    });

    // Reset dropdown menu structure
    menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';

    if (activeAlerts.length > 0) {
        // Facebook Style: Sort strictly by modification date timestamps (latest on top)
        activeAlerts.sort((a, b) => b.updatedAt - a.updatedAt);

        activeAlerts.forEach(alert => {
            menu.innerHTML += `
                <li>
                    <a class="dropdown-item py-2 border-bottom text-wrap" href="inventoryStaff_RawMaterials.html" style="font-size: 0.9rem;">
                        <div style="color: ${alert.isCritical ? '#dc3545' : '#b57d00'};">
                            ${alert.text}
                        </div>
                    </a>
                </li>`;
        });

        // Set the badge count and keep it permanently visible
        badge.textContent = activeAlerts.length;
        badge.classList.remove('d-none');

    } else {
        // Hide badge only if there are absolutely zero alerts active in the system
        badge.classList.add('d-none');
        menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All inventory levels are normal.</span></li>`;
    }
}

/* ===================== INIT ===================== */
document.addEventListener('DOMContentLoaded', () => {
    thead.innerHTML = `
        <tr>
            <th>Image</th>
            <th>Material Name</th>
            <th>Description</th>
            <th>Unit</th>
            <th>Current Qty</th>
            <th>Reorder Level</th>
            <th>Perishable</th>
            <th>Status</th>
            <th>Action</th>
        </tr>`;

    // Core initialization routines
    initAddMaterial();
    loadRawMaterials(); // checkStockAlerts handles everything safely inside here!

    // Table filters
    searchInput.addEventListener('input', handleFilter);
    statusFilter.addEventListener('change', handleFilter);
});