/**
 * HOF image-helper.js (REQ-057)
 * ------------------------------------------------------------
 * Shared client-side canvas compression + blob render helpers.
 * All inventory / menu pages reuse this instead of duplicating
 * per-page compress logic.
 *
 *   HOFImage.compress(file, maxWidth, quality) -> Promise<Blob>
 *       Downscales (max 800px by default) and re-encodes as JPEG
 *       (quality 0.65 by default). Falls back to the original file
 *       when the browser cannot create a canvas blob.
 *
 *   HOFImage.blobSrc(row, urlField, blobField) -> string
 *       Returns a data URI when the row carries a base64 blob
 *       (blobField), otherwise the legacy URL column (urlField)
 *       normalized to a root-absolute path. Safe: the blob is
 *       already base64 from the backend; never interpolated raw.
 *
 *   HOFImage.esc(value) -> string
 *       HTML-escape helper for attribute-safe interpolation.
 */
(function () {
    'use strict';

    function esc(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function compress(file, maxWidth, quality) {
        maxWidth = maxWidth || 800;
        quality = quality === undefined ? 0.65 : quality;
        return new Promise(function (resolve) {
            if (!file || !file.type || !/image\//.test(file.type)) {
                resolve(file);
                return;
            }
            var reader = new FileReader();
            reader.onload = function (e) {
                var img = new Image();
                img.onload = function () {
                    try {
                        var canvas = document.createElement('canvas');
                        var w = img.width, h = img.height;
                        if (w > maxWidth) { h = h * maxWidth / w; w = maxWidth; }
                        canvas.width = Math.max(1, Math.floor(w));
                        canvas.height = Math.max(1, Math.floor(h));
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                        canvas.toBlob(function (blob) {
                            resolve(blob || file);
                        }, 'image/jpeg', quality);
                    } catch (err) {
                        console.error('HOFImage.compress error:', err);
                        resolve(file);
                    }
                };
                img.onerror = function () { resolve(file); };
                img.src = e.target.result;
            };
            reader.onerror = function () { resolve(file); };
            reader.readAsDataURL(file);
        });
    }

    function blobSrc(row, urlField, blobField) {
        var blob = row && row[blobField];
        if (blob && typeof blob === 'string' && blob.length > 0) {
            if (/^data:image\//i.test(blob)) return blob;
            return 'data:image/jpeg;base64,' + blob;
        }
        var url = row && row[urlField];
        if (!url) return '/images/placeholder.png';
        if (/^(https?:)?\/\//i.test(url)) return url;
        if (url.charAt(0) === '/') return url;
        return '/' + url;
    }

    window.HOFImage = {
        compress: compress,
        blobSrc: blobSrc,
        esc: esc
    };
})();
