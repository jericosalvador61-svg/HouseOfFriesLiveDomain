const API = {
    categories: "../../backend/admin/manageMenu/fetch_categories.php",
    menus: "../../backend/admin/manageMenu/fetch_menus.php",
    addMenu: "../../backend/admin/manageMenu/add_menu.php",
    updateMenu: "../../backend/admin/manageMenu/update_menu.php",
    deleteMenu: "../../backend/admin/manageMenu/delete_menu.php",
    // Supervisor's ONLY permitted write: flip Available <-> Unavailable.
    // Backend allows Supervisor on this endpoint (kitchenStaff/menu_availability.php:14).
    availability: "../../backend/kitchenStaff/menu_availability.php"
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

let menus = [];

// DOM Selectors
const menuGrid = document.getElementById("menuGrid");
const searchInput = document.getElementById("searchMenu");
const categoryFilter = document.getElementById("categoryFilter");
const addMenuBtn = document.getElementById("btnAddMenu");
const addMenuModalEl = document.getElementById("addMenuModal");
const addMenuModal = new bootstrap.Modal(addMenuModalEl);
const formAddMenu = document.getElementById("formAddMenu");
const modalTitle = document.getElementById("addMenuModalLabel");
const imageInput = document.getElementById("imageUpload");
const modalCategorySelect = document.getElementById("categoryId");

// NEW SELECTORS FOR STATUS CONTROL CONFIGS
const statusWrapper = document.getElementById("statusWrapper");
const itemStatusInput = document.getElementById("itemStatus");

// --- 1. Fetch Categories ---
async function fetchCategories() {
    try {
        const res = await authFetch(API.categories);
        const categories = await res.json();

        categoryFilter.innerHTML = '<option value="">All Categories</option>';
        modalCategorySelect.innerHTML = '<option value="" selected disabled>-- Select Category --</option>';

        categories.forEach(cat => {
            const option = `<option value="${cat.category_id}">${cat.category_name}</option>`;
            categoryFilter.innerHTML += option;
            modalCategorySelect.innerHTML += option;
        });
    } catch (err) {
        console.error("Failed to fetch categories:", err);
    }
}

// --- 2. Fetch Menu Items ---
async function fetchMenus() {
    try {
        const res = await authFetch(API.menus);
        menus = await res.json();
        renderMenus(menus);
    } catch (err) {
        console.error("Failed to fetch menus:", err);
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

// --- 3. Render UI (Edit/Delete hidden for Kitchen Staff: add_menu.php, update_menu.php
//         and delete_menu.php are all Admin-only on the backend. Kitchen Staff may
//         only VIEW items and flip availability via kitchenStaff/menu_availability.php) ---
function getCurrentRole() {
    try {
        const token = getAuthToken();
        if (!token) return '';
        const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        return String(payload.role || '').toLowerCase();
    } catch (e) { return ''; }
}
// Availability toggle: available to Kitchen Staff + Supervisor (both allowed on
// menu_availability.php:14) but NOT Admin, who edits status inside the edit modal.
function canToggleAvailability() {
    const r = getCurrentRole();
    return r === 'kitchen staff' || r === 'supervisor';
}
function canDeleteMenu() {
    return getCurrentRole() === 'admin';
}
function canEditMenu() {
    return getCurrentRole() === 'admin';
}
function renderMenus(list) {
    menuGrid.innerHTML = "";
    if (!list.length) {
        menuGrid.innerHTML = `<div class="col-12 text-center py-5 text-muted">No items found matching your search.</div>`;
        return;
    }

    list.forEach(menu => {
        const col = document.createElement("div");
        col.className = "col";

        const imgUrl = menu.image_url ? menu.image_url : "/images/placeholder.png";
        // Define clean visual badges for internal system tracking updates
        const isUnavailable = menu.status === 'Unavailable';
        const statusBadge = isUnavailable ? `<span class="position-absolute top-0 end-0 m-2 badge bg-danger text-white">Unavailable</span>` : '';
        const grayScaleOverlay = isUnavailable ? 'style="filter: grayscale(1); opacity: 0.6;"' : '';

        col.innerHTML = `
        <div class="card h-100 border-0 shadow-sm menu-card" style="border-radius: 15px; overflow: hidden;" ${grayScaleOverlay}>
            <div class="position-relative">
                <img src="${imgUrl}" 
                     class="card-img-top" 
                     alt="${escapeHtml(menu.item_name)}" 
                     style="height: 160px; object-fit: cover;"
onerror="this.onerror=null;this.src='/images/placeholder.png';">                <span class="position-absolute top-0 start-0 m-2 badge bg-dark opacity-75">${escapeHtml(menu.category_name)}</span>
                ${statusBadge}
            </div>
            <div class="card-body p-3">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <h6 class="fw-bold mb-0">${escapeHtml(menu.item_name)}</h6>
                    <span class="text-success fw-bold">₱${parseFloat(menu.price).toFixed(2)}</span>
                </div>
                <p class="text-muted small mb-2 text-truncate">${escapeHtml(menu.description) || 'No description'}</p>
                ${menu.estimated_prep_time_minutes > 0 ? `<span class="badge bg-secondary bg-opacity-25 text-dark mb-2" style="font-size:11px;"><i class="bi bi-hourglass-split"></i> ${menu.estimated_prep_time_minutes} min</span>` : ''}
                <div class="d-flex gap-2">
                    ${canEditMenu() ? `<button class="btn btn-sm btn-warning flex-grow-1 edit-menu-btn" data-id="${menu.menu_item_id}">Edit</button>` : ''}
                    ${canDeleteMenu() ? `<button class="btn btn-sm btn-outline-danger delete-menu-btn" data-id="${menu.menu_item_id}"><i class="bi bi-trash"></i></button>` : ''}
                </div>
                ${canToggleAvailability() ? `<div class="form-check form-switch mt-2">
                    <input class="form-check-input availability-toggle" type="checkbox" role="switch"
                           id="avail_${menu.menu_item_id}" data-id="${menu.menu_item_id}"
                           ${menu.status === 'Unavailable' ? '' : 'checked'}>
                    <label class="form-check-label small" for="avail_${menu.menu_item_id}">Available</label>
                </div>` : ''}
            </div>
        </div>`;
        menuGrid.appendChild(col);
    });
}

// --- 4. Filter & Search ---
function filterItems() {
    const query = searchInput.value.toLowerCase();
    const catId = categoryFilter.value;

    const filtered = menus.filter(m => {
        const matchesSearch = m.item_name.toLowerCase().includes(query);
        const matchesCat = catId === "" || m.category_id == catId;
        return matchesSearch && matchesCat;
    });
    renderMenus(filtered);
}

searchInput.addEventListener("input", filterItems);
categoryFilter.addEventListener("change", filterItems);

menuGrid.addEventListener("change", async (e) => {
    const toggle = e.target.closest(".availability-toggle");
    if (!toggle) return;

    const id = toggle.dataset.id;
    const nextStatus = toggle.checked ? "Available" : "Unavailable";
    const item = menus.find(m => m.menu_item_id == id);

    try {
        const res = await authFetch(API.availability, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ menu_item_id: Number(id), status: nextStatus })
        });
        const data = await res.json();
        if (data.success) {
            if (item) item.status = nextStatus;
            renderMenus(menus);
            Swal.fire('Updated', data.message || `Item is now ${nextStatus}.`, 'success');
        } else {
            toggle.checked = !toggle.checked; // revert the switch
            Swal.fire('Error', data.message || 'Failed to update availability.', 'error');
        }
    } catch (err) {
        toggle.checked = !toggle.checked;
        Swal.fire('Error', 'Network error while updating availability.', 'error');
    }
});

