// ═══════════════════════════════════════════
//  Beamly — Dashboard Logic
//  User dashboard, history, account info
// ═══════════════════════════════════════════

let currentUser = null;

// ─── Initialize ───
(async function init() {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();

        if (!data.loggedIn) {
            window.location.href = '/auth.html';
            return;
        }

        currentUser = data.user;
        renderUserInfo();
        await loadHistory();
        await loadStarred();
        await loadSettings();
        await loadLoginHistory();
        await loadAuditLogs();
        initEditAccountForm();
        initChangePasswordForm();
    } catch (err) {
        console.error('Dashboard init error:', err);
        window.location.href = '/auth.html';
    }
})();

// ─── Render User Info ───
function renderUserInfo() {
    document.getElementById('dash-username').textContent = currentUser.username;
    document.getElementById('info-username').textContent = currentUser.username;
    document.getElementById('info-email').textContent = currentUser.email;

    const joinDate = new Date(currentUser.createdAt);
    document.getElementById('info-joined').textContent = joinDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    // Vault storage stat
    const vaultEl = document.getElementById('stat-vault');
    if (vaultEl && currentUser.storageUsed !== undefined) {
        vaultEl.textContent = formatFileSize(currentUser.storageUsed);
    }
}

// ─── Load Transfer History ───
async function loadHistory() {
    const loading = document.getElementById('history-loading');
    const empty = document.getElementById('history-empty');
    const tableContainer = document.getElementById('history-table-container');
    const tbody = document.getElementById('history-tbody');

    try {
        const res = await fetch('/api/user/history');
        const data = await res.json();

        loading.classList.add('hidden');

        if (!data.history || data.history.length === 0) {
            empty.classList.remove('hidden');
            document.getElementById('stat-total').textContent = '0';
            document.getElementById('stat-sent').textContent = '0';
            document.getElementById('stat-received').textContent = '0';
            return;
        }

        // Calculate stats
        const total = data.history.length;
        const sent = data.history.filter(h => h.direction === 'sent').length;
        const received = data.history.filter(h => h.direction === 'received').length;

        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-sent').textContent = sent;
        document.getElementById('stat-received').textContent = received;

        // Render table rows
        tbody.innerHTML = '';
        data.history.forEach(item => {
            const tr = document.createElement('tr');

            const dateStr = new Date(item.transferred_at).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const directionBadge = item.direction === 'sent'
                ? '<span class="direction-badge sent">↑ Sent</span>'
                : '<span class="direction-badge received">↓ Received</span>';

            tr.innerHTML = `
                <td>
                    <div class="history-file-name">${escapeHtml(item.file_name_enc)}</div>
                    ${directionBadge}
                </td>
                <td class="mono">${formatFileSize(item.file_size)}</td>
                <td>${getFileTypeLabel(item.file_type)}</td>
                <td class="mono">${dateStr}</td>
            `;
            tbody.appendChild(tr);
        });

        tableContainer.classList.remove('hidden');

    } catch (err) {
        console.error('Load history error:', err);
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

// ─── Logout ───
async function handleLogout() {
    const btn = document.getElementById('logout-btn');
    btn.textContent = 'Logging out...';
    btn.disabled = true;

    try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/';
    } catch (err) {
        console.error('Logout error:', err);
        window.location.href = '/';
    }
}

// ─── Utilities ───
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileTypeLabel(mimeType) {
    if (!mimeType) return 'File';
    if (mimeType.startsWith('image/')) return 'Image';
    if (mimeType.startsWith('video/')) return 'Video';
    if (mimeType.startsWith('audio/')) return 'Audio';
    if (mimeType.includes('pdf')) return 'PDF';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z')) return 'Archive';
    if (mimeType.includes('text')) return 'Text';
    if (mimeType.includes('json') || mimeType.includes('xml')) return 'Data';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'Spreadsheet';
    if (mimeType.includes('document') || mimeType.includes('word')) return 'Document';
    return 'File';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Starred List ───
async function loadStarred() {
    const container = document.getElementById('starred-list');
    if (!container) return;
    container.innerHTML = '<div class="loading-spinner" style="width:24px;height:24px;margin:8px auto;"></div>';
    try {
        const res = await fetch('/api/starred');
        const data = await res.json();
        container.innerHTML = '';
        if (!data.files || data.files.length === 0) {
            container.innerHTML = '<div style="color:var(--txt-dim)">No starred files</div>';
            return;
        }

        data.files.forEach(f => {
            const row = document.createElement('div');
            row.className = 'starred-row';
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.padding = '8px 0';
            row.innerHTML = `
                <div style="flex:1">${escapeHtml(f.original_name || f.file_name || f.id)}</div>
                <div style="margin-left:12px"><a class="dash-link" href="/vault.html#file=${f.id}">View</a></div>
            `;
            container.appendChild(row);
        });
    } catch (err) {
        console.error('Load starred error:', err);
        container.innerHTML = '<div style="color:var(--error)">Failed to load starred files</div>';
    }
}

// ─── Settings ───
async function loadSettings() {
    try {
        const res = await fetch('/api/user/settings');
        const data = await res.json();
        const s = data.settings || {};
        const themeEl = document.getElementById('setting-theme');
        if (themeEl) themeEl.value = s.theme || 'dark';
        const notifEl = document.getElementById('setting-notifications');
        if (notifEl) notifEl.checked = !!s.notifications_enabled;
        const privacyEl = document.getElementById('setting-privacy');
        if (privacyEl) privacyEl.value = s.privacy_level || 'private';
        const autoEl = document.getElementById('setting-auto-delete');
        if (autoEl) autoEl.value = s.auto_delete_days || 30;

        // Apply theme on load
        applyTheme(s.theme || 'dark');

        const saveBtn = document.getElementById('save-settings-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', async () => {
                const payload = {
                    theme: document.getElementById('setting-theme').value,
                    notifications_enabled: document.getElementById('setting-notifications').checked,
                    privacy_level: document.getElementById('setting-privacy').value,
                    auto_delete_days: parseInt(document.getElementById('setting-auto-delete').value || '0')
                };
                const r = await fetch('/api/user/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                if (r.ok) {
                    alert('Settings saved');
                    applyTheme(payload.theme);
                } else {
                    alert('Failed to save settings');
                }
            });
        }
    } catch (err) {
        console.error('Load settings error:', err);
    }
}

function applyTheme(theme) {
    if (theme === 'light') {
        document.body.classList.add('light-theme');
    } else {
        document.body.classList.remove('light-theme');
    }
    // Clear particle canvas so old trail color doesn't persist
    const canvas = document.getElementById('bg-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    // Persist for other pages (vault, auth, etc.)
    localStorage.setItem('beamly-theme', theme);
}

// ─── Login History ───
async function loadLoginHistory() {
    const loading = document.getElementById('login-history-loading');
    const empty = document.getElementById('login-history-empty');
    const list = document.getElementById('login-history-list');
    if (!loading || !empty || !list) return;

    try {
        const res = await fetch('/api/auth/login-history?limit=20');
        const data = await res.json();
        const rows = data.history || [];

        loading.classList.add('hidden');
        list.innerHTML = '';

        if (rows.length === 0) {
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');
        list.classList.remove('hidden');

        rows.forEach(item => {
            const row = document.createElement('div');
            row.className = 'info-row';
            const dateText = new Date(item.logged_in_at).toLocaleString();
            const ip = item.ip_address || 'Unknown IP';
            const ua = item.user_agent || 'Unknown client';
            row.innerHTML = `
                <span class="info-label">${escapeHtml(ip)}</span>
                <span class="info-value" style="text-align:right; max-width: 65%;">
                    ${escapeHtml(ua)}<br><span style="color: var(--txt-dim); font-size: 0.78rem;">${dateText}</span>
                </span>
            `;
            list.appendChild(row);
        });
    } catch (err) {
        console.error('Load login history error:', err);
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

// ─── Audit Logs ───
async function loadAuditLogs() {
    const loading = document.getElementById('audit-loading');
    const empty = document.getElementById('audit-empty');
    const list = document.getElementById('audit-list');
    if (!loading || !empty || !list) return;

    try {
        const res = await fetch('/api/audit?limit=30');
        const data = await res.json();
        const logs = data.logs || [];

        loading.classList.add('hidden');
        list.innerHTML = '';

        if (logs.length === 0) {
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');
        list.classList.remove('hidden');

        logs.forEach(log => {
            const row = document.createElement('div');
            row.className = 'info-row';
            const action = (log.action || 'activity').replace(/_/g, ' ');
            const status = log.status === 'failure' ? '❌' : '✅';
            const when = new Date(log.logged_at).toLocaleString();
            row.innerHTML = `
                <span class="info-label">${status} ${escapeHtml(action)}</span>
                <span class="info-value">${when}</span>
            `;
            list.appendChild(row);
        });
    } catch (err) {
        console.error('Load audit logs error:', err);
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

// ─── Edit Account Info ───
function initEditAccountForm() {
    const toggleBtn = document.getElementById('toggle-edit-account-btn');
    const form = document.getElementById('edit-account-form');
    const msg = document.getElementById('edit-account-message');
    const usernameEl = document.getElementById('edit-username');
    const emailEl = document.getElementById('edit-email');
    const verificationBox = document.getElementById('email-verification-box');
    const verificationCode = document.getElementById('email-verification-code');
    const verificationMsg = document.getElementById('email-verification-message');
    const verificationHelp = document.getElementById('email-verification-help');
    const verifyBtn = document.getElementById('verify-email-change-btn');

    if (!toggleBtn || !form || !msg || !usernameEl || !emailEl || !verificationBox || !verificationCode || !verificationMsg || !verificationHelp || !verifyBtn) return;

    toggleBtn.addEventListener('click', () => {
        const isHidden = form.classList.contains('hidden');
        form.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? 'Cancel Edit' : 'Edit Account Info';

        if (isHidden) {
            usernameEl.value = currentUser?.username || '';
            emailEl.value = currentUser?.email || '';
        }

        verificationBox.classList.add('hidden');
        verificationCode.value = '';
        verificationHelp.textContent = 'Enter the 6-digit code sent to your new email.';
        verificationMsg.textContent = '';
        verificationMsg.className = 'auth-message';
        msg.textContent = '';
        msg.className = 'auth-message';
    });

    form.addEventListener('submit', handleEditAccountInfo);
    verifyBtn.addEventListener('click', handleVerifyEmailChange);
}

async function handleEditAccountInfo(e) {
    e.preventDefault();

    const username = document.getElementById('edit-username').value.trim();
    const email = document.getElementById('edit-email').value.trim();
    const btn = document.getElementById('save-account-info-btn');
    const msg = document.getElementById('edit-account-message');

    if (!username || !email) {
        msg.textContent = 'Username and email are required.';
        msg.className = 'auth-message error';
        return;
    }
    if (username.length < 3 || username.length > 50) {
        msg.textContent = 'Username must be 3-50 characters.';
        msg.className = 'auth-message error';
        return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        msg.textContent = 'Username: letters, numbers, underscores only.';
        msg.className = 'auth-message error';
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        msg.textContent = 'Invalid email format.';
        msg.className = 'auth-message error';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const res = await fetch('/api/user/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, email })
        });
        const data = await res.json();

        if (!res.ok) {
            msg.textContent = data.error || 'Failed to update account info.';
            msg.className = 'auth-message error';
            return;
        }

        const verificationBox = document.getElementById('email-verification-box');
        const verificationHelp = document.getElementById('email-verification-help');
        const verificationMsg = document.getElementById('email-verification-message');

        if (data.verificationRequired) {
            verificationBox.classList.remove('hidden');
            verificationHelp.textContent = data.message || 'Enter the 6-digit verification code sent to your new email.';
            verificationMsg.textContent = '';
            verificationMsg.className = 'auth-message';
            msg.textContent = 'Email change is pending verification.';
            msg.className = 'auth-message success';
            return;
        }

        currentUser.username = data.user?.username || username;
        currentUser.email = data.user?.email || email;
        renderUserInfo();

        msg.textContent = 'Account info updated successfully.';
        msg.className = 'auth-message success';

        if (verificationBox) verificationBox.classList.add('hidden');
    } catch (err) {
        msg.textContent = 'Cannot reach server. Please try again.';
        msg.className = 'auth-message error';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Save Account Info';
    }
}

async function handleVerifyEmailChange() {
    const codeEl = document.getElementById('email-verification-code');
    const msg = document.getElementById('email-verification-message');
    const editMsg = document.getElementById('edit-account-message');
    const btn = document.getElementById('verify-email-change-btn');
    const form = document.getElementById('edit-account-form');
    const toggleBtn = document.getElementById('toggle-edit-account-btn');
    const verificationBox = document.getElementById('email-verification-box');

    const code = (codeEl?.value || '').trim();
    if (!/^\d{6}$/.test(code)) {
        msg.textContent = 'Please enter a valid 6-digit code.';
        msg.className = 'auth-message error';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Verifying...';
    try {
        const res = await fetch('/api/user/profile/verify-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
        });
        const data = await res.json();

        if (!res.ok) {
            msg.textContent = data.error || 'Failed to verify email.';
            msg.className = 'auth-message error';
            return;
        }

        currentUser.username = data.user?.username || currentUser.username;
        currentUser.email = data.user?.email || currentUser.email;
        renderUserInfo();

        msg.textContent = 'Email verified successfully.';
        msg.className = 'auth-message success';
        editMsg.textContent = 'Account info updated successfully.';
        editMsg.className = 'auth-message success';

        if (verificationBox) verificationBox.classList.add('hidden');
        if (codeEl) codeEl.value = '';
        if (form) form.classList.add('hidden');
        if (toggleBtn) toggleBtn.textContent = 'Edit Account Info';
    } catch (err) {
        msg.textContent = 'Cannot reach server. Please try again.';
        msg.className = 'auth-message error';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Verify Email';
    }
}

// ─── Change Password ───
function initChangePasswordForm() {
    const toggleBtn = document.getElementById('toggle-change-password-btn');
    const form = document.getElementById('change-password-form');
    const msg = document.getElementById('change-password-message');

    if (!toggleBtn || !form || !msg) return;

    toggleBtn.addEventListener('click', () => {
        const isHidden = form.classList.contains('hidden');
        form.classList.toggle('hidden');
        toggleBtn.textContent = isHidden ? 'Cancel Password Change' : 'Change Password';
        msg.textContent = '';
        msg.className = 'auth-message';
    });

    form.addEventListener('submit', handleChangePassword);
}

async function handleChangePassword(e) {
    e.preventDefault();

    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;
    const btn = document.getElementById('change-password-btn');
    const msg = document.getElementById('change-password-message');

    if (!currentPassword || !newPassword || !confirmPassword) {
        msg.textContent = 'Please fill in all password fields.';
        msg.className = 'auth-message error';
        return;
    }

    if (newPassword.length < 6) {
        msg.textContent = 'New password must be at least 6 characters.';
        msg.className = 'auth-message error';
        return;
    }

    if (newPassword !== confirmPassword) {
        msg.textContent = 'New passwords do not match.';
        msg.className = 'auth-message error';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Updating...';

    try {
        const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        let data = {};
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('application/json')) {
            data = await res.json();
        } else {
            const text = await res.text();
            data.error = text || `Request failed with status ${res.status}`;
        }

        if (!res.ok) {
            if (res.status === 404) {
                msg.textContent = 'Password API not found. Restart backend server and try again.';
            } else {
                msg.textContent = data.error || 'Failed to change password.';
            }
            msg.className = 'auth-message error';
            return;
        }

        msg.textContent = 'Password updated successfully.';
        msg.className = 'auth-message success';

        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-new-password').value = '';
    } catch (err) {
        msg.textContent = 'Cannot reach server. Make sure backend is running, then try again.';
        msg.className = 'auth-message error';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Update Password';
    }
}
