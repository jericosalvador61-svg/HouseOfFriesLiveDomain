const API = {
    fetchChoices: "../../backend/admin/manageMenu/fetch_choices.php",
    saveChoices: "../../backend/admin/manageMenu/save_choices.php"
};

function getAuthToken() {
    return localStorage.getItem('hof_token') || '';
}

function authFetch(url, options = {}) {
    const token = getAuthToken();
    const headers = options.headers || {};
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }
    options.headers = headers;
    return fetch(url, options);
}

function safeLoadingShow(el, opts) {
    if (typeof LoadingManager !== 'undefined' && LoadingManager && LoadingManager.show) {
        LoadingManager.show(el, opts);
    }
}

function safeLoadingHide(el) {
    if (typeof LoadingManager !== 'undefined' && LoadingManager && LoadingManager.hide) {
        LoadingManager.hide(el);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

let allData = { menu_items: [], global_addons: [] };

// DOM Selectors
const grid = document.getElementById("choicesGrid");
const searchInput = document.getElementById("searchChoice");
const categoryFilter = document.getElementById("categoryFilter");
const showInactiveToggle = document.getElementById("showInactiveToggle");
const addChoiceBtn = document.getElementById("btnAddChoice");
const addAddonBtn = document.getElementById("btnAddAddon");

const choicesModalEl = document.getElementById("choicesModal");
const choicesModal = new bootstrap.Modal(choicesModalEl);
const addonsModalEl = document.getElementById("addonsModal");
const addonsModal = new bootstrap.Modal(addonsModalEl);

const choicesModalLabel = document.getElementById("choicesModalLabel");
const addonsModalLabel = document.getElementById("addonsModalLabel");
const choiceMenuItemSelect = document.getElementById("choiceMenuItem");
const choiceGroupsContainer = document.getElementById("choiceGroupsContainer");
const addonsListContainer = document.getElementById("addonsListContainer");

const btnSaveChoices = document.getElementById("btnSaveChoices");
const btnSaveAddons = document.getElementById("btnSaveAddons");
const btnAddGroup = document.getElementById("btnAddGroup");
const btnAddAddonRow = document.getElementById("btnAddAddonRow");

// Track original rows for computing soft-deletions
let originalChoiceRows = [];
let originalAddonRows = [];

// ── 1. Fetch data ──
async function fetchChoices() {
    try {
        const res = await authFetch(API.fetchChoices);
        const data = await res.json();
        if (data.success) {
            allData = data;
            buildCategoryFilter();
            render();
        } else {
            Swal.fire('Error', data.message || 'Failed to load data.', 'error');
        }
    } catch (err) {
        console.error("Failed to fetch choices:", err);
        Swal.fire('Error', 'Failed to load data.', 'error');
    }
}

function buildCategoryFilter() {
    const seen = new Set();
    const cats = [];
    allData.menu_items.forEach(item => {
        const cat = item.category_name || '';
        if (cat && !seen.has(cat)) {
            seen.add(cat);
            cats.push(cat);
        }
    });
    cats.sort();
    categoryFilter.innerHTML = '<option value="">All Categories</option>';
    cats.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        categoryFilter.appendChild(option);
    });
}

// ── 2. Render cards ──
function getActiveGroups(item) {
    return item.choices.filter(group => group.options.some(opt => opt.status === 'Active'));
}

