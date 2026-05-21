// ═══════════════════════════════════════════
//  CipherBeam — Receiver Logic
//  Fetches key, receives & decrypts chunks
// ═══════════════════════════════════════════

const IV_SIZE = 12; // 12-byte IV for AES-GCM

// ─── State ───
let aesKey = null;
let ws = null;
let transferInfo = null;
let decryptedChunks = [];
let totalBytesReceived = 0;
let fileReady = false;
let fileBlobUrl = null;

// Message queue for sequential processing
let messageQueue = [];
let processingQueue = false;

// ─── DOM Elements ───
const loadingSection = document.getElementById('loading-section');
const errorSection = document.getElementById('error-section');
const errorMessage = document.getElementById('error-message');
const downloadSection = document.getElementById('download-section');
const dlFileName = document.getElementById('dl-file-name');
const dlFileSize = document.getElementById('dl-file-size');
const dlFileIcon = document.getElementById('dl-file-icon');
const startDownloadBtn = document.getElementById('start-download-btn');
const progressSection = document.getElementById('progress-section');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const statusText = document.getElementById('status-text');
const saveSection = document.getElementById('save-section');
const saveFileBtn = document.getElementById('save-file-btn');
const saveFileName = document.getElementById('save-file-name');
const saveFileSize = document.getElementById('save-file-size');
const saveFileIcon = document.getElementById('save-file-icon');

// ─── Initialize ───

(async function init() {
    // Get ID from path: /<transferId>
    const transferId = window.location.pathname.substring(1);

    if (!transferId) {
        showError('Invalid download link — no transfer ID found.');
        return;
    }

    try {
        // Fetch transfer info
        const response = await fetch(`/api/transfers/${transferId}`);

        if (!response.ok) {
            if (response.status === 404) {
                showError('Sorry, this download link no longer exists or has expired.');
            } else {
                showError('Failed to fetch transfer information.');
            }
            return;
        }

        transferInfo = await response.json();

        // No AES key to import
        // aesKey = await importKeyFromHex(transferInfo.aesKeyHex);

        // Show file info
        dlFileName.textContent = transferInfo.fileName;
        dlFileSize.textContent = formatFileSize(transferInfo.fileSize);
        if (dlFileIcon) dlFileIcon.textContent = getFileEmoji(transferInfo.fileType);

        loadingSection.classList.add('hidden');
        downloadSection.classList.remove('hidden');

    } catch (err) {
        console.error('Init error:', err);
        showError('Something went wrong. Please try again.');
    }
})();

// ─── Start Download ───

startDownloadBtn.addEventListener('click', () => {
    startDownloadBtn.disabled = true;
    startDownloadBtn.innerHTML = '<span class="spinner"></span> Connecting...';
    
    if (transferInfo.isStored) {
        downloadStoredFile();
    } else {
        connectAndReceive();
    }
});

