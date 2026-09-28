(function () {
    'use strict';
    const API = '../../backend/admin/settings';
    const mapEl = document.getElementById('map');
    const branchNameInput = document.getElementById('branchNameInput');
    const latInput = document.getElementById('latitudeInput');
    const lngInput = document.getElementById('longitudeInput');
    const radiusSlider = document.getElementById('radiusSlider');
    const radiusDisplay = document.getElementById('radiusDisplay');
    const toggleBtn = document.getElementById('geofenceToggle');
    const toggleLabel = document.getElementById('toggleLabel');
    const editBtn = document.getElementById('editBtn');
    const saveBtn = document.getElementById('saveBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const locateBtn = document.getElementById('locateMeBtn');
    const statusAlert = document.getElementById('statusAlert');
    const modeBadge = document.getElementById('modeBadge');
    const mapHelpText = document.getElementById('mapHelpText');
    const viewActions = document.getElementById('viewActions');
    const editActions = document.getElementById('editActions');
    if (!mapEl) return;

    var currentBranchName = '', currentLat = 8.5372, currentLng = 124.8269, currentRadius = 300, currentEnabled = true;
    var savedBranchName = '', savedLat = 8.5372, savedLng = 124.8269, savedRadius = 300, savedEnabled = true;
    var isEditing = false, isNewSetup = false;
    var marker, circle, map;

    function initMap() {
        var defaultPos = [currentLat, currentLng];

        map = L.map(mapEl, {
            center: defaultPos,
            zoom: 16,
            maxBounds: [[4.5, 116.5], [21.5, 127.0]],
            maxBoundsViscosity: 1.0
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '&copy; OpenStreetMap'
        }).addTo(map);

        marker = L.marker(defaultPos, {
            draggable: false
        }).addTo(map);

        circle = L.circle(defaultPos, {
            radius: currentRadius,
            color: '#0d6efd',
            fillColor: '#0d6efd',
            fillOpacity: 0.1,
            weight: 2
        }).addTo(map);

        marker.on('dragend', function () {
            var pos = marker.getLatLng();
            setCoords(pos.lat, pos.lng);
        });

        map.on('click', function (e) {
            if (!isEditing) return;
            marker.setLatLng(e.latlng);
            setCoords(e.latlng.lat, e.latlng.lng);
        });

        loadSettings();
    }

    function updateMarker(lat, lng, radius, draggable) {
        var pos = [parseFloat(lat), parseFloat(lng)];
        marker.setLatLng(pos);
        marker.dragging[draggable ? 'enable' : 'disable']();
        circle.setLatLng(pos);
        circle.setRadius(radius);
        map.setView(pos, map.getZoom());
    }

    function setCoords(lat, lng) {
        currentLat = parseFloat(lat.toFixed(7));
        currentLng = parseFloat(lng.toFixed(7));
        latInput.value = currentLat;
        lngInput.value = currentLng;
        if (isEditing) {
            updateMarker(currentLat, currentLng, currentRadius, true);
        }
    }

    function setRadius(val) {
        currentRadius = parseInt(val, 10);
        radiusDisplay.textContent = currentRadius;
        circle.setRadius(currentRadius);
    }

    function setToggle(enabled) {
        currentEnabled = enabled;
        toggleBtn.checked = enabled;
        toggleLabel.innerHTML = 'Geofence is <strong>' + (enabled ? 'ENABLED' : 'DISABLED') + '</strong>';
    }

    function showAlert(message, type) {
        statusAlert.className = 'alert alert-' + type + ' alert-dismissible fade show d-flex align-items-center';
        statusAlert.innerHTML = '<i class="bi bi-' + (type === 'success' ? 'check-circle' : 'exclamation-triangle') + ' me-2"></i>' + message + '<button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>';
        setTimeout(function () { statusAlert.classList.add('d-none'); }, 5000);
    }

    function enterEditMode() {
        isEditing = true;
        modeBadge.textContent = 'EDITING';
        modeBadge.className = 'badge bg-warning text-dark mode-badge';
        mapEl.className = 'edit-mode';
        mapHelpText.innerHTML = '<i class="bi bi-info-circle"></i> Drag the marker to set location. The <strong>blue circle</strong> shows the delivery radius.';
        branchNameInput.removeAttribute('readonly');
        radiusSlider.disabled = false;
        toggleBtn.disabled = false;
        locateBtn.disabled = false;
        locateBtn.classList.remove('locate-me-btn--hidden');
        viewActions.classList.add('d-none');
        editActions.classList.remove('d-none');
        updateMarker(currentLat, currentLng, currentRadius, true);
    }

    function exitEditMode() {
        isEditing = false;
        modeBadge.textContent = 'VIEWING';
        modeBadge.className = 'badge bg-secondary mode-badge';
        mapEl.className = 'view-mode';
        mapHelpText.innerHTML = '<i class="bi bi-info-circle"></i> The map shows your current restaurant location. Click <strong>Edit</strong> to make changes.';
        branchNameInput.setAttribute('readonly', 'readonly');
        radiusSlider.disabled = true;
        toggleBtn.disabled = true;
        locateBtn.disabled = true;
        locateBtn.classList.add('locate-me-btn--hidden');
        viewActions.classList.remove('d-none');
        editActions.classList.add('d-none');
        updateMarker(currentLat, currentLng, currentRadius, false);
    }

    function loadSettings() {
        var token = localStorage.getItem('hof_token') || '';
        var headers = token ? { 'Authorization': 'Bearer ' + token } : {};
        fetch(API + '/get_location.php', { headers: headers }).then(function (r) { return r.json(); }).then(function (data) {
            if (!data.success) throw new Error(data.message || 'Failed to load');
            var s = data.settings;
            isNewSetup = Boolean(s.is_new);
            currentBranchName = s.branch_name || '';
            currentLat = s.latitude !== null ? parseFloat(s.latitude) : 8.5372;
            currentLng = s.longitude !== null ? parseFloat(s.longitude) : 124.8269;
            currentRadius = parseInt(s.radius_meters, 10);
            currentEnabled = Boolean(s.geofence_enabled);
            savedBranchName = currentBranchName;
            savedLat = currentLat;
            savedLng = currentLng;
            savedRadius = currentRadius;
            savedEnabled = currentEnabled;
            branchNameInput.value = currentBranchName;
            latInput.value = currentLat.toFixed(7);
            lngInput.value = currentLng.toFixed(7);
            radiusSlider.value = currentRadius;
            radiusDisplay.textContent = currentRadius;
            setToggle(currentEnabled);
            if (isNewSetup) {
                showAlert('Welcome! Set up your location for the first time.', 'info');
                enterEditMode();
            } else {
                exitEditMode();
            }
            updateMarker(currentLat, currentLng, currentRadius, false);
        }).catch(function (err) {
            console.warn('Could not load location settings:', err);
            exitEditMode();
            updateMarker(currentLat, currentLng, currentRadius, false);
        });
    }

    function saveSettings() {
        currentBranchName = branchNameInput.value.trim();
        if (!currentBranchName || currentBranchName.length < 3) {
            showAlert('Branch name must be at least 3 characters', 'warning');
            return;
        }
        if (currentLat === null || currentLng === null) {
            showAlert('Please set a location on the map', 'warning');
            return;
        }
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Saving...';
        var token = localStorage.getItem('hof_token') || '';
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        fetch(API + '/update_location.php', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ branch_name: currentBranchName, latitude: currentLat, longitude: currentLng, radius_meters: currentRadius, geofence_enabled: currentEnabled ? 1 : 0 })
        }).then(function (r) {
            var status = r.status;
            return r.text().then(function (text) {
                try { return { ok: r.ok, status: status, data: JSON.parse(text) }; }
                catch (e) { throw new Error('Server returned: ' + text.substring(0, 200)); }
            });
        }).then(function (res) {
            if (!res.ok) throw new Error(res.data.message || 'Save failed (' + res.status + ')');
            if (res.data.success) {
                showAlert(isNewSetup ? 'Initial setup complete! Your location has been saved.' : 'Location settings saved successfully!', 'success');
                savedBranchName = currentBranchName;
                savedLat = currentLat;
                savedLng = currentLng;
                savedRadius = currentRadius;
                savedEnabled = currentEnabled;
                isNewSetup = false;
                exitEditMode();
            } else {
                showAlert(res.data.message || 'Failed to save', 'danger');
            }
        }).catch(function (err) {
            showAlert(err.message || 'Save failed. Check database.', 'danger');
            console.error('Could not save:', err);
        }).finally(function () {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i> Save Changes';
        });
    }

    function cancelEdit() {
        currentBranchName = savedBranchName;
        currentLat = savedLat;
        currentLng = savedLng;
        currentRadius = savedRadius;
        currentEnabled = savedEnabled;
        branchNameInput.value = currentBranchName;
        latInput.value = currentLat.toFixed(7);
        lngInput.value = currentLng.toFixed(7);
        radiusSlider.value = currentRadius;
        radiusDisplay.textContent = currentRadius;
        setToggle(currentEnabled);
        exitEditMode();
        showAlert('Changes discarded', 'info');
    }

    function locateMe() {
        if (!navigator.geolocation) { showAlert('Geolocation not supported', 'warning'); return; }
        locateBtn.disabled = true;
        locateBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Locating...';
        navigator.geolocation.getCurrentPosition(function (pos) {
            setCoords(pos.coords.latitude, pos.coords.longitude);
            showAlert('Your location found! Drag to adjust.', 'info');
            locateBtn.disabled = false;
            locateBtn.innerHTML = '<i class="bi bi-crosshair"></i> Locate Me';
        }, function () {
            showAlert('Could not get location. Check GPS permissions.', 'warning');
            locateBtn.disabled = false;
            locateBtn.innerHTML = '<i class="bi bi-crosshair"></i> Locate Me';
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
    }

    radiusSlider.addEventListener('input', function () { setRadius(this.value); });
    toggleBtn.addEventListener('change', function () { setToggle(this.checked); });
    editBtn.addEventListener('click', enterEditMode);
    saveBtn.addEventListener('click', saveSettings);
    cancelBtn.addEventListener('click', cancelEdit);
    locateBtn.addEventListener('click', locateMe);

    // Initialize when DOM and Leaflet are ready
    if (typeof L !== 'undefined') {
        initMap();
    } else {
        mapEl.innerHTML = '<div class="alert alert-warning m-3">Map library not loaded. Check your internet connection.</div>';
    }
})();