function render() {
    grid.innerHTML = "";
    if (!allData.menu_items.length) {
        renderGlobalAddonsCard();
        grid.innerHTML += `<div class="col-12 text-center py-5 text-muted">No menu items found.</div>`;
        return;
    }

    const query = searchInput.value.toLowerCase();
    const cat = categoryFilter.value;
    const showInactive = showInactiveToggle.checked;

    let filtered = allData.menu_items.filter(item => {
        const matchesSearch = item.item_name.toLowerCase().includes(query);
        const matchesCat = !cat || item.category_name === cat;
        return matchesSearch && matchesCat;
    });

    let rendered = 0;
    filtered.forEach(item => {
        const activeGroups = getActiveGroups(item);
        const inactiveCount = item.choices.reduce((n, g) => n + g.options.filter(o => o.status === 'Inactive').length, 0);
        const hasAnyChoices = item.choices.length > 0;

        // Skip empty items unless "Show Inactive" is on (inactive choices may exist)
        if (!hasAnyChoices && !showInactive) return;

        rendered++;

        const col = document.createElement("div");
        col.className = "col";

        const groupsHtml = activeGroups.map(group => `
            <div class="mb-2">
                <span class="fw-bold small">${escapeHtml(group.group_name)}</span>
                <div class="d-flex flex-wrap gap-1 mt-1">
                    ${group.options.filter(o => o.status === 'Active').map(opt => `
                        <span class="badge bg-secondary bg-opacity-25 text-dark">${escapeHtml(opt.choice_name)}</span>
                    `).join('')}
                </div>
            </div>
        `).join('');

        const inactiveNotice = showInactive && inactiveCount > 0
            ? `<div class="text-muted small mb-1"><i class="bi bi-eye-slash"></i> ${inactiveCount} hidden option(s)</div>`
            : '';

        col.innerHTML = `
        <div class="card h-100 border-0 shadow-sm choices-card" style="border-radius: 15px;">
            <div class="card-body p-3">
                <div class="d-flex justify-content-between align-items-center mb-2">
                    <h6 class="fw-bold mb-0">${escapeHtml(item.item_name)}</h6>
                    <span class="badge bg-dark opacity-75">${escapeHtml(item.category_name)}</span>
                </div>
                ${groupsHtml || '<p class="text-muted small mb-2">No choices configured yet.</p>'}
                ${inactiveNotice}
                <div class="d-flex gap-2 mt-3">
                    <button class="btn btn-sm btn-warning flex-grow-1 edit-choices-btn" data-id="${item.menu_item_id}">Edit Choices</button>
                </div>
            </div>
        </div>`;
        grid.appendChild(col);
    });

    // Global Add-ons card — highlighted, shown on EVERY page view
    renderGlobalAddonsCard();

    if (rendered === 0) {
        grid.innerHTML += `<div class="col-12 text-center py-4 text-muted">No items found matching your search.</div>`;
    }
}

function renderGlobalAddonsCard() {
    const col = document.createElement("div");
    col.className = "col";

    const activeAddons = allData.global_addons.filter(a => a.status === 'Active');
    const inactiveCount = allData.global_addons.filter(a => a.status === 'Inactive').length;
    const showInactive = showInactiveToggle.checked;

    const addonsHtml = activeAddons.map(a => `
        <div class="d-flex justify-content-between align-items-center mb-1">
            <span class="small">${escapeHtml(a.addon_name)}</span>
            <span class="text-success fw-bold small">₱${parseFloat(a.price).toFixed(2)}</span>
        </div>
    `).join('');

    const inactiveNotice = showInactive && inactiveCount > 0
        ? `<div class="text-muted small mt-1"><i class="bi bi-eye-slash"></i> ${inactiveCount} hidden add-on(s)</div>`
        : '';

    col.innerHTML = `
    <div class="card h-100 border-0 shadow-sm choices-card global-addons-card" style="border-radius: 15px;">
        <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
                <h6 class="fw-bold mb-0 text-warning"><i class="bi bi-stars me-1"></i>Global Add-ons</h6>
                <span class="badge bg-warning text-dark">Every item</span>
            </div>
            ${addonsHtml || '<p class="text-muted small mb-2">No add-ons configured yet.</p>'}
            ${inactiveNotice}
            <div class="d-flex gap-2 mt-3">
                <button class="btn btn-sm btn-primary flex-grow-1" id="editGlobalAddonsBtn">Manage Add-ons</button>
            </div>
        </div>
    </div>`;

    grid.insertBefore(col, grid.firstChild);
}

// ── 3. Filter & Search ──
searchInput.addEventListener("input", render);
categoryFilter.addEventListener("change", render);
showInactiveToggle.addEventListener("change", render);

// ── 4. Choices Modal ──
function populateMenuItemSelect() {
    const current = choiceMenuItemSelect.value;
    choiceMenuItemSelect.innerHTML = '<option value="" selected disabled>-- Select Menu Item --</option>';
    allData.menu_items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.menu_item_id;
        option.textContent = `${item.item_name} (${item.category_name || 'No category'})`;
        choiceMenuItemSelect.appendChild(option);
    });
    if (current) choiceMenuItemSelect.value = current;
}