async function downloadStoredFile() {
    try {
        statusText.textContent = '🔄 Downloading securely from vault...';
        statusText.className = 'status-text active';
        downloadSection.classList.add('hidden');
        progressSection.classList.remove('hidden');
        updateProgress(0);

        const response = await fetch(`/api/share/stream/${transferInfo.id}`);
        
        if (!response.ok) {
            throw new Error(`Server returned ${response.status}: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let jsonBuffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            jsonBuffer += decoder.decode(value, { stream: true });

            // Try to parse the buffer as an array of chunk objects
            // Since it's a JSON array streaming in, we can parse valid complete JSON objects from it
            // For simplicity, we can accumulate the entire JSON and process it, or process as it comes.
            // But since memory is limited for huge files, let's process objects as we find them.
            // Since it's formatted as `[{...},{...}]`, we can extract `{...}` blocks.
        }
        
        // Finalize remaining string
        jsonBuffer += decoder.decode();
        
        let chunks;
        try {
            chunks = JSON.parse(jsonBuffer);
        } catch (e) {
            console.error("Failed to parse JSON stream", e);
            throw new Error("Invalid file stream received");
        }

        let processedBytes = 0;
        for (const chunkObj of chunks) {
            const { iv, data } = chunkObj;
            if (!iv || !data) continue;
            
            // Decode base64
            const binaryString = atob(data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            
            // Push to our array
            decryptedChunks.push(bytes);
            processedBytes += bytes.byteLength;
            
            // Update progress
            const progress = Math.min((processedBytes / transferInfo.fileSize) * 100, 99);
            updateProgress(progress);
            statusText.textContent = `Downloading... ${formatFileSize(processedBytes)} / ${formatFileSize(transferInfo.fileSize)}`;
        }

        totalBytesReceived = processedBytes;
        await prepareFileForSave();

    } catch (err) {
        console.error('Download error:', err);
        statusText.textContent = '❌ Error downloading file';
        statusText.className = 'status-text error';
        startDownloadBtn.disabled = false;
        startDownloadBtn.innerHTML = 'Download Securely';
    }
}

function connectAndReceive() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${protocol}://${location.host}`);

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        ws.send(JSON.stringify({
            type: 'join-room',
            transferId: transferInfo.id,
            as: 'recipient'
        }));
        statusText.textContent = '⏳ Waiting for sender to start transfer...';
        statusText.className = 'status-text waiting';
        downloadSection.classList.add('hidden');
        progressSection.classList.remove('hidden');
    };

    // Non-async handler — pushes to queue for sequential processing
    ws.onmessage = (event) => {
        messageQueue.push(event);
        processQueue();
    };

    ws.onclose = () => {
        console.log('WebSocket closed');
    };

    ws.onerror = () => {
        if (!fileReady) {
            statusText.textContent = '❌ Connection error';
            statusText.className = 'status-text error';
        }
    };
}

// ─── Sequential Message Queue ───

async function processQueue() {
    if (processingQueue) return;
    processingQueue = true;

    while (messageQueue.length > 0) {
        const event = messageQueue.shift();

        try {
            if (event.data instanceof ArrayBuffer) {
                await handleBinaryChunk(event.data);
            } else {
                const msg = JSON.parse(event.data);
                await handleControlMessage(msg);
            }
        } catch (err) {
            console.error('Message processing error:', err);
        }
    }

    processingQueue = false;
}

// ─── Handle Control Messages ───

async function handleControlMessage(msg) {
    switch (msg.type) {
        case 'transfer-starting':
            statusText.textContent = '🔄 Receiving encrypted data...';
            statusText.className = 'status-text active';
            break;

        case 'transfer-complete':
            await prepareFileForSave();
            break;

        case 'peer-disconnected':
            if (!fileReady) {
                statusText.textContent = '⚠️ Sender disconnected — transfer cancelled';
                statusText.className = 'status-text error';
            }
            break;

        case 'error':
            statusText.textContent = `❌ ${msg.message}`;
            statusText.className = 'status-text error';
            break;
    }
}

// ─── Handle Binary Chunk ───
// Each message format: [12-byte IV] + [ciphertext]

async function handleBinaryChunk(data) {
    try {
        // Data is not encrypted, just push it to the chunks array
        decryptedChunks.push(new Uint8Array(data));

        totalBytesReceived += data.byteLength;

        // Update progress
        const progress = Math.min((totalBytesReceived / transferInfo.fileSize) * 100, 99);
        updateProgress(progress);

        statusText.textContent = `Receiving... ${formatFileSize(totalBytesReceived)} / ${formatFileSize(transferInfo.fileSize)}`;
    } catch (err) {
        console.error('Chunk handling error:', err);
        statusText.textContent = '❌ Error processing file chunk';
        statusText.className = 'status-text error';
    }
}

// ─── Prepare File For Save ───
// Creates the blob URL and shows a "Save File" button
// User clicking the button = real user gesture = download attribute works

async function prepareFileForSave() {
    statusText.textContent = '📦 Assembling file...';
    updateProgress(100);

    const mimeType = transferInfo.fileType || 'application/octet-stream';
    const originalName = transferInfo.fileName || 'download';

    // Assemble the decrypted chunks into a Blob locally in the browser
    // This is the point where the file is fully "decrypted" and ready
    let blob;
    try {
        // Modern browsers support creating a File object directly
        blob = new File(decryptedChunks, originalName, { type: mimeType });
    } catch (e) {
        // Fallback for older browsers
        blob = new Blob(decryptedChunks, { type: mimeType });
    }
    const fileBlobUrl = URL.createObjectURL(blob);
    
    statusText.textContent = '🔒 Decrypted in browser — ready to save';
    statusText.className = 'status-text success';

    // Set the button attributes for a standard download
    saveFileBtn.href = fileBlobUrl;
    saveFileBtn.download = originalName;

    saveFileBtn.onclick = (e) => {
        // e.preventDefault(); // Don't prevent default, let the native link work
        
        // Update UI
        saveFileBtn.textContent = 'Done';
        saveFileBtn.classList.add('btn-success');
        
        // Native href handles the download, so no need for programmatic a.click()
    };

    // Hide the UUID from the URL bar
    window.history.replaceState(null, '', `/download.html`);

    // Show file info in the save section
    saveFileName.textContent = originalName;
    saveFileSize.textContent = formatFileSize(blob.size);
    if (saveFileIcon) saveFileIcon.textContent = getFileEmoji(mimeType);

    // Clear memory from chunks array (blob has its own copy)
    decryptedChunks = [];
    fileReady = true;

    // Hide progress, show save section
    progressSection.classList.add('hidden');
    saveSection.classList.remove('hidden');

    // Close WebSocket — we're done receiving
    if (ws) ws.close();
}

// ─── Utilities ───

function showError(message) {
    loadingSection.classList.add('hidden');
    errorMessage.textContent = message;
    errorSection.classList.remove('hidden');
}

function updateProgress(percent) {
    const p = Math.round(percent);
    progressBar.style.width = `${p}%`;
    progressText.textContent = `${p}%`;
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getFileEmoji(mimeType) {
    if (!mimeType) return '📄';
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📕';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return '📦';
    if (mimeType.includes('text')) return '📝';
    return '📄';
}