// --- 5. Add/Edit Logic ---
if (addMenuBtn) {
    addMenuBtn.addEventListener("click", () => {
    formAddMenu.reset();
    document.getElementById("editMenuId").value = "";
    modalTitle.textContent = "ADD NEW MENU ITEM";
    imageInput.required = true;

    // Hide status selector container when adding fresh items
    statusWrapper.classList.add("d-none");

    addMenuModal.show();
    });
} // end if (addMenuBtn) — Supervisor has no Add button, so the listener is skipped

menuGrid.addEventListener("click", async (e) => {
    const editBtn = e.target.closest(".edit-menu-btn");
    const deleteBtn = e.target.closest(".delete-menu-btn");

    if (editBtn) {
        const id = editBtn.dataset.id;
        const item = menus.find(m => m.menu_item_id == id);
        if (!item) return;

        document.getElementById("editMenuId").value = item.menu_item_id;
        document.getElementById("itemName").value = item.item_name;
        document.getElementById("itemDescription").value = item.description || "";
        document.getElementById("categoryId").value = item.category_id;
        document.getElementById("itemPrice").value = item.price;
        document.getElementById("itemPrepTime").value = item.estimated_prep_time_minutes ?? 0;

        // Populate and display status choices explicitly on modification triggers
        itemStatusInput.value = item.status || "Available";
        statusWrapper.classList.remove("d-none");

        modalTitle.textContent = "EDIT MENU ITEM";
        imageInput.required = false;
        addMenuModal.show();
    }

    if (deleteBtn) {
        const id = deleteBtn.dataset.id;
        const result = await Swal.fire({
            title: 'Are you sure?',
            text: "This will remove the item from the menu!",
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#d33',
            confirmButtonText: 'Yes, delete it!'
        });

        if (result.isConfirmed) {
            safeLoadingShow(deleteBtn, { text: 'Deleting...' });
            try {
                const res = await authFetch(API.deleteMenu, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ menu_item_id: id })
                });
                const data = await res.json();
                if (data.success) {
                    fetchMenus();
                    Swal.fire('Deleted!', 'Item has been removed.', 'success');
                }
            } catch (err) {
                Swal.fire('Error', 'Failed to delete item.', 'error');
            } finally {
                safeLoadingHide(deleteBtn);
            }
        }
    }
});

