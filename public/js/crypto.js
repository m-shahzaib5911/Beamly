// ═══════════════════════════════════════════
//  CipherBeam — Web Crypto API Module
//  AES-256-GCM encryption/decryption
// ═══════════════════════════════════════════

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96-bit IV for GCM

/**
 * Generate a new AES-256-GCM key
 * @returns {Promise<CryptoKey>}
 */
async function generateAESKey() {
    return await crypto.subtle.generateKey(
        { name: ALGORITHM, length: KEY_LENGTH },
        true, // extractable
        ['encrypt', 'decrypt']
    );
}

/**
 * Export CryptoKey to hex string
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
async function exportKeyToHex(key) {
    const rawKey = await crypto.subtle.exportKey('raw', key);
    return bufferToHex(rawKey);
}

/**
 * Import hex string back to CryptoKey
 * @param {string} hexKey
 * @returns {Promise<CryptoKey>}
 */
async function importKeyFromHex(hexKey) {
    const rawKey = hexToBuffer(hexKey);
    return await crypto.subtle.importKey(
        'raw',
        rawKey,
        { name: ALGORITHM, length: KEY_LENGTH },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Generate a random IV (96-bit)
 * @returns {Uint8Array}
 */
function generateIV() {
    return crypto.getRandomValues(new Uint8Array(IV_LENGTH));
}

/**
 * Encrypt a chunk of data with AES-256-GCM
 * @param {CryptoKey} key
 * @param {ArrayBuffer} data
 * @returns {Promise<{ciphertext: ArrayBuffer, iv: Uint8Array}>}
 */
async function encryptChunk(key, data) {
    const iv = generateIV();
    const ciphertext = await crypto.subtle.encrypt(
        { name: ALGORITHM, iv: iv },
        key,
        data
    );
    return { ciphertext, iv };
}

/**
 * Decrypt a chunk of data with AES-256-GCM
 * @param {CryptoKey} key
 * @param {ArrayBuffer} ciphertext
 * @param {Uint8Array} iv
 * @returns {Promise<ArrayBuffer>}
 */
async function decryptChunk(key, ciphertext, iv) {
    return await crypto.subtle.decrypt(
        { name: ALGORITHM, iv: iv },
        key,
        ciphertext
    );
}

// ─── Utility Functions ───

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes.buffer;
}

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}
