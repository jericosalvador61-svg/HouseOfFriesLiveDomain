// ====================================================================
// HOUSE OF FRIES - CENTRAL API CONFIGURATION
// ====================================================================
// This file MUST be loaded BEFORE any other JS that makes API calls.
// It detects the environment and sets the correct API base path.
//
// LOCAL:  http://localhost/houseoffries_group_code/  -> base = "/houseoffries_group_code"
// LIVE:   https://house-of-fries.great-site.net/     -> base = ""
// ====================================================================

(function() {
    'use strict';
    
    // Detect if we're on localhost or a local IP
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.') || hostname.startsWith('10.0.');
    
    // Get the path prefix (e.g., "/houseoffries_group_code" when running in subfolder)
    let pathPrefix = '';
    if (isLocal) {
        const pathParts = window.location.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) {
            // First path segment is the project folder
            pathPrefix = '/' + pathParts[0];
        }
    }
    // On live domain (root), pathPrefix stays empty
    
    // Export as global for all scripts to use
    window.HOF_CONFIG = {
        API_BASE: pathPrefix + '/backend',
        ASSETS_BASE: pathPrefix + '/images',
        IS_LOCAL: isLocal,
        PATH_PREFIX: pathPrefix
    };
    
    // Also expose a helper for making authenticated fetches
    // Option-D: uses APP_ROOT detection (same regex as check_session.js)
    // instead of naive first-segment, and NEVER forces redirect:'manual'
    // (that yields opaque-redirect status-0 responses whose body can't be
    // read, breaking res.json() callers).
    window.hofFetch = async function(url, options = {}) {
        const token = localStorage.getItem('hof_token');

        if (!options.headers) {
            options.headers = {};
        }
        options.headers['Authorization'] = `Bearer ${token}`;

        const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
        const appRoot = (m && m[1]) ? m[1].replace(/\/$/, '') : '';

        // Prepend app root if URL starts with /backend
        let fullUrl = url;
        if (url.startsWith('/backend/')) {
            fullUrl = appRoot + url;
        } else if (url.startsWith('/') && appRoot) {
            fullUrl = appRoot + url;
        }

        const response = await fetch(fullUrl, options);
        
        if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
                // Token expired or invalid
                localStorage.removeItem('hof_token');
                document.cookie = 'hof_token=; path=/; Max-Age=0; SameSite=Strict';
                // Don't redirect here - let the page handle it
            }
            throw new Error(`Request failed: ${response.status}`);
        }
        
        return response;
    };
    
    console.log('[HOF_CONFIG] Initialized:', window.HOF_CONFIG);
})();