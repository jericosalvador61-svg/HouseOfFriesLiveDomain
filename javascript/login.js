document.addEventListener("DOMContentLoaded", () => {

    const loginForm = document.getElementById("loginForm");

    const num1El = document.getElementById("num1");
    const num2El = document.getElementById("num2");
    const captchaInput = document.getElementById("captchaAnswer");

    const passwordInput = document.getElementById("password");
    const togglePassword = document.getElementById("togglePassword");

    // Change Password Modal elements
    const changePasswordModalEl = document.getElementById("changePasswordModal");
    const changePasswordModal = changePasswordModalEl ? new bootstrap.Modal(changePasswordModalEl, { backdrop: 'static', keyboard: false }) : null;
    const newPasswordInput = document.getElementById("newPassword");
    const confirmPasswordInput = document.getElementById("confirmPassword");
    const btnChangePassword = document.getElementById("btnChangePassword");
    const btnText = document.getElementById("btnText");
    const btnSpinner = document.getElementById("btnSpinner");
    const toggleNewPassword = document.getElementById("toggleNewPassword");
    const toggleConfirmPassword = document.getElementById("toggleConfirmPassword");
    const confirmError = document.getElementById("confirmError");
    const confirmSuccess = document.getElementById("confirmSuccess");
    const passwordStrengthFill = document.getElementById("passwordStrengthFill");

    // Requirement elements
    const reqLength = document.getElementById("req-length");
    const reqUppercase = document.getElementById("req-uppercase");
    const reqNumber = document.getElementById("req-number");
    const reqSpecial = document.getElementById("req-special");

    let currentTempToken = null;
    let currentCaptchaAnswer = 0;

    // Generate initial captcha
    function generateCaptcha() {
        const num1 = Math.floor(Math.random() * 10);
        const num2 = Math.floor(Math.random() * 10);
        num1El.textContent = num1;
        num2El.textContent = num2;
        currentCaptchaAnswer = num1 + num2;
    }

    generateCaptcha();

    // Update captcha from server response
    function updateCaptcha(captchaData) {
        if (captchaData && typeof captchaData.num1 === 'number' && typeof captchaData.num2 === 'number') {
            num1El.textContent = captchaData.num1;
            num2El.textContent = captchaData.num2;
            currentCaptchaAnswer = captchaData.num1 + captchaData.num2;
        } else {
            generateCaptcha();
        }
        captchaInput.value = '';
        captchaInput.classList.remove("correct", "incorrect");
    }

    // =========================
    // CAPTCHA LIVE VALIDATION
    // =========================
    captchaInput.addEventListener("input", () => {
        const value = parseInt(captchaInput.value);
        captchaInput.classList.remove("correct", "incorrect");
        if (captchaInput.value === "") return;
        if (value === currentCaptchaAnswer) {
            captchaInput.classList.add("correct");
        } else {
            captchaInput.classList.add("incorrect");
        }
    });

    // =========================
    // PASSWORD TOGGLE (Login form)
    // =========================
    togglePassword.addEventListener("click", () => {
        const type = passwordInput.getAttribute("type") === "password" ? "text" : "password";
        passwordInput.setAttribute("type", type);
        togglePassword.classList.toggle("bi-eye");
        togglePassword.classList.toggle("bi-eye-slash");
    });

    // =========================
    // PASSWORD TOGGLE (Change Password Modal)
    // =========================
    function setupToggle(toggleBtn, input) {
        toggleBtn.addEventListener("click", () => {
            const type = input.getAttribute("type") === "password" ? "text" : "password";
            input.setAttribute("type", type);
            toggleBtn.classList.toggle("bi-eye");
            toggleBtn.classList.toggle("bi-eye-slash");
        });
    }

    setupToggle(toggleNewPassword, newPasswordInput);
    setupToggle(toggleConfirmPassword, confirmPasswordInput);

    // =========================
    // PASSWORD STRENGTH VALIDATION (Modal)
    // =========================
    function validatePassword(password) {
        const checks = {
            length: password.length >= 6,
            uppercase: /[A-Z]/.test(password),
            number: /[0-9]/.test(password),
            special: /[^A-Za-z0-9]/.test(password)
        };

        updateRequirement(reqLength, checks.length);
        updateRequirement(reqUppercase, checks.uppercase);
        updateRequirement(reqNumber, checks.number);
        updateRequirement(reqSpecial, checks.special);

        const metCount = Object.values(checks).filter(Boolean).length;
        const percentage = (metCount / 4) * 100;
        passwordStrengthFill.style.width = percentage + "%";

        if (metCount <= 1) passwordStrengthFill.style.backgroundColor = "#dc3545";
        else if (metCount <= 2) passwordStrengthFill.style.backgroundColor = "#ffc107";
        else if (metCount <= 3) passwordStrengthFill.style.backgroundColor = "#fd7e14";
        else passwordStrengthFill.style.backgroundColor = "#28a745";

        return checks;
    }

    function updateRequirement(element, met) {
        if (met) {
            element.classList.add("met");
            element.querySelector("i").className = "bi bi-check-circle";
        } else {
            element.classList.remove("met");
            element.querySelector("i").className = "bi bi-x-circle";
        }
    }

    function checkPasswordsMatch() {
        const newPass = newPasswordInput.value;
        const confirmPass = confirmPasswordInput.value;
        if (confirmPass === "") {
            confirmPasswordInput.classList.remove("is-valid", "is-invalid");
            confirmError.style.display = "none";
            confirmSuccess.style.display = "none";
            return false;
        }
        if (newPass === confirmPass) {
            confirmPasswordInput.classList.add("is-valid");
            confirmPasswordInput.classList.remove("is-invalid");
            confirmError.style.display = "none";
            confirmSuccess.style.display = "block";
            return true;
        } else {
            confirmPasswordInput.classList.add("is-invalid");
            confirmPasswordInput.classList.remove("is-valid");
            confirmError.style.display = "block";
            confirmSuccess.style.display = "none";
            return false;
        }
    }

    function updateSubmitButton() {
        const checks = validatePassword(newPasswordInput.value);
        const allMet = Object.values(checks).every(Boolean);
        const passwordsMatch = checkPasswordsMatch();
        btnChangePassword.disabled = !(allMet && passwordsMatch);
    }

    newPasswordInput.addEventListener("input", updateSubmitButton);
    confirmPasswordInput.addEventListener("input", () => {
        checkPasswordsMatch();
        updateSubmitButton();
    });

    if (changePasswordModalEl) {
        changePasswordModalEl.addEventListener('hidden.bs.modal', () => {
            newPasswordInput.value = '';
            confirmPasswordInput.value = '';
            newPasswordInput.classList.remove('is-valid', 'is-invalid');
            confirmPasswordInput.classList.remove('is-valid', 'is-invalid');
            confirmError.style.display = "none";
            confirmSuccess.style.display = "none";
            updateSubmitButton();
            [reqLength, reqUppercase, reqNumber, reqSpecial].forEach(el => {
                el.classList.remove('met');
                el.querySelector('i').className = 'bi bi-x-circle';
            });
            passwordStrengthFill.style.width = '0%';
        });
    }

    // =========================
    // CHANGE PASSWORD SUBMIT (Modal)
    // =========================
    btnChangePassword.addEventListener("click", async () => {
        const newPassword = newPasswordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        const checks = validatePassword(newPassword);
        const allMet = Object.values(checks).every(Boolean);
        const passwordsMatch = (newPassword === confirmPassword);

        if (!allMet || !passwordsMatch) return;
        if (!currentTempToken) {
            Swal.fire({ icon: "error", title: "Session Expired", text: "Please log in again." });
            changePasswordModal.hide();
            return;
        }

        LoadingManager.show(btnChangePassword, { text: 'Changing...' });

        try {
            const res = await fetch("/backend/auth/change_password_first_login.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: currentTempToken, new_password: newPassword, confirm_password: confirmPassword })
            });
            const data = await res.json();
            if (!data.success) {
                Swal.fire({ icon: "error", title: "Failed", text: data.message });
                return;
            }
            // Save token in BOTH localStorage and cookie (for page_gate.php server-side check)
                        localStorage.setItem("hof_token", data.token);
                        document.cookie = "hof_token=" + data.token + "; path=/; SameSite=Strict";
                        changePasswordModal.hide();
            Swal.fire({ icon: "success", title: "Password Changed!", text: "Welcome to House of Fries", timer: 1500, showConfirmButton: false })
                .then(() => {
                    // Option-D: same app-root prefix as login redirect.
                    let target = data.redirect || "index.html";
                    try {
                        const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
                        const root = (m && m[1]) ? m[1].replace(/\/$/, "") : "";
                        if (target.startsWith("/") && root) target = root + target;
                    } catch (_) { /* use raw target */ }
                    window.location.href = target;
                });
        } catch (err) {
            console.error("Password change failed:", err);
            Swal.fire({ icon: "error", title: "Server Error", text: "Please try again later." });
        } finally {
            LoadingManager.hide(btnChangePassword);
        }
    });

    // =========================
    // LOGIN SUBMIT with Rate Limiting
    // =========================
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const username = document.getElementById("username").value.trim();
        const password = passwordInput.value.trim();
        const captchaAnswer = parseInt(captchaInput.value);

        if (captchaAnswer !== currentCaptchaAnswer) {
            Swal.fire({ icon: "error", title: "Captcha Incorrect", text: "Please solve the captcha correctly." });
            return;
        }

        const submitBtn = loginForm.querySelector('button[type="submit"]');
        LoadingManager.show(submitBtn, { text: 'Logging in...' });

        try {
            const res = await fetch("/backend/login.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            // Handle rate limiting responses
            if (!data.success) {
                // Update captcha from server (always refreshed on failure)
                updateCaptcha(data.captcha);

                if (data.locked) {
                    // Account locked - show lockout message with timer
                    const minutes = data.lock_minutes || Math.ceil(data.remaining_seconds / 60);
                    const lockMessages = {
                        1: "5 minutes",
                        2: "10 minutes", 
                        3: "30 minutes"
                    };
                    const lockMsg = lockMessages[data.lock_level] || `${minutes} minute(s)`;
                    
                    Swal.fire({
                        icon: "warning",
                        title: "Account Temporarily Locked",
                        html: `
                            Too many failed attempts.<br>
                            <strong>Lock Level ${data.lock_level}</strong>: Try again in <strong>${lockMsg}</strong>.<br>
                            <small>Remaining time: <span id="lockCountdown">${data.remaining_seconds}s</span></small>
                        `,
                        showConfirmButton: false,
                        timer: data.remaining_seconds * 1000,
                        timerProgressBar: true,
                        didOpen: () => {
                            const countdownEl = document.getElementById('lockCountdown');
                            if (countdownEl) {
                                const interval = setInterval(() => {
                                    const remaining = parseInt(countdownEl.textContent) - 1;
                                    if (remaining > 0) countdownEl.textContent = remaining + 's';
                                    else clearInterval(interval);
                                }, 1000);
                            }
                        }
                    });
                } else if (data.remaining_attempts !== undefined) {
                    // Failed but not locked yet - show remaining attempts
                    Swal.fire({
                        icon: "error",
                        title: "Login Failed",
                        html: `${data.message}<br><small>Attempts remaining: <strong>${data.remaining_attempts}</strong></small>`
                    });
                } else {
                    // Other errors
                    Swal.fire({ icon: "error", title: "Login Failed", text: data.message });
                }
                return;
            }

            // Update captcha for next session
            updateCaptcha(data.captcha);

            // Check if user must change password (first login or admin reset)
            if (data.must_change_password) {
                            currentTempToken = data.token;
                            // Save token in BOTH localStorage and cookie (for page_gate.php server-side check)
                            localStorage.setItem("hof_token", data.token);
                            document.cookie = "hof_token=" + data.token + "; path=/; SameSite=Strict";

                            Swal.fire({
                    icon: "info",
                    title: "First Login Required",
                    text: "Please set your new password to continue.",
                    timer: 2000,
                    showConfirmButton: false
                }).then(() => {
                    if (changePasswordModal) changePasswordModal.show();
                });
                return;
            }

            // Save token and redirect (BOTH localStorage AND cookie for page_gate.php)
                                    localStorage.setItem("hof_token", data.token);
                                    document.cookie = "hof_token=" + data.token + "; path=/; SameSite=Strict";
                        Swal.fire({
                            icon: "success",
                            title: "Login Successful",
                            text: "Welcome back!",
                            timer: 1500,
                            showConfirmButton: false
                        }).then(() => {
                            // Option-D: backend returns domain-root paths (/public/...).
                            // On localhost the app lives in a subfolder, so prefix
                            // the detected app root; on InfinityFree root it
                            // stays unchanged. Same-block helper avoids globals.
                            let target = data.redirect || "index.html";
                            try {
                                const m = window.location.pathname.match(/^(.*?)(?:\/public|\/customer|\/backend|\/admin|\/cashier|\/inventoryStaff|\/kitchenStaff|\/waiter|\/supervisor)(?:\/|$)/i);
                                const root = (m && m[1]) ? m[1].replace(/\/$/, "") : "";
                                if (target.startsWith("/") && root) target = root + target;
                            } catch (_) { /* use raw target */ }
                            window.location.href = target;
                        });

        } catch (err) {
            console.error("Login failed:", err);
            Swal.fire({ icon: "error", title: "Server Error", text: "Please try again later." });
        } finally {
            LoadingManager.hide(submitBtn);
        }
    });

});