addChoiceBtn.addEventListener("click", () => {
    populateMenuItemSelect();
    choiceMenuItemSelect.value = "";
    choicesModalLabel.textContent = "ADD CHOICES";
    choiceGroupsContainer.innerHTML = "";
    originalChoiceRows = [];
    addGroupRow();
    choicesModal.show();
});

grid.addEventListener("click", (e) => {
    const editBtn = e.target.closest(".edit-choices-btn");
    const addonsBtn = e.target.closest("#editGlobalAddonsBtn");
    if (!editBtn && !addonsBtn) return;

    if (addonsBtn) {
        openAddonsModal();
        return;
    }

    const id = editBtn.dataset.id;
    const item = allData.menu_items.find(m => m.menu_item_id == id);
    if (!item) return;

    populateMenuItemSelect();
    choiceMenuItemSelect.value = String(item.menu_item_id);
    choicesModalLabel.textContent = "EDIT CHOICES";
    renderChoiceGroups(item);
    choicesModal.show();
});

function renderChoiceGroups(item) {
    choiceGroupsContainer.innerHTML = "";
    originalChoiceRows = [];
    const groups = item.choices || [];
    if (!groups.length) {
        addGroupRow();
        return;
    }
    groups.forEach(group => {
        const opts = group.options.map(o => ({
            menu_choice_id: o.menu_choice_id,
            choice_name: o.choice_name,
            status: o.status
        }));
        originalChoiceRows.push(...opts);
        addGroupRow(group.group_name, opts);
    });
}

