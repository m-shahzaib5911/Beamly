// ═══════════════════════════════════════════
//  Beamly — Auth Page Logic
//  Login / Sign Up / Password Reset handling
// ═══════════════════════════════════════════

let pendingSignupEmail = '';

// Check if already logged in
(async function checkAuth() {

    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.loggedIn) {
            window.location.href = '/dashboard.html';
            return;
        }
    } catch (err) {
        // Not logged in, stay on page
    }

    initView();
})();

function initView() {
    switchTab('login');
}

function resetFormsVisibility() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const signupVerifyForm = document.getElementById('signup-verify-form');
    const resetRequestForm = document.getElementById('reset-request-form');
    const resetConfirmForm = document.getElementById('reset-confirm-form');

    loginForm.classList.add('hidden');
    signupForm.classList.add('hidden');
    signupVerifyForm.classList.add('hidden');
    resetRequestForm.classList.add('hidden');
    resetConfirmForm.classList.add('hidden');
}

function clearAuthMessage() {
    const authMessage = document.getElementById('auth-message');
    authMessage.textContent = '';
    authMessage.className = 'auth-message';
}

function setTabs(tab) {
    const loginTab = document.getElementById('login-tab');
    const signupTab = document.getElementById('signup-tab');
    loginTab.classList.toggle('active', tab === 'login');
    signupTab.classList.toggle('active', tab === 'signup');
}

// ─── Tab Switching ───
function switchTab(tab) {
    clearAuthMessage();
    const verifyCodeInput = document.getElementById('signup-verification-code');
    const verifyEmailInput = document.getElementById('signup-verify-email');
    const resetCodeInput = document.getElementById('reset-verification-code');
    if (verifyCodeInput) verifyCodeInput.value = '';
    if (verifyEmailInput) verifyEmailInput.value = '';
    if (resetCodeInput) resetCodeInput.value = '';

    resetFormsVisibility();
    setTabs(tab);

    if (tab === 'login') {
        document.getElementById('login-form').classList.remove('hidden');
    } else {
        document.getElementById('signup-form').classList.remove('hidden');
    }
}

function showPasswordResetRequest() {
    clearAuthMessage();
    resetFormsVisibility();
    setTabs(null);
    document.getElementById('reset-request-form').classList.remove('hidden');
}

function showPasswordResetConfirm() {
    clearAuthMessage();
    resetFormsVisibility();
    setTabs(null);
    document.getElementById('reset-confirm-form').classList.remove('hidden');
}

function showSignupVerification(email) {
    clearAuthMessage();
    resetFormsVisibility();
    setTabs('signup');
    pendingSignupEmail = email;

    const emailInput = document.getElementById('signup-verify-email');
    const codeInput = document.getElementById('signup-verification-code');
    emailInput.value = email;
    codeInput.value = '';
    document.getElementById('signup-verify-form').classList.remove('hidden');
}

function backToSignupFromVerification() {
    clearAuthMessage();
    pendingSignupEmail = '';
    resetFormsVisibility();
    setTabs('signup');
    document.getElementById('signup-form').classList.remove('hidden');
}

function getResetTokenFromHash() {
    return null;
}

// ─── Login Handler ───
async function handleLogin(e) {
    e.preventDefault();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    if (!email || !password) {
        showMessage('Please fill in all fields', 'error');
        return false;
    }

    btn.disabled = true;
    btn.textContent = 'Logging in...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok) {
            showMessage('Login successful! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 800);
        } else {
            showMessage(data.error || 'Login failed', 'error');
            btn.disabled = false;
            btn.textContent = 'Login';
        }
    } catch (err) {
        showMessage('Connection error. Try again.', 'error');
        btn.disabled = false;
        btn.textContent = 'Login';
    }

    return false;
}