formAddMenu.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(formAddMenu);
    const menuId = document.getElementById("editMenuId").value;
    const url = menuId ? API.updateMenu : API.addMenu;

    const submitBtn = formAddMenu.querySelector('button[type="submit"]');
    safeLoadingShow(submitBtn || formAddMenu, { text: menuId ? 'Updating...' : 'Adding...' });

    try {
        const res = await authFetch(url, { method: "POST", body: formData });
        const data = await res.json();

        if (data.success) {
            addMenuModal.hide();
            fetchMenus();
            Swal.fire('Success!', menuId ? 'Item updated.' : 'Item added.', 'success');
        } else {
            Swal.fire('Error', data.message, 'error');
        }
    } catch (err) {
        Swal.fire('Error', 'Connection failed.', 'error');
    } finally {
        safeLoadingHide(submitBtn || formAddMenu);
    }
});

// --- 5.5 Client-side Image Compression ---
function compressImage(file, maxWidth, quality, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            canvas.toBlob((blob) => {
                if (blob) callback(blob); else callback(file);
            }, 'image/jpeg', quality);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

document.getElementById('imageUpload').addEventListener('change', function(e) {
    if (this.files && this.files[0]) {
        compressImage(this.files[0], 800, 0.7, (compressed) => {
            const dt = new DataTransfer();
            dt.items.add(new File([compressed], this.files[0].name, {type: 'image/jpeg'}));
            this.files = dt.files;
        });
    }
});

// --- 6. Initialize ---
fetchCategories();
fetchMenus();

// --- 7. Realtime Menu Availability (mirrors customer/cart.js:389-413) ---
function bindMenuAvailability() {
    if (typeof Pusher === 'undefined') return;
    const pusher = new Pusher('a8860aca373dcc3400ce', { cluster: 'ap1', forceTLS: (window.location.protocol === 'https:') });
    const menuChannel = pusher.subscribe('hof-menu');
    menuChannel.bind('menu-availability-changed', function (data) {
        let payload = typeof data === 'string' ? JSON.parse(data) : data;
        if (typeof payload.data === 'string') payload = JSON.parse(payload.data);
        if (!payload.menu_item_id || !payload.status) return;

        const item = menus.find(m => String(m.menu_item_id) === String(payload.menu_item_id));
        if (!item) return;

        item.status = payload.status;
        renderMenus(menus);
    });
}
bindMenuAvailability();