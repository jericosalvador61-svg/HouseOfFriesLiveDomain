document.addEventListener("DOMContentLoaded", () => {

    const addBtn = document.getElementById("addItemBtn");
    const tbody = document.getElementById("stockInItemBody");
    const tableContainer = document.getElementById("stockInTableContainer");
    const grandTotalEl = document.getElementById("stockInGrandTotal");
    const form = document.getElementById("stockInForm");

    const qtyInput = document.getElementById("tempQty");
    const costInput = document.getElementById("tempCost");
    const expInput = document.getElementById("tempExp");
    const materialSelect = document.getElementById("tempMaterial");
    const subtotalDisplay = document.getElementById("tempSubtotalDisplay");
    const supplierSelect = document.querySelector('select[name="supplier_id"]');

    // Live DOM Filter Elements
    const searchInput = document.getElementById("searchInventory");
    const statusFilter = document.getElementById("filterStatus");
    const dateFilter = document.getElementById("filterDate");
    const mainTbody = document.getElementById("stockinTableBody");

    let items = [];
    let allStockInRecords = []; // Global cache placeholder for filtering datasets

    // Helper function to dynamically grab token for header requests
    function getAuthHeaders(contentType = "application/json") {
        const token = localStorage.getItem("hof_token");
        const headers = { "Authorization": `Bearer ${token}` };
        if (contentType) {
            headers["Content-Type"] = contentType;
        }
        return headers;
    }

    // ==========================================
    // INITIALIZATION RUNTIME
    // ==========================================
    loadMaterialsAndStats();
    loadSuppliers();
    loadStockInRecords();
    setupFilterListeners();

    // ==========================================
    // FILTER ATTRIBUTION EVENT LISTENERS
    // ==========================================
    function setupFilterListeners() {
        if (searchInput) searchInput.addEventListener("input", applyFilters);
        if (statusFilter) statusFilter.addEventListener("change", applyFilters);
        if (dateFilter) dateFilter.addEventListener("change", applyFilters);
    }

    function applyFilters() {
        if (!allStockInRecords || allStockInRecords.length === 0) return;

        const searchValue = searchInput ? searchInput.value.toLowerCase().trim() : "";
        const statusValue = statusFilter ? statusFilter.value : "";
        const dateValue = dateFilter ? dateFilter.value : "";

        const filtered = allStockInRecords.filter(item => {
            const matchesSearch = item.raw_material_name.toLowerCase().includes(searchValue);
            const currentStatus = (item.status || "Approved").toLowerCase();
            let matchesStatus = false;

            if (statusValue === "") {
                matchesStatus = true;
            } else if (statusValue === "in" && currentStatus === "approved") {
                matchesStatus = true;
            } else if (statusValue === "low" && currentStatus === "pending") {
                matchesStatus = true;
            } else if (statusValue === "out" && (currentStatus === "rejected" || currentStatus === "cancelled")) {
                matchesStatus = true;
            }

            const pureRecordDate = item.stock_in_date ? item.stock_in_date.split(" ")[0] : "";
            const matchesDate = dateValue === "" || pureRecordDate === dateValue;

            return matchesSearch && matchesStatus && matchesDate;
        });

        renderHistoryTableHTML(filtered);
    }

    // ==========================================
    // CORE DATA FETCH: MATERIALS & CARD STATS
    // ==========================================
    async function loadSuppliers() {
        if (!supplierSelect) return;

        try {
            const res = await fetch("/backend/inventoryStaff/InventoryStaffDashboard/get_suppliers.php", {
                method: "GET",
                headers: getAuthHeaders(null)
            });
            const suppliers = await res.json();

            if (!res.ok || !Array.isArray(suppliers)) {
                throw new Error("Failed to load suppliers database.");
            }

            supplierSelect.innerHTML = '<option value="" selected disabled>Select Supplier</option>';
            suppliers.forEach(supplier => {
                const option = document.createElement("option");
                option.value = supplier.supplier_id;
                option.textContent = supplier.supplier_name;
                supplierSelect.appendChild(option);
            });
        } catch (err) {
            console.error("Supplier load error:", err);
            supplierSelect.innerHTML = '<option value="" selected disabled>Error loading suppliers</option>';
        }
    }

    async function loadMaterialsAndStats() {
        try {
            // 🔑 FIX: Securely pass token to ensure endpoint yields data context
            const res = await fetch("/backend/inventoryStaff/stockIn/get_materials.php", {
                method: "GET",
                headers: getAuthHeaders(null)
            });
            const json = await res.json();

            if (json.status === 'success' || json.success) {
                if (document.getElementById("totalItems")) document.getElementById("totalItems").textContent = json.stats?.total || 0;
                if (document.getElementById("lowStock")) document.getElementById("lowStock").textContent = json.stats?.low || 0;
                if (document.getElementById("outStock")) document.getElementById("outStock").textContent = json.stats?.out || 0;
                if (document.getElementById("damagedStock")) document.getElementById("damagedStock").textContent = json.stats?.damaged || 0;

                checkStockAlerts(json.data);

                let options = `<option value="" selected disabled>Choose Material...</option>`;
                if (Array.isArray(json.data)) {
                    json.data.forEach(mat => {
                        options += `
                            <option value="${mat.raw_material_id}" 
                                    data-name="${mat.raw_material_name}" 
                                    data-perishable="${mat.is_perishable}">
                                ${mat.raw_material_name} ${mat.unit ? '(' + mat.unit + ')' : ''}
                            </option>`;
                    });
                }
                materialSelect.innerHTML = options;

            } else {
                throw new Error(json.message || "Failed to load materials database.");
            }
        } catch (err) {
            console.error("Material load error:", err);
            if (materialSelect) materialSelect.innerHTML = `<option value="" disabled>Error loading materials</option>`;
        }
    }

    // ==========================================
    // PERISHABLE CALENDAR SELECTION LOGIC
    // ==========================================
    if (materialSelect) {
        materialSelect.addEventListener("change", function () {
            const selectedOption = this.options[this.selectedIndex];
            const isPerishable = selectedOption.dataset.perishable == "1";

            if (isPerishable) {
                expInput.disabled = false;
                expInput.classList.remove("bg-light");
            } else {
                expInput.disabled = true;
                expInput.value = "";
                expInput.classList.add("bg-light");
            }
        });
    }

    // ==========================================
    // AUTO CALCULATE ITEM COST SUBTOTALS
    // ==========================================
    function calculateTempSubtotal() {
        const qty = parseFloat(qtyInput.value) || 0;
        const cost = parseFloat(costInput.value) || 0;
        const subtotal = qty * cost;
        subtotalDisplay.value = subtotal.toFixed(2);
    }

    if (qtyInput) qtyInput.addEventListener("input", calculateTempSubtotal);
    if (costInput) costInput.addEventListener("input", calculateTempSubtotal);

    // ==========================================
    // MODAL STAGING: ADD ITEM TO STAGED BATCH
    // ==========================================
    if (addBtn) {
        addBtn.addEventListener("click", () => {
            const qty = parseFloat(qtyInput.value);
            const cost = parseFloat(costInput.value);
            const exp = expInput.value;

            const materialId = materialSelect.value;
            const selectedOption = materialSelect.options[materialSelect.selectedIndex];
            const materialName = selectedOption?.dataset.name;
            const isPerishable = selectedOption?.dataset.perishable == "1";

            if (!materialId || isNaN(qty) || isNaN(cost) || qty <= 0) {
                Swal.fire({ title: 'Missing Data', text: 'Please select a material and enter valid quantity/cost', icon: 'warning', confirmButtonColor: '#FFB800' });
                return;
            }

            if (isPerishable && !exp) {
                Swal.fire({ title: 'Required Field', text: 'Please provide an expiration date for this perishable item.', icon: 'warning', confirmButtonColor: '#FFB800' });
                return;
            }

            const subtotal = qty * cost;

            const newItem = {
                material_id: materialId,
                material_name: materialName,
                quantity: qty,
                unit_cost: cost,
                expiration_date: exp,
                subtotal: subtotal
            };

            const duplicateIndex = items.findIndex(item => item.material_id === newItem.material_id);

            if (duplicateIndex !== -1) {
                Swal.fire({
                    title: 'Item Already Added',
                    text: `"${newItem.material_name}" is already in your active batch list. Would you like to merge the quantities?`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#FFB800',
                    cancelButtonColor: '#6c757d',
                    confirmButtonText: 'Yes, combine them',
                    cancelButtonText: 'Cancel'
                }).then((result) => {
                    if (result.isConfirmed) {
                        const totalQty = parseFloat(items[duplicateIndex].quantity) + parseFloat(newItem.quantity);
                        updateItemQuantity(duplicateIndex, totalQty);
                        clearInputs();
                    }
                });
                return;
            }

            items.push(newItem);
            renderTable();
            clearInputs();
        });
    }

    // ==========================================
    // RENDER LOCAL TRANSACTION BATCH TABLE
    // ==========================================
    function renderTable() {
        tbody.innerHTML = "";
        let grandTotal = 0;

        items.forEach((item, index) => {
            grandTotal += item.subtotal;

            const row = document.createElement("tr");
            row.innerHTML = `
                <td class="ps-3 align-middle">${item.material_name}</td>
                <td class="align-middle">
                    <div class="input-group input-group-sm" style="max-width: 130px;">
                        <button type="button" class="btn btn-outline-secondary minus-btn">-</button>
                        <input type="number" class="form-control text-center qty-input" value="${item.quantity}" min="1" step="any">
                        <button type="button" class="btn btn-outline-secondary plus-btn">+</button>
                    </div>
                </td>
                <td class="align-middle">₱${item.unit_cost.toFixed(2)}</td>
                <td class="fw-bold text-primary align-middle">₱${item.subtotal.toFixed(2)}</td>
                <td class="align-middle">${item.expiration_date || "-"}</td>
                <td class="text-center align-middle">
                    <button type="button" class="btn btn-sm btn-danger remove-btn">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>`;

            row.querySelector(".minus-btn").addEventListener("click", () => {
                if (item.quantity > 1) {
                    updateItemQuantity(index, parseFloat(item.quantity) - 1);
                }
            });

            row.querySelector(".plus-btn").addEventListener("click", () => {
                updateItemQuantity(index, parseFloat(item.quantity) + 1);
            });

            row.querySelector(".qty-input").addEventListener("change", (e) => {
                let val = parseFloat(e.target.value) || 1;
                if (val < 1) val = 1;
                updateItemQuantity(index, val);
            });

            row.querySelector(".remove-btn").addEventListener("click", () => {
                removeItem(index);
            });

            tbody.appendChild(row);
        });

        grandTotalEl.textContent = "₱" + grandTotal.toFixed(2);
        tableContainer.classList.toggle("d-none", items.length === 0);
    }

    function updateItemQuantity(index, newQty) {
        items[index].quantity = newQty;
        items[index].subtotal = items[index].quantity * items[index].unit_cost;
        renderTable();
    }

    function removeItem(index) {
        items.splice(index, 1);
        renderTable();
    }

    function clearInputs() {
        materialSelect.value = "";
        qtyInput.value = "";
        costInput.value = "";
        expInput.value = "";
        expInput.disabled = true;
        subtotalDisplay.value = "";
    }

    // ==========================================
    // SUBMIT TRANSACTION PACKET TO BACKEND PHP
    // ==========================================
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();

            if (items.length === 0) {
                Swal.fire({ title: 'No Items', text: 'Add at least one item to the list first', icon: 'warning', confirmButtonColor: '#FFB800' });
                return;
            }

            const submitBtn = form.querySelector('button[type="submit"]');
            LoadingManager.show(submitBtn || form, { text: 'Submitting...' });

            const formData = new FormData(form);
            const payload = {
                supplier_id: formData.get("supplier_id"),
                stock_in_date: formData.get("stock_in_date"),
                remarks: formData.get("remarks"),
                items: items
            };

            try {
                // 🔑 FIX: Attached Bearer Token configuration variables
                const res = await fetch("/backend/inventoryStaff/stockIn/add_stock_in.php", {
                    method: "POST",
                    headers: getAuthHeaders("application/json"),
                    body: JSON.stringify(payload)
                });

                const data = await res.json();

                if (data.success) {
                    Swal.fire({
                        icon: "success",
                        title: "Stock In Submitted, Waiting for Approval",
                        text: data.message,
                        confirmButtonColor: '#FFB800'
                    }).then(() => {
                        items = [];
                        renderTable();
                        form.reset();

                        const modalEl = document.getElementById("stockInModal");
                        if (modalEl) {
                            const modal = bootstrap.Modal.getInstance(modalEl);
                            if (modal) modal.hide();
                        }
                        location.reload();
                    });
                } else {
                    Swal.fire({ title: "Error", text: data.message, icon: "error", confirmButtonColor: '#FFB800' });
                }
            } catch (err) {
                console.error(err);
                Swal.fire({ title: "Error", text: "Server connection failed", icon: "error", confirmButtonColor: '#FFB800' });
            } finally {
                LoadingManager.hide(submitBtn || form);
            }
        });
    }

    // ==========================================
    // FETCH AND DISPLAY COMPLETED RECORDS HISTORY
    // ==========================================
    async function loadStockInRecords() {
        const pendingTbody = document.querySelector(".pending-table-card tbody");
        const pendingBadge = document.querySelector(".pending-table-card .badge");

        try {
            // 🔑 FIX: Secure token forwarding added
            const res = await fetch("/backend/inventoryStaff/stockIn/get_stock_in_list.php", {
                method: "GET",
                headers: getAuthHeaders(null)
            });
            const json = await res.json();

            if (json.success) {
                allStockInRecords = json.approved || [];
                renderHistoryTableHTML(allStockInRecords);

                if (pendingBadge) pendingBadge.textContent = json.pending ? json.pending.length : 0;
                if (json.pending && json.pending.length > 0 && pendingTbody) {
                    pendingTbody.innerHTML = json.pending.map(item => `
                    <tr>
                        <td class="ps-3">
                            <div class="fw-medium">${item.raw_material_name}</div>
                            <small class="text-muted">${item.first_name || ''} ${item.last_name || ''}</small>
                        </td>
                        <td class="text-end pe-3">
                            <span class="badge bg-warning text-dark">Pending</span>
                        </td>
                    </tr>`).join('');
                }
            }
        } catch (err) {
            console.error("Error loading history table layouts:", err);
        }
    }

    // ==========================================
    // REUSABLE HISTORICAL INVENTORY RENDERING HTML
    // ==========================================
    function renderHistoryTableHTML(dataArray) {
        if (!mainTbody) return;

        if (!dataArray || dataArray.length === 0) {
            mainTbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-5 empty-state">
                        No matching stock in records found.
                    </td>
                </tr>`;
            return;
        }

        mainTbody.innerHTML = dataArray.map(item => {
            const statusText = item.status || 'Approved';
            let badgeClass = 'bg-success text-white';

            if (statusText.toLowerCase() === 'pending') {
                badgeClass = 'bg-warning text-dark';
            } else if (statusText.toLowerCase() === 'cancelled' || statusText.toLowerCase() === 'rejected') {
                badgeClass = 'bg-danger text-white';
            }

            return `
            <tr>
                <td class="ps-4">
                    <div class="fw-bold text-dark">${item.raw_material_name}</div>
                </td>
                <td>${item.quantity}</td>
                <td>₱${parseFloat(item.unit_cost).toFixed(2)}</td>
                <td class="text-primary fw-bold">₱${parseFloat(item.subtotal).toFixed(2)}</td>
                <td>
                    <span class="badge ${badgeClass}">${statusText}</span>
                </td>
                <td>
                    <button type="button" class="btn btn-sm btn-primary view-stockin-btn" data-id="${item.stock_in_id || ''}">
                        <i class="bi bi-eye"></i>
                    </button>
                </td>
            </tr>`;
        }).join('');

        document.querySelectorAll('.view-stockin-btn').forEach(btn => {
            btn.addEventListener('click', function () {
                const id = this.getAttribute('data-id');
                showStockInDetailsSwal(id);
            });
        });
    }

    // ==========================================
    // NOTIFICATION LIVE ALERTS COMPILER
    // ==========================================
    function checkStockAlerts(materialsList) {
        const badge = document.getElementById('notificationBadge');
        const menu = document.getElementById('notificationMenu');
        if (!menu || !badge || !Array.isArray(materialsList)) return;

        let activeAlerts = [];

        materialsList.forEach(material => {
            const qty = parseFloat(material.current_quantity);
            const reorderLevel = parseFloat(material.reorder_level);

            let alertText = "";
            let isCritical = false;

            if (!isNaN(qty) && !isNaN(reorderLevel)) {
                if (qty <= 0) {
                    alertText = `⚠️ <strong>${material.raw_material_name}</strong> is completely out of stock! Restock immediately.`;
                    isCritical = true;
                } else if (qty <= reorderLevel) {
                    alertText = `⚠️ <strong>${material.raw_material_name}</strong> is low on stock (${qty} ${material.unit || 'pcs'} left). Restock soon!`;
                    isCritical = false;
                }
            }

            if (alertText) {
                activeAlerts.push({
                    text: alertText,
                    isCritical: isCritical,
                    updatedAt: material.updated_at ? new Date(material.updated_at).getTime() : 0
                });
            }
        });

        menu.innerHTML = '<li class="dropdown-header border-bottom fw-bold text-dark py-2">Stock Alerts</li>';

        if (activeAlerts.length > 0) {
            activeAlerts.sort((a, b) => b.updatedAt - a.updatedAt);

            activeAlerts.forEach(alert => {
                menu.innerHTML += `
                <li>
                    <a class="dropdown-item py-2 border-bottom text-wrap" href="manage_inventory.html" style="font-size: 0.9rem;">
                        <div style="color: ${alert.isCritical ? '#dc3545' : '#b57d00'};">
                            ${alert.text}
                        </div>
                    </a>
                </li>`;
            });

            badge.textContent = activeAlerts.length;
            badge.classList.remove('d-none');
        } else {
            badge.classList.add('d-none');
            menu.innerHTML += `<li><span class="dropdown-item text-muted text-center py-3">✅ All inventory levels are normal.</span></li>`;
        }
    }

    // ==========================================
    // DETAIL VIEW HANDLERS INSIDE WRAPPER
    // ==========================================
    function showStockInDetailsSwal(id) {
        const item = allStockInRecords.find(record => String(record.stock_in_id) === String(id));

        if (!item) {
            Swal.fire('Error', 'Could not locate record details locally.', 'error');
            return;
        }

        const unitCost = item.unit_cost ? `₱${parseFloat(item.unit_cost).toFixed(2)}` : '₱0.00';
        const totalCost = item.subtotal ? `₱${parseFloat(item.subtotal).toFixed(2)}` : '₱0.00';

        const expDate = item.expiration_date && item.expiration_date !== '0000-00-00' ? formatDate(item.expiration_date) : 'N/A';
        const stockInDate = item.stock_in_date ? formatDate(item.stock_in_date) : 'N/A';
        const approvedAt = item.approved_at && item.approved_at !== '0000-00-00 00:00:00' ? formatDate(item.approved_at) : 'N/A';

        const currentStatus = (item.status || 'Pending').toUpperCase();

        let approverDisplay = '<em>Awaiting Review</em>';
        if (currentStatus === 'APPROVED') {
            approverDisplay = item.approver_name || `Admin (ID: ${item.approved_by})`;
        } else if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') {
            approverDisplay = item.approver_name || `Declined by Admin`;
        }

        const htmlContent = `
            <div class="table-responsive text-start px-2" style="font-size: 0.95rem;">
                <table class="table table-sm table-borderless align-middle my-2">
                    <tbody>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted w-50">Raw Material:</td>
                            <td class="text-dark fw-bold">${item.raw_material_name}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Supplier:</td>
                            <td class="text-dark">${item.supplier_name || 'N/A'}</small></td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Quantity:</td>
                            <td class="text-dark fw-bold">${item.quantity || 0}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Expiration Date:</td>
                            <td class="${expDate !== 'N/A' ? 'text-danger fw-bold' : 'text-dark'}">${expDate}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Remarks:</td>
                            <td class="text-secondary text-wrap" style="max-width: 220px;">${item.remarks || '<em>None</em>'}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Unit Cost:</td>
                            <td class="text-dark">${unitCost}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Total Cost:</td>
                            <td class="text-primary fw-bold">${totalCost}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Stock In Date:</td>
                            <td class="text-dark">${stockInDate}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Stock In by:</td>
                            <td class="text-dark">${item.staff_name || `User ID: ${item.user_id}`}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Approved By:</td>
                            <td class="text-dark fw-bold">${approverDisplay}</td>
                        </tr>
                        <tr class="border-bottom py-2">
                            <td class="fw-bold text-muted">Approved At:</td>
                            <td class="text-dark">${approvedAt}</td>
                        </tr>
                        <tr>
                            <td class="fw-bold text-muted">Approval Remarks:</td>
                            <td class="text-secondary text-wrap" style="max-width: 220px;">${item.approval_remarks || '<em>No remarks provided</em>'}</td>
                        </tr>
                        <tr>
                            <td class="fw-bold text-muted">Status:</td>
                            <td class="text-secondary text-wrap" style="max-width: 220px;">${item.status || '<em>No status provided</em>'}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;

        let titleIcon = 'info';
        if (currentStatus === 'APPROVED') titleIcon = 'success';
        if (currentStatus === 'REJECTED' || currentStatus === 'CANCELLED') titleIcon = 'error';

        Swal.fire({
            title: `Stock In Reference Detail`,
            html: htmlContent,
            icon: titleIcon,
            buttonText: 'Close Window',
            confirmButtonColor: '#FFB800',
            width: '520px',
            customClass: {
                popup: 'rounded-4 shadow-lg'
            }
        });
    }

    function formatDate(dateString) {
        if (!dateString || dateString.startsWith('0000')) return "N/A";
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }
});