function addGroupRow(groupName = '', options = null) {
    const groupDiv = document.createElement("div");
    groupDiv.className = "choice-group-row border rounded p-3 mb-3";
    groupDiv.style.backgroundColor = "#f8f9fa";

    groupDiv.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <label class="form-label fw-bold small mb-0" style="color: #1a1512;">GROUP NAME</label>
            <button type="button" class="btn btn-sm btn-outline-danger remove-group-btn" title="Remove group"><i class="bi bi-trash"></i></button>
        </div>
        <input type="text" class="form-control form-control-sm mb-2 group-name-input" placeholder="e.g. Drink Type" value="${escapeHtml(groupName)}">
        <div class="options-container mb-2"></div>
        <button type="button" class="btn btn-sm btn-outline-secondary add-option-btn"><i class="bi bi-plus-lg me-1"></i>Add Option</button>
    `;

    const optionsContainer = groupDiv.querySelector(".options-container");
    if (options && options.length) {
        options.forEach(opt => addOptionRow(optionsContainer, opt));
    } else {
        addOptionRow(optionsContainer, null);
    }

    groupDiv.querySelector(".remove-group-btn").addEventListener("click", () => {
        const hasSaved = groupDiv.querySelectorAll(".option-id-input[value]:not([value=''])").length > 0;
        if (!hasSaved) {
            groupDiv.remove();
            return;
        }
        Swal.fire({
            title: 'Hide this group?',
            text: "All options in this group will be hidden (set Inactive) when you save.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'Yes, hide it!'
        }).then((result) => {
            if (result.isConfirmed) groupDiv.remove();
        });
    });
    groupDiv.querySelector(".add-option-btn").addEventListener("click", () => addOptionRow(optionsContainer, null));

    choiceGroupsContainer.appendChild(groupDiv);
}

function addOptionRow(container, option) {
    const optionDiv = document.createElement("div");
    optionDiv.className = "option-row d-flex align-items-center gap-2 mb-2";

    // REQ-057: optional per-choice image upload (base64 data URI via HOFImage).
    optionDiv.innerHTML = `
        <input type="hidden" class="option-id-input" value="${option && option.menu_choice_id ? option.menu_choice_id : ''}">
        <input type="hidden" class="option-img-blob-input" value="">
        <input type="text" class="form-control form-control-sm option-name-input" placeholder="Option name (e.g. Iced Tea)" value="${escapeHtml(option ? option.choice_name : '')}">
        <input type="file" class="form-control form-control-sm option-img-file" accept="image/*" style="max-width: 200px;">
        ${option && option.status === 'Inactive' ? '<span class="badge bg-secondary">Inactive</span>' : ''}
        <button type="button" class="btn btn-sm btn-outline-danger remove-option-btn"><i class="bi bi-x-lg"></i></button>
    `;

    const fileInput = optionDiv.querySelector(".option-img-file");
    fileInput.addEventListener("change", function () {
        const file = this.files && this.files[0];
        if (!file || !window.HOFImage || !HOFImage.compress) return;
        HOFImage.compress(file, 800, 0.65).then(function (blob) {
            const reader = new FileReader();
            reader.onload = function (e) {
                optionDiv.querySelector(".option-img-blob-input").value = e.target.result;
            };
            reader.readAsDataURL(blob);
        });
    });

    optionDiv.querySelector(".remove-option-btn").addEventListener("click", () => {
        const hasId = option && option.menu_choice_id;
        if (!hasId) {
            optionDiv.remove();
            return;
        }
        Swal.fire({
            title: 'Hide this option?',
            text: "The option will be set to Inactive when you save.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'Yes, hide it!'
        }).then((result) => {
            if (result.isConfirmed) optionDiv.remove();
        });
    });
    container.appendChild(optionDiv);
}

btnAddGroup.addEventListener("click", () => addGroupRow());

// ── 5. Save Choices ──
function collectRemovedChoiceIds() {
    const presentIds = [];
    choiceGroupsContainer.querySelectorAll(".option-row").forEach(row => {
        const id = row.querySelector(".option-id-input").value;
        if (id) presentIds.push(parseInt(id, 10));
    });
    return originalChoiceRows
        .filter(o => o.menu_choice_id && !presentIds.includes(o.menu_choice_id))
        .map(o => o.menu_choice_id);
}

btnSaveChoices.addEventListener("click", async () => {
    const menuItemId = choiceMenuItemSelect.value;
    if (!menuItemId) {
        Swal.fire('Missing', 'Please select a menu item.', 'warning');
        return;
    }

    const groups = [];
        choiceGroupsContainer.querySelectorAll(".choice-group-row").forEach(groupRow => {
        const groupName = groupRow.querySelector(".group-name-input").value.trim();
        const options = [];
        groupRow.querySelectorAll(".option-row").forEach(optRow => {
            const name = optRow.querySelector(".option-name-input").value.trim();
            const id = optRow.querySelector(".option-id-input").value;
            const imgBlob = optRow.querySelector(".option-img-blob-input")?.value || null;
            if (!name) return;
            if (id) {
                options.push({ menu_choice_id: parseInt(id, 10), choice_name: name, image_blob: imgBlob });
            } else {
                options.push({ choice_name: name, image_blob: imgBlob });
            }
        });
        if (!groupName || !options.length) return;
        groups.push({ group_name: groupName, options });
    });

    const removedIds = collectRemovedChoiceIds();

    if (!groups.length && !removedIds.length) {
        Swal.fire('Missing', 'No groups to save.', 'warning');
        return;
    }

    btnSaveChoices.disabled = true;
    safeLoadingShow(btnSaveChoices, { text: 'Saving...' });

    try {
        const res = await authFetch(API.saveChoices, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                menu_item_id: parseInt(menuItemId, 10),
                groups,
                delete_choice_ids: removedIds
            })
        });
        const data = await res.json();
        if (data.success) {
            choicesModal.hide();
            await fetchChoices();
            Swal.fire('Success!', 'Choices saved.', 'success');
        } else {
            Swal.fire('Error', data.message || 'Failed to save choices.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Failed to save choices.', 'error');
    } finally {
        btnSaveChoices.disabled = false;
        safeLoadingHide(btnSaveChoices);
    }
});

// ── 6. Add-ons Modal ──
function openAddonsModal() {
    addonsModalLabel.textContent = "GLOBAL ADD-ONS";
    renderAddonsList();
    addonsModal.show();
}

addAddonBtn.addEventListener("click", openAddonsModal);

function renderAddonsList() {
    addonsListContainer.innerHTML = "";
    originalAddonRows = [];
    const showInactive = showInactiveToggle.checked;
    const addons = allData.global_addons.filter(a => showInactive || a.status === 'Active');

    if (!addons.length) {
        addAddonRowElement(null);
        return;
    }
    addons.forEach(a => {
        originalAddonRows.push({ menu_addon_id: a.menu_addon_id });
        addAddonRowElement({ menu_addon_id: a.menu_addon_id, addon_name: a.addon_name, price: a.price, status: a.status });
    });
}

function addAddonRowElement(addon) {
    const row = document.createElement("div");
    row.className = "addon-row d-flex align-items-center gap-2 mb-2";

    // REQ-057: optional per-addon image upload (base64 data URI via HOFImage).
    row.innerHTML = `
        <input type="hidden" class="addon-id-input" value="${addon && addon.menu_addon_id ? addon.menu_addon_id : ''}">
        <input type="hidden" class="addon-img-blob-input" value="">
        <input type="text" class="form-control form-control-sm addon-name-input" placeholder="Add-on name (e.g. Gravy)" value="${escapeHtml(addon ? addon.addon_name : '')}">
        <div class="input-group input-group-sm" style="max-width: 130px;">
            <span class="input-group-text">₱</span>
            <input type="number" step="0.01" min="0" class="form-control addon-price-input" placeholder="0.00" value="${addon ? parseFloat(addon.price).toFixed(2) : ''}">
        </div>
        <input type="file" class="form-control form-control-sm addon-img-file" accept="image/*" style="max-width: 190px;">
        ${addon && addon.status === 'Inactive' ? '<span class="badge bg-secondary">Inactive</span>' : ''}
        <button type="button" class="btn btn-sm btn-outline-danger remove-addon-btn"><i class="bi bi-x-lg"></i></button>
    `;

    const fileInput = row.querySelector(".addon-img-file");
    fileInput.addEventListener("change", function () {
        const file = this.files && this.files[0];
        if (!file || !window.HOFImage || !HOFImage.compress) return;
        HOFImage.compress(file, 800, 0.65).then(function (blob) {
            const reader = new FileReader();
            reader.onload = function (e) {
                row.querySelector(".addon-img-blob-input").value = e.target.result;
            };
            reader.readAsDataURL(blob);
        });
    });

    row.querySelector(".remove-addon-btn").addEventListener("click", () => {
        const hasId = addon && addon.menu_addon_id;
        if (!hasId) {
            row.remove();
            return;
        }
        Swal.fire({
            title: 'Hide this add-on?',
            text: "The add-on will be set to Inactive when you save.",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'Yes, hide it!'
        }).then((result) => {
            if (result.isConfirmed) row.remove();
        });
    });
    addonsListContainer.appendChild(row);
}

btnAddAddonRow.addEventListener("click", () => addAddonRowElement(null));

// ── 7. Save Add-ons ──
function collectRemovedAddonIds() {
    const presentIds = [];
    addonsListContainer.querySelectorAll(".addon-row").forEach(row => {
        const id = row.querySelector(".addon-id-input").value;
        if (id) presentIds.push(parseInt(id, 10));
    });
    return originalAddonRows
        .filter(a => a.menu_addon_id && !presentIds.includes(a.menu_addon_id))
        .map(a => a.menu_addon_id);
}

btnSaveAddons.addEventListener("click", async () => {
    const addons = [];
    const deleteAddonIds = collectRemovedAddonIds();

    addonsListContainer.querySelectorAll(".addon-row").forEach(row => {
        const name = row.querySelector(".addon-name-input").value.trim();
        const price = parseFloat(row.querySelector(".addon-price-input").value);
        const id = row.querySelector(".addon-id-input").value;
        const imgBlob = row.querySelector(".addon-img-blob-input")?.value || null;
        if (!name) return;
        const addon = { addon_name: name, price: isNaN(price) ? 0 : price, image_blob: imgBlob };
        if (id) addon.menu_addon_id = parseInt(id, 10);
        addons.push(addon);
    });

    if (!addons.length && !deleteAddonIds.length) {
        Swal.fire('Missing', 'No add-ons to save.', 'warning');
        return;
    }

    btnSaveAddons.disabled = true;
    safeLoadingShow(btnSaveAddons, { text: 'Saving...' });

    try {
        const res = await authFetch(API.saveChoices, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                addons,
                delete_addon_ids: deleteAddonIds
            })
        });
        const data = await res.json();
        if (data.success) {
            addonsModal.hide();
            await fetchChoices();
            Swal.fire('Success!', 'Add-ons saved.', 'success');
        } else {
            Swal.fire('Error', data.message || 'Failed to save add-ons.', 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Failed to save add-ons.', 'error');
    } finally {
        btnSaveAddons.disabled = false;
        safeLoadingHide(btnSaveAddons);
    }
});

// ── 8. Init ──
fetchChoices();
