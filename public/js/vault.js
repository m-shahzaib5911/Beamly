// ═══════════════════════════════════════════
//  Beamly — Encrypted Vault (MEGA-style)
//  Client-side AES-256-GCM encryption
//  Zero-knowledge: key never touches server
// ═══════════════════════════════════════════

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB plaintext chunks
let currentUser = null;
let downloadFileId = null;

// ─── Init: Check Auth & Load Files ───
(async function init() {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (!data.loggedIn) {
            window.location.href = '/auth.html';
            return;
        }
        currentUser = data.user;
        await loadVaultFiles();
    } catch (err) {
        console.error('Vault init error:', err);
        window.location.href = '/auth.html';
    }
})();

// ═══════════════════════════════════════════
//  UPLOAD FLOW
// ═══════════════════════════════════════════

const fileInput = document.getElementById('vault-file-input');
const dropZone = document.getElementById('vault-drop-zone');

// File input change
fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleVaultUpload(e.target.files[0]);
    }
});

// Drag & drop
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
        handleVaultUpload(e.dataTransfer.files[0]);
    }
});

async function handleVaultUpload(file) {
    const maxSize = 5 * 1024 * 1024 * 1024; // 5GB
    if (file.size > maxSize) {
        alert('File too large. Max 5 GB.');
        return;
    }

    const progressSection = document.getElementById('vault-upload-progress');
    const filenameEl = document.getElementById('vault-upload-filename');
    const percentEl = document.getElementById('vault-upload-percent');
    const barEl = document.getElementById('vault-upload-bar');
    const statusEl = document.getElementById('vault-upload-status');

    progressSection.classList.remove('hidden');
    filenameEl.textContent = file.name;
    statusEl.textContent = 'Generating encryption key...';
    updateBar(barEl, percentEl, 0);

    try {
        // 1. Generate AES-256 key
        const aesKey = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true, // extractable
            ['encrypt', 'decrypt']
        );

        // Export key as hex string (this is what the user saves)
        const rawKey = await crypto.subtle.exportKey('raw', aesKey);
        const keyHex = bufToHex(new Uint8Array(rawKey));

        // 2. Compute chunks
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        statusEl.textContent = 'Initializing upload...';

        // 3. Init upload on server (send plaintext filename)
        const initRes = await fetch('/api/vault/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fileName: file.name,  // Plaintext filename for display
                fileSize: file.size,
                fileType: file.type || 'application/octet-stream',
                chunkSize: CHUNK_SIZE,
                totalChunks
            })
        });

        const initData = await initRes.json();
        if (!initRes.ok) {
            statusEl.textContent = initData.error || 'Upload failed';
            statusEl.style.color = 'var(--error)';
            return;
        }

        const fileId = initData.fileId;

        // 4. Read, encrypt, and upload each chunk
        statusEl.textContent = 'Encrypting & uploading...';

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunkBlob = file.slice(start, end);
            const chunkBuffer = await chunkBlob.arrayBuffer();

            // Generate unique IV for this chunk
            const iv = crypto.getRandomValues(new Uint8Array(12));

            // Encrypt chunk
            const encryptedChunk = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                aesKey,
                chunkBuffer
            );

            const ivHex = bufToHex(iv);

            // Upload encrypted chunk
            const formData = new FormData();
            formData.append('chunk', new Blob([encryptedChunk]), `chunk_${i}`);
            formData.append('chunkIndex', i.toString());
            formData.append('iv', ivHex);

            const chunkRes = await fetch(`/api/vault/chunk/${fileId}`, {
                method: 'POST',
                body: formData
            });

            if (!chunkRes.ok) {
                const errData = await chunkRes.json();
                statusEl.textContent = errData.error || 'Chunk upload failed';
                statusEl.style.color = 'var(--error)';
                return;
            }

            // Update progress
            const progress = ((i + 1) / totalChunks) * 100;
            updateBar(barEl, percentEl, progress);
            statusEl.textContent = `Encrypting & uploading... (${i + 1}/${totalChunks} chunks)`;
        }

        // 5. Complete upload
        const completeRes = await fetch(`/api/vault/complete/${fileId}`, { method: 'POST' });
        if (!completeRes.ok) {
            statusEl.textContent = 'Failed to finalize upload';
            statusEl.style.color = 'var(--error)';
            return;
        }

        updateBar(barEl, percentEl, 100);
        statusEl.textContent = 'Upload complete!';
        statusEl.style.color = 'var(--accent)';

        // 6. Show the decryption key to user
        showKeyModal(keyHex);

        // Refresh file list
        await loadVaultFiles();

        // Reset after 2s
        setTimeout(() => {
            progressSection.classList.add('hidden');
            statusEl.style.color = '';
            fileInput.value = '';
        }, 2000);

    } catch (err) {
        console.error('Upload error:', err);
        statusEl.textContent = 'Upload failed: ' + err.message;
        statusEl.style.color = 'var(--error)';
    }
}

// ═══════════════════════════════════════════
//  DOWNLOAD FLOW
// ═══════════════════════════════════════════

function requestDownload(fileId) {
    downloadFileId = fileId;
    document.getElementById('decrypt-key-input').value = '';
    document.getElementById('decrypt-error').textContent = '';
    document.getElementById('vault-download-progress').classList.add('hidden');
    document.getElementById('decrypt-modal').classList.remove('hidden');
}

async function startDecryptDownload() {
    const keyHex = document.getElementById('decrypt-key-input').value.trim();
    const errorEl = document.getElementById('decrypt-error');
    const progressSection = document.getElementById('vault-download-progress');
    const barEl = document.getElementById('vault-download-bar');
    const percentEl = document.getElementById('vault-download-percent');

    if (!keyHex || keyHex.length !== 64) {
        errorEl.textContent = 'Invalid key. Must be 64 hex characters.';
        return;
    }

    errorEl.textContent = '';
    progressSection.classList.remove('hidden');
    updateBar(barEl, percentEl, 5);

    try {
        // 1. Import the key
        const keyBuffer = hexToBuf(keyHex);
        const aesKey = await crypto.subtle.importKey(
            'raw', keyBuffer,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        // 2. Get file metadata (IVs and original filename)
        const metaRes = await fetch(`/api/vault/download/${downloadFileId}`);
        const meta = await metaRes.json();

        if (!metaRes.ok) {
            errorEl.textContent = meta.error || 'Failed to get file info';
            progressSection.classList.add('hidden');
            return;
        }

        updateBar(barEl, percentEl, 10);

        // 3. Get original filename (plaintext from server)
        const originalFileName = meta.originalName || 'decrypted_file';

        // 4. Download the encrypted binary
        updateBar(barEl, percentEl, 15);
        const streamRes = await fetch(`/api/vault/stream/${downloadFileId}`);
        if (!streamRes.ok) {
            errorEl.textContent = 'Failed to download encrypted file';
            progressSection.classList.add('hidden');
            return;
        }

        const encryptedBuffer = await streamRes.arrayBuffer();

        updateBar(barEl, percentEl, 40);

        // 5. Parse and decrypt chunks
        const ivList = meta.ivList;
        const decryptedChunks = [];
        let offset = 0;
        const dataView = new DataView(encryptedBuffer);

        for (let i = 0; i < ivList.length; i++) {
            // Read 4-byte length prefix
            if (offset + 4 > encryptedBuffer.byteLength) {
                console.error(`Unexpected end of data at offset ${offset}, total: ${encryptedBuffer.byteLength}`);
                break;
            }

            const chunkLength = dataView.getUint32(offset);
            offset += 4;

            if (offset + chunkLength > encryptedBuffer.byteLength) {
                console.error(`Chunk ${i} extends beyond file: need ${chunkLength} bytes at offset ${offset}`);
                break;
            }

            // Extract the encrypted chunk directly from the ArrayBuffer
            const encChunk = encryptedBuffer.slice(offset, offset + chunkLength);
            offset += chunkLength;

            // Decrypt with the corresponding IV
            const iv = hexToBuf(ivList[i]);
            try {
                const decrypted = await crypto.subtle.decrypt(
                    { name: 'AES-GCM', iv },
                    aesKey,
                    encChunk
                );
                decryptedChunks.push(new Uint8Array(decrypted));
            } catch (e) {
                errorEl.textContent = 'Decryption failed. Wrong key or corrupted data.';
                progressSection.classList.add('hidden');
                return;
            }

            const progress = 40 + ((i + 1) / ivList.length) * 55;
            updateBar(barEl, percentEl, progress);
        }

        // 6. Assemble decrypted data and trigger download
        updateBar(barEl, percentEl, 98);
        const totalSize = decryptedChunks.reduce((s, c) => s + c.length, 0);
        const result = new Uint8Array(totalSize);
        let pos = 0;
        for (const chunk of decryptedChunks) {
            result.set(chunk, pos);
            pos += chunk.length;
        }

        // Create blob from DECRYPTED data with correct MIME type
        const blob = new Blob([result], { type: meta.fileType || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = originalFileName;  // Use plaintext filename
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);

        updateBar(barEl, percentEl, 100);

        setTimeout(() => {
            closeDecryptModal();
        }, 1500);

    } catch (err) {
        console.error('Download error:', err);
        errorEl.textContent = 'Decryption failed: ' + err.message;
        progressSection.classList.add('hidden');
    }
}

// ═══════════════════════════════════════════
//  FILE LIST
// ═══════════════════════════════════════════

async function loadVaultFiles() {
    const loading = document.getElementById('vault-files-loading');
    const empty = document.getElementById('vault-files-empty');
    const listEl = document.getElementById('vault-files-list');

    try {
        const res = await fetch('/api/vault/files');
        const data = await res.json();

        // Update storage bar
        updateStorageBar(data.storageUsed, data.storageLimit);

        loading.classList.add('hidden');

        if (!data.files || data.files.length === 0) {
            empty.classList.remove('hidden');
            listEl.classList.add('hidden');
            return;
        }

        empty.classList.add('hidden');
        listEl.classList.remove('hidden');
        listEl.innerHTML = '';

        // Fetch starred list for this user to render star buttons
        let starredSet = new Set();
        try {
            const sres = await fetch('/api/starred');
            if (sres.ok) {
                const sdata = await sres.json();
                (sdata.files || []).forEach(f => starredSet.add(f.id));
            }
        } catch (e) {
            console.warn('Failed to fetch starred list', e);
        }

        data.files.forEach((file, index) => {
            const card = document.createElement('div');
            card.className = 'vault-file-card';

            const dateStr = new Date(file.uploaded_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });

            const icon = getFileIcon(file.file_type);
            const typeLabel = getFileTypeLabel(file.file_type);

            card.innerHTML = `
                <div class="vault-file-icon">${icon}</div>
                <div class="vault-file-info">
                    <div class="vault-file-name">${escapeHtml(file.original_name)}</div>
                    <div class="vault-file-meta">
                        <span class="mono">${formatFileSize(file.file_size)}</span>
                        <span class="vault-file-dot">•</span>
                        <span>${typeLabel}</span>
                        <span class="vault-file-dot">•</span>
                        <span>${dateStr}</span>
                    </div>
                    <div class="vault-file-meta" style="margin-top: 2px; opacity: 0.5;">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                        </svg>
                        <span style="font-size: 0.7rem;">Content encrypted • Requires key to download</span>
                    </div>
                </div>
                <div class="vault-file-actions">
                    <button class="vault-action-btn star ${starredSet.has(file.id) ? 'starred' : ''}" onclick="toggleStar('${file.id}', this)" title="${starredSet.has(file.id) ? 'Unstar' : 'Star'}">
                        ${starredSet.has(file.id) ? '★' : '☆'}
                    </button>
                    <button class="vault-action-btn logs" onclick="openFileAccessLogs('${file.id}')" title="Access Logs">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 3h18v18H3z"></path>
                            <path d="M8 12h8"></path>
                            <path d="M8 8h8"></path>
                            <path d="M8 16h5"></path>
                        </svg>
                    </button>
                    <button class="vault-action-btn download" onclick="requestDownload('${file.id}')" title="Download & Decrypt">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            <polyline points="7 10 12 15 17 10"></polyline>
                            <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                    </button>
                    <button class="vault-action-btn delete" onclick="deleteVaultFile('${file.id}')" title="Delete">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </div>
            `;
            listEl.appendChild(card);
        });

    } catch (err) {
        console.error('Load vault files error:', err);
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

async function deleteVaultFile(fileId) {
    if (!confirm('Delete this file? This cannot be undone.')) return;

    try {
        const res = await fetch(`/api/vault/files/${fileId}`, { method: 'DELETE' });
        if (res.ok) {
            await loadVaultFiles();
        } else {
            const data = await res.json();
            alert(data.error || 'Delete failed');
        }
    } catch (err) {
        alert('Delete failed');
    }
}

async function openFileAccessLogs(fileId) {
    const modal = document.getElementById('file-access-modal');
    const loading = document.getElementById('file-access-loading');
    const empty = document.getElementById('file-access-empty');
    const list = document.getElementById('file-access-list');

    if (!modal || !loading || !empty || !list) return;

    modal.classList.remove('hidden');
    loading.classList.remove('hidden');
    empty.classList.add('hidden');
    list.classList.add('hidden');
    list.innerHTML = '';

    try {
        const res = await fetch(`/api/file-access/${fileId}`);
        const data = await res.json();
        const logs = data.logs || [];

        loading.classList.add('hidden');

        if (!res.ok || logs.length === 0) {
            empty.classList.remove('hidden');
            return;
        }

        list.classList.remove('hidden');
        logs.forEach(log => {
            const row = document.createElement('div');
            row.className = 'info-row';
            const action = (log.action || 'activity').replace(/_/g, ' ');
            const when = new Date(log.accessed_at).toLocaleString();
            row.innerHTML = `
                <span class="info-label">${escapeHtml(action)}</span>
                <span class="info-value">${when}<br><span style="color: var(--txt-dim); font-size: 0.78rem;">${escapeHtml(log.ip_address || 'Unknown IP')}</span></span>
            `;
            list.appendChild(row);
        });
    } catch (err) {
        console.error('File access logs error:', err);
        loading.classList.add('hidden');
        empty.classList.remove('hidden');
    }
}

// ═══════════════════════════════════════════
//  MODALS
// ═══════════════════════════════════════════

function showKeyModal(keyHex) {
    document.getElementById('decryption-key-display').textContent = keyHex;
    document.getElementById('key-modal').classList.remove('hidden');
}

function closeKeyModal() {
    document.getElementById('key-modal').classList.add('hidden');
}

function closeDecryptModal() {
    document.getElementById('decrypt-modal').classList.add('hidden');
    document.getElementById('vault-download-progress').classList.add('hidden');
    downloadFileId = null;
}

function closeFileAccessModal() {
    const modal = document.getElementById('file-access-modal');
    if (modal) modal.classList.add('hidden');
}

function copyKey() {
    const key = document.getElementById('decryption-key-display').textContent;
    navigator.clipboard.writeText(key).then(() => {
        const btn = document.querySelector('#key-modal .copy-btn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
    });
}

// ═══════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════

function updateBar(barEl, percentEl, pct) {
    const p = Math.round(pct);
    barEl.style.width = `${p}%`;
    percentEl.textContent = `${p}%`;
}

function updateStorageBar(used, limit) {
    document.getElementById('storage-used').textContent = formatFileSize(used);
    document.getElementById('storage-limit').textContent = formatFileSize(limit);
    const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
    document.getElementById('storage-fill').style.width = `${pct}%`;

    // Color warning
    const fill = document.getElementById('storage-fill');
    if (pct > 90) fill.style.background = 'var(--error)';
    else if (pct > 70) fill.style.background = 'linear-gradient(90deg, var(--accent), #f39c12)';
    else fill.style.background = '';
}

function bufToHex(buf) {
    return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
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
    if (mimeType.includes('zip') || mimeType.includes('rar')) return 'Archive';
    if (mimeType.includes('text')) return 'Text';
    return 'File';
}

function getFileIcon(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return '📦';
    if (mimeType.includes('text')) return '📝';
    return '📄';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toggle star/unstar for a file
async function toggleStar(fileId, btn) {
    try {
        const isStarred = btn && btn.classList.contains('starred');
        const url = isStarred ? `/api/unstar/${fileId}` : `/api/star/${fileId}`;
        const res = await fetch(url, { method: 'POST' });

        if (res.ok) {
            // Optimistic UI update
            if (isStarred) {
                btn.classList.remove('starred');
                btn.innerHTML = '☆';
                btn.title = 'Star';
            } else {
                btn.classList.add('starred');
                btn.innerHTML = '★';
                btn.title = 'Unstar';
            }
        } else {
            console.error('Star toggle failed');
        }
    } catch (err) {
        console.error('Toggle star error:', err);
    }
}
