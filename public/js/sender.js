// ═══════════════════════════════════════════
//  Encryptify — Sender Logic
//  File selection, encryption, streaming
// ═══════════════════════════════════════════

const CHUNK_SIZE = 64 * 1024; // 64KB chunks

// ─── State ───
let selectedFile = null;
let aesKey = null;
let ws = null;
let transferId = null;
let transferDone = false;

// ─── DOM Elements ───
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const fileSize = document.getElementById('file-size');
const createLinkBtn = document.getElementById('create-link-btn');
const linkSection = document.getElementById('link-section');
const shareLink = document.getElementById('share-link');
const copyBtn = document.getElementById('copy-btn');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const statusText = document.getElementById('status-text');
const resetBtn = document.getElementById('reset-btn');

// New elements
const persistToggle = document.getElementById('persist-toggle');
const downloadLimitGroup = document.getElementById('download-limit-group');
const downloadLimitInput = document.getElementById('download-limit');
const expirySelect = document.getElementById('expiry-select');
const receiverEmail = document.getElementById('receiver-email');
const sendEmailBtn = document.getElementById('send-email-btn');
const linkExpiryText = document.getElementById('link-expiry-text');

if (persistToggle && downloadLimitGroup) {
    persistToggle.addEventListener('change', () => {
        if (persistToggle.checked) {
            downloadLimitGroup.classList.remove('hidden');
        } else {
            downloadLimitGroup.classList.add('hidden');
        }
    });
}

// ─── File Selection ───

// Since drop-zone is now a label, click is handled by the label → input binding.
// But we still need drag/drop events:

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--accent2)';
    dropZone.style.boxShadow = '0 0 20px rgba(0, 146, 255, 0.2)';
});

dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--accent)';
    dropZone.style.boxShadow = 'none';
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = 'var(--accent)';
    dropZone.style.boxShadow = 'none';

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect(e.dataTransfer.files[0]);
    }
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        handleFileSelect(fileInput.files[0]);
    }
});

function handleFileSelect(file) {
    selectedFile = file;
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    fileInfo.classList.remove('hidden');
    createLinkBtn.classList.remove('hidden');
    dropZone.style.borderStyle = 'solid';
}

// ─── Create Share Link ───

createLinkBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    createLinkBtn.disabled = true;
    createLinkBtn.innerHTML = 'Creating link...';

    try {
        // 1. Generate AES key
        aesKey = await generateAESKey();
        const aesKeyHex = await exportKeyToHex(aesKey);

        const isPersistent = persistToggle && persistToggle.checked;
        const expiryMinutes = expirySelect ? parseInt(expirySelect.value) : 10;
        const limit = downloadLimitInput ? parseInt(downloadLimitInput.value) : 1;

        if (isPersistent) {
            // --- OFFLINE (PERSISTENT) SHARING FLOW ---
            statusText.textContent = 'Initializing secure offline storage...';
            statusText.className = 'status-text waiting';
            progressSection.classList.remove('hidden');
            
            const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
            
            const initRes = await fetch('/api/share/init', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: selectedFile.name,
                    fileSize: selectedFile.size,
                    fileType: selectedFile.type,
                    aesKeyHex: aesKeyHex,
                    chunkSize: CHUNK_SIZE,
                    totalChunks: totalChunks,
                    downloadLimit: limit,
                    expiryMinutes: expiryMinutes
                })
            });
            
            if (!initRes.ok) {
                const errData = await initRes.json();
                throw new Error(errData.error || 'Failed to init offline share');
            }
            
            const initData = await initRes.json();
            const fileId = initData.fileId;
            transferId = initData.transferId;
            
            // Upload chunks
            statusText.textContent = 'Encrypting & uploading...';
            statusText.className = 'status-text active';
            
            const fileBuffer = await selectedFile.arrayBuffer();
            const fileData = new Uint8Array(fileBuffer);
            let offset = 0;
            let chunkIndex = 0;
            let bytesSent = 0;
            
            while (offset < fileData.length) {
                const end = Math.min(offset + CHUNK_SIZE, fileData.length);
                const chunk = fileData.slice(offset, end);
                
                const iv = crypto.getRandomValues(new Uint8Array(12));
                const encryptedChunk = await crypto.subtle.encrypt(
                    { name: 'AES-GCM', iv: iv },
                    aesKey,
                    chunk
                );
                
                const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
                const formData = new FormData();
                formData.append('chunk', new Blob([encryptedChunk]));
                formData.append('ivHex', ivHex);
                formData.append('index', chunkIndex);
                
                const uploadRes = await fetch(`/api/share/chunk/${fileId}`, {
                    method: 'POST',
                    body: formData
                });
                
                if (!uploadRes.ok) throw new Error(`Failed to upload chunk ${chunkIndex}`);
                
                bytesSent += chunk.length;
                chunkIndex++;
                offset = end;
                
                const progress = Math.min((bytesSent / selectedFile.size) * 100, 99);
                updateProgress(progress);
            }
            
            // Complete upload
            statusText.textContent = 'Finalizing upload...';
            const completeRes = await fetch(`/api/share/complete/${fileId}`, { method: 'POST' });
            if (!completeRes.ok) throw new Error('Failed to finalize upload');
            
            updateProgress(100);
            statusText.textContent = 'Upload complete! File stored securely.';
            statusText.className = 'status-text success';
            resetBtn.classList.remove('hidden');
            
            // Show share link
            shareLink.value = initData.shareLink;
            linkSection.classList.remove('hidden');
            createLinkBtn.classList.add('hidden');
            progressSection.classList.add('hidden');
            
            if (linkExpiryText) {
                linkExpiryText.textContent = `Link expires in ${formatExpiryText(expiryMinutes)}`;
            }

        } else {
            // --- P2P WEBSOCKET SHARING FLOW ---
            const response = await fetch('/api/transfers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileName: selectedFile.name,
                    fileSize: selectedFile.size,
                    fileType: selectedFile.type,
                    aesKeyHex: aesKeyHex,
                    ivHex: '',
                    expiryMinutes: expiryMinutes
                })
            });

            if (!response.ok) throw new Error('Failed to create transfer');

            const data = await response.json();
            transferId = data.transferId;

            // Show share link
            shareLink.value = data.shareLink;
            linkSection.classList.remove('hidden');
            createLinkBtn.classList.add('hidden');
            
            if (linkExpiryText) {
                linkExpiryText.textContent = `Link expires in ${formatExpiryText(expiryMinutes)}`;
            }

            // Connect WebSocket and wait for recipient
            connectWebSocket();
        }

    } catch (err) {
        console.error('Create link error:', err);
        statusText.textContent = err.message || 'Failed to create link. Try again.';
        statusText.className = 'status-text error';
        createLinkBtn.disabled = false;
        createLinkBtn.innerHTML = 'Create Encrypted Link';
    }
});

// ─── Copy Link ───

copyBtn.addEventListener('click', () => {
    if (shareLink.value) {
        shareLink.select();
        navigator.clipboard.writeText(shareLink.value).then(() => {
            copyBtn.textContent = 'Copied!';
            copyBtn.style.background = 'var(--accent)';
            copyBtn.style.color = 'var(--bg)';
            setTimeout(() => {
                copyBtn.textContent = 'Copy';
                copyBtn.style.background = '';
                copyBtn.style.color = '';
            }, 2000);
        });
    }
});

// ─── Email Share ───

if (sendEmailBtn && receiverEmail) {
    sendEmailBtn.addEventListener('click', async () => {
        const email = receiverEmail.value.trim();
        if (!email || !shareLink.value) return;
        
        sendEmailBtn.disabled = true;
        sendEmailBtn.textContent = 'Sending...';
        
        try {
            const res = await fetch('/api/transfers/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    transferId: transferId,
                    recipientEmail: email,
                    shareLink: shareLink.value
                })
            });
            
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(payload.error || `Failed to send email (${res.status})`);
            
            sendEmailBtn.textContent = 'Sent!';
            sendEmailBtn.style.background = 'rgba(0, 229, 195, 0.2)';
            setTimeout(() => {
                sendEmailBtn.disabled = false;
                sendEmailBtn.textContent = 'Send';
                sendEmailBtn.style.background = 'rgba(0, 229, 195, 0.12)';
                receiverEmail.value = '';
            }, 3000);
        } catch (err) {
            console.error('Email error:', err);
            statusText.textContent = err.message || 'Failed to send email';
            statusText.className = 'status-text error';
            sendEmailBtn.textContent = 'Error';
            sendEmailBtn.style.background = 'rgba(225, 112, 85, 0.12)';
            sendEmailBtn.style.color = 'var(--error)';
            setTimeout(() => {
                sendEmailBtn.disabled = false;
                sendEmailBtn.textContent = 'Send';
                sendEmailBtn.style.background = 'rgba(0, 229, 195, 0.12)';
                sendEmailBtn.style.color = 'var(--accent)';
            }, 3000);
        }
    });
}

