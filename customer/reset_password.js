/**
 * customer/reset_password.js
 * REQ-052 Batch 3 — Customer self-service password reset page.
 * Guest-accessible (no JWT required) — calls customer/reset_password.php
 * with the staff-provided temp code.
 */
(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        var form = document.getElementById('resetForm');
        if (!form) return;

        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            var phone = (document.getElementById('phone').value || '').trim();
            var tempCode = (document.getElementById('tempCode').value || '').trim();
            var newPassword = document.getElementById('newPassword').value;
            var confirmPassword = document.getElementById('confirmPassword').value;

            if (!phone || !tempCode || !newPassword || !confirmPassword) {
                Swal.fire({ icon: 'warning', title: 'Missing Info', text: 'Please fill in all fields.', confirmButtonColor: '#FFB800' });
                return;
            }

            var btn = document.getElementById('resetBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Resetting...'; }

            try {
                var resp = await fetch('reset_password.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        phone: normalizePhone(phone),
                        temp_code: tempCode,
                        new_password: newPassword,
                        confirm_password: confirmPassword
                    })
                });
                var data = await resp.json();

                if (!data.success) {
                    Swal.fire({ icon: 'error', title: 'Reset Failed', text: data.message || 'Please check your details.', confirmButtonColor: '#FFB800' });
                    return;
                }

                Swal.fire({
                    icon: 'success',
                    title: 'Password Reset!',
                    text: data.message || 'You can now log in with your new password.',
                    confirmButtonColor: '#FFB800'
                }).then(function () {
                    window.location.href = 'orderHistory.html';
                });
            } catch (err) {
                Swal.fire({ icon: 'error', title: 'Error', text: 'Could not reach the server. Please try again.', confirmButtonColor: '#FFB800' });
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Reset Password'; }
            }
        });
    });

    function normalizePhone(p) {
        p = String(p || '').replace(/[^0-9]/g, '');
        if (p.length === 12 && p.slice(0, 2) === '63') p = '0' + p.slice(2);
        return p;
    }
})();