// ─── Signup Handler ───
async function handleSignup(e) {
    e.preventDefault();

    const username = document.getElementById('signup-username').value.trim();
    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const btn = document.getElementById('signup-btn');

    if (!username || !email || !password) {
        showMessage('Please fill in all fields', 'error');
        return false;
    }

    if (username.length < 3) {
        showMessage('Username must be at least 3 characters', 'error');
        return false;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        showMessage('Username: letters, numbers, underscores only', 'error');
        return false;
    }

    if (password.length < 6) {
        showMessage('Password must be at least 6 characters', 'error');
        return false;
    }

    btn.disabled = true;
    btn.textContent = 'Sending code...';

    try {
        const res = await fetch('/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email, password })
        });

        const data = await res.json();

        if (res.ok) {
            if (data.verificationRequired) {
                showSignupVerification(email);
                showMessage(data.message || 'Verification code sent to your email.', 'success');
            } else {
                showMessage('Account created! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = '/dashboard.html';
                }, 800);
            }
        } else {
            showMessage(data.error || 'Signup failed', 'error');
        }
    } catch (err) {
        showMessage('Connection error. Try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Create Account';
    }

    return false;
}

async function handleSignupVerification(e) {
    e.preventDefault();

    const email = (pendingSignupEmail || document.getElementById('signup-verify-email').value || '').trim();
    const code = (document.getElementById('signup-verification-code').value || '').trim();
    const btn = document.getElementById('signup-verify-btn');

    if (!email) {
        showMessage('Signup email is missing. Please submit sign up again.', 'error');
        return false;
    }

    if (!/^\d{6}$/.test(code)) {
        showMessage('Enter a valid 6-digit verification code.', 'error');
        return false;
    }

    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
        const res = await fetch('/api/auth/signup/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, code })
        });
        const data = await res.json();

        if (res.ok) {
            showMessage('Account verified! Redirecting...', 'success');
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 800);
        } else {
            showMessage(data.error || 'Verification failed', 'error');
        }
    } catch (err) {
        showMessage('Connection error. Try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Verify & Create Account';
    }

    return false;
}

async function handlePasswordResetRequest(e) {
    e.preventDefault();
    const email = document.getElementById('reset-email').value.trim();
    const btn = document.getElementById('reset-request-btn');

    if (!email) {
        showMessage('Please enter your email.', 'error');
        return false;
    }

    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
        const res = await fetch('/api/auth/password-reset/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await res.json();

        if (!res.ok) {
            showMessage(data.error || 'Failed to request password reset.', 'error');
            btn.disabled = false;
            btn.textContent = 'Send Reset Link';
            return false;
        }

        showMessage('Verification code sent to your email.', 'success');
        showPasswordResetConfirm();
    } catch (err) {
        showMessage('Connection error. Try again.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Send Reset Link';
    }

    return false;
}

async function handlePasswordResetConfirm(e) {
    e.preventDefault();
    const token = (document.getElementById('reset-verification-code').value || '').trim();
    const newPassword = document.getElementById('reset-new-password').value;
    const confirmPassword = document.getElementById('reset-confirm-password').value;
    const btn = document.getElementById('reset-confirm-btn');

    if (!token) {
        showMessage('Verification code is required.', 'error');
        return false;
    }

    if (newPassword.length < 6) {
        showMessage('Password must be at least 6 characters.', 'error');
        return false;
    }

    if (newPassword !== confirmPassword) {
        showMessage('Passwords do not match.', 'error');
        return false;
    }

    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
        const res = await fetch('/api/auth/password-reset/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, newPassword })
        });
        const data = await res.json();

        if (!res.ok) {
            showMessage(data.error || 'Failed to reset password.', 'error');
            btn.disabled = false;
            btn.textContent = 'Update Password';
            return false;
        }

        showMessage('Password updated. Redirecting to login...', 'success');
        setTimeout(() => switchTab('login'), 1000);
    } catch (err) {
        showMessage('Connection error. Try again.', 'error');
        btn.disabled = false;
        btn.textContent = 'Update Password';
    }

    return false;
}

// ─── Show Message ───
function showMessage(text, type) {
    const msg = document.getElementById('auth-message');
    msg.textContent = text;
    msg.className = `auth-message ${type}`;
}