// ─── WebSocket Connection ───

function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}`);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        // Join room as sender
        ws.send(JSON.stringify({
            type: 'join-room',
            transferId: transferId,
            as: 'sender'
        }));
        statusText.textContent = 'Waiting for recipient to connect...';
        statusText.className = 'status-text waiting';
    };

    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
            case 'recipient-ready':
                statusText.textContent = 'Recipient connected! Streaming...';
                statusText.className = 'status-text active';
                progressSection.classList.remove('hidden');
                linkSection.classList.add('hidden');
                await startStreaming();
                break;

            case 'peer-disconnected':
                // Only show warning if transfer hasn't completed
                if (!transferDone) {
                    statusText.textContent = 'Recipient disconnected';
                    statusText.className = 'status-text error';
                }
                break;

            case 'error':
                statusText.textContent = `${msg.message}`;
                statusText.className = 'status-text error';
                break;
        }
    };

    ws.onclose = () => {
        console.log('WebSocket closed');
    };

    ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        statusText.textContent = 'Connection error';
        statusText.className = 'status-text error';
    };
}

// ─── Stream Encrypted File ───
// Each binary message = [12-byte IV] + [ciphertext]

async function startStreaming() {
    const file = selectedFile;
    const totalBytes = file.size;
    let bytesSent = 0;

    const fileBuffer = await file.arrayBuffer();
    const fileData = new Uint8Array(fileBuffer);

    let offset = 0;
    let chunkIndex = 0;

    while (offset < fileData.length) {
        const end = Math.min(offset + CHUNK_SIZE, fileData.length);
        const chunk = fileData.slice(offset, end);

        // Encrypt the chunk
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedChunk = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            aesKey,
            chunk
        );

        // Prepend IV to the encrypted chunk
        const message = new Uint8Array(iv.length + encryptedChunk.byteLength);
        message.set(iv);
        message.set(new Uint8Array(encryptedChunk), iv.length);

        // Send the combined message (IV + ciphertext)
        ws.send(message.buffer);

        bytesSent += chunk.length;
        chunkIndex++;
        offset = end;

        // Update progress
        const progress = Math.min((bytesSent / totalBytes) * 100, 99);
        updateProgress(progress);

        // Yield to event loop to keep UI responsive
        if (chunkIndex % 5 === 0) {
            await new Promise(r => setTimeout(r, 1));
        }
    }

    // Mark as done BEFORE sending complete signal
    transferDone = true;

    // Signal completion
    ws.send(JSON.stringify({ type: 'transfer-complete' }));
    updateProgress(100);
    statusText.textContent = 'Transfer complete!';
    statusText.className = 'status-text success';
    resetBtn.classList.remove('hidden');

    // Save to history if user is logged in
    try {
        const authRes = await fetch('/api/auth/me');
        const authData = await authRes.json();
        if (authData.loggedIn) {
            await fetch('/api/user/history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fileNameEnc: file.name,
                    fileSize: file.size,
                    fileType: file.type,
                    direction: 'sent'
                })
            });
        }
    } catch (e) { /* silently fail */ }
}

// ─── Progress ───

function updateProgress(percent) {
    const p = Math.round(percent);
    progressBar.style.width = `${p}%`;
    progressText.textContent = `${p}%`;
    progressBar.setAttribute('data-progress', p);
}

// ─── Reset ───

resetBtn.addEventListener('click', () => {
    location.reload();
});

// ─── Utilities ───

async function generateAESKey() {
    return await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function exportKeyToHex(key) {
    const exported = await crypto.subtle.exportKey('raw', key);
    return Array.from(new Uint8Array(exported))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatExpiryText(minutes) {
    if (minutes < 60) return `${minutes} minutes`;
    if (minutes === 60) return `1 hour`;
    if (minutes < 1440) return `${minutes / 60} hours`;
    if (minutes === 1440) return `24 hours`;
    if (minutes === 4320) return `3 days`;
    if (minutes === 10080) return `7 days`;
    return `${minutes} minutes`;
}
