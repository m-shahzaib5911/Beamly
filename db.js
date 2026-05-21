const mysql = require('mysql2/promise');
require('dotenv').config();

// Connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cipherbeam',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// ═══════════════════════════════════════════
//  TRANSFER FUNCTIONS (Table 1)
// ═══════════════════════════════════════════

async function createTransfer({ id, fileName, fileSize, fileType, aesKeyHex, ivHex, expiresAt }) {
    const sql = `INSERT INTO transfers (id, file_name, file_size, file_type, aes_key_hex, iv_hex, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [id, fileName, fileSize, fileType, aesKeyHex || '', ivHex || '', expiresAt]);
}

async function getTransfer(id) {
    const sql = `SELECT * FROM transfers WHERE id = ? AND (expires_at > NOW() OR status = 'active')`;
    const [rows] = await pool.execute(sql, [id]);
    return rows[0] || null;
}

async function updateStatus(id, status) {
    const sql = `UPDATE transfers SET status = ? WHERE id = ?`;
    await pool.execute(sql, [status, id]);
}

async function deleteTransfer(id) {
    const sql = `DELETE FROM transfers WHERE id = ?`;
    await pool.execute(sql, [id]);
}

async function cleanExpired() {
    const sql = `DELETE FROM transfers WHERE expires_at <= NOW() AND status IN ('waiting', 'expired')`;
    const [result] = await pool.execute(sql);
    return result.affectedRows;
}

// ═══════════════════════════════════════════
//  USER FUNCTIONS (Table 2)
// ═══════════════════════════════════════════

async function createUser(username, email, passwordHash) {
    const sql = `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`;
    const [result] = await pool.execute(sql, [username, email, passwordHash]);
    return result.insertId;
}

async function getUserByEmail(email) {
    const sql = `SELECT * FROM users WHERE email = ?`;
    const [rows] = await pool.execute(sql, [email]);
    return rows[0] || null;
}

async function getUserById(id) {
    const sql = `SELECT id, username, email, storage_used, storage_limit, created_at FROM users WHERE id = ?`;
    const [rows] = await pool.execute(sql, [id]);
    return rows[0] || null;
}

async function getUserByUsername(username) {
    const sql = `SELECT id FROM users WHERE LOWER(username) = LOWER(?) LIMIT 1`;
    const [rows] = await pool.execute(sql, [username]);
    return rows[0] || null;
}

async function updateStorageUsed(userId, delta) {
    const sql = `UPDATE users SET storage_used = GREATEST(0, storage_used + ?) WHERE id = ?`;
    await pool.execute(sql, [delta, userId]);
}

async function updateUserPassword(userId, passwordHash) {
    const sql = `UPDATE users SET password_hash = ? WHERE id = ?`;
    await pool.execute(sql, [passwordHash, userId]);
}

async function updateUserProfile(userId, username, email) {
    const sql = `UPDATE users SET username = ?, email = ? WHERE id = ?`;
    await pool.execute(sql, [username, email, userId]);
}

async function getUserPasswordHashById(userId) {
    const sql = `SELECT id, password_hash FROM users WHERE id = ?`;
    const [rows] = await pool.execute(sql, [userId]);
    return rows[0] || null;
}

async function ensureLoginHistoryTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS login_history (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            ip_address VARCHAR(45),
            user_agent VARCHAR(512),
            logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_login_user (user_id),
            INDEX idx_login_time (logged_in_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;
    await pool.execute(sql);
}

async function ensureAllNewTables() {
    const tables = [
        `CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            token VARCHAR(64) NOT NULL UNIQUE,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_tokens (user_id),
            INDEX idx_expires (expires_at),
            INDEX idx_token (token)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS signup_verifications (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(50) NOT NULL,
            email VARCHAR(255) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            code VARCHAR(6) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_signup_verify_email (email),
            INDEX idx_signup_verify_code (code),
            INDEX idx_signup_verify_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS email_change_verifications (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            pending_username VARCHAR(50) NOT NULL,
            pending_email VARCHAR(255) NOT NULL,
            code VARCHAR(6) NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            used BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_email_verify_user (user_id),
            INDEX idx_email_verify_pending (pending_email),
            INDEX idx_email_verify_code (code),
            INDEX idx_email_verify_expires (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS user_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL UNIQUE,
            theme ENUM('light','dark') DEFAULT 'dark',
            notifications_enabled BOOLEAN DEFAULT TRUE,
            privacy_level ENUM('private') DEFAULT 'private',
            auto_delete_days INT DEFAULT 30,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_settings (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS starred_files (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            file_id VARCHAR(36) NOT NULL,
            starred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES cloud_files(id) ON DELETE CASCADE,
            UNIQUE KEY unique_starred (user_id, file_id),
            INDEX idx_user_starred (user_id),
            INDEX idx_file_starred (file_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS audit_logs (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            action VARCHAR(100) NOT NULL,
            resource_type VARCHAR(50),
            resource_id VARCHAR(255),
            details TEXT,
            ip_address VARCHAR(45),
            status ENUM('success','failure') DEFAULT 'success',
            logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
            INDEX idx_audit_user (user_id),
            INDEX idx_audit_action (action),
            INDEX idx_audit_time (logged_at),
            INDEX idx_audit_resource (resource_type, resource_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE IF NOT EXISTS shared_files (
            id VARCHAR(36) PRIMARY KEY,
            user_id INT NOT NULL,
            transfer_id VARCHAR(5) NOT NULL,
            original_name VARCHAR(512) NOT NULL,
            file_size BIGINT NOT NULL,
            file_type VARCHAR(100) DEFAULT 'application/octet-stream',
            storage_path VARCHAR(512) NOT NULL,
            aes_key_hex VARCHAR(128),
            iv_list LONGTEXT,
            chunk_size INT DEFAULT 2097152,
            total_chunks INT DEFAULT 0,
            chunks_uploaded INT DEFAULT 0,
            download_limit INT DEFAULT 1,
            download_count INT DEFAULT 0,
            expires_at TIMESTAMP NOT NULL,
            status ENUM('uploading','ready','expired','deleted') DEFAULT 'uploading',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_transfer (transfer_id),
            INDEX idx_user (user_id),
            INDEX idx_expires (expires_at),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
    ];
    for (const table of tables) {
        await pool.execute(table);
    }
}

async function saveLoginHistory(userId, ipAddress, userAgent) {
    const sql = `INSERT INTO login_history (user_id, ip_address, user_agent) VALUES (?, ?, ?)`;
    await pool.execute(sql, [userId, ipAddress || null, userAgent || null]);
}

async function getLoginHistory(userId, limit = 20) {
    const lim = Math.max(1, Math.min(200, parseInt(limit, 10) || 20));
    const sql = `SELECT ip_address, user_agent, logged_in_at
                 FROM login_history
                 WHERE user_id = ?
                 ORDER BY logged_in_at DESC
                 LIMIT ${lim}`;
    const [rows] = await pool.execute(sql, [userId]);
    return rows;
}

// ═══════════════════════════════════════════
//  PASSWORD RESET FUNCTIONS (Table 7)
// ═══════════════════════════════════════════

async function createPasswordResetToken(userId, token, expiresAt) {
    const sql = `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`;
    await pool.execute(sql, [userId, token, expiresAt]);
}

async function getPasswordResetToken(token) {
    const sql = `SELECT * FROM password_reset_tokens WHERE token = ? AND expires_at > NOW()`;
    const [rows] = await pool.execute(sql, [token]);
    return rows[0] || null;
}

async function deletePasswordResetToken(token) {
    const sql = `DELETE FROM password_reset_tokens WHERE token = ?`;
    await pool.execute(sql, [token]);
}

async function createSignupVerification(username, email, passwordHash, code, expiresAt) {
    await pool.execute(
        `DELETE FROM signup_verifications WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) AND used = FALSE`,
        [email, username]
    );
    const sql = `INSERT INTO signup_verifications (username, email, password_hash, code, expires_at)
                 VALUES (?, ?, ?, ?, ?)`;
    await pool.execute(sql, [username, email, passwordHash, code, expiresAt]);
}

async function getSignupVerification(email, code) {
    const sql = `SELECT * FROM signup_verifications
                 WHERE LOWER(email) = LOWER(?) AND code = ? AND used = FALSE AND expires_at > NOW()
                 ORDER BY created_at DESC
                 LIMIT 1`;
    const [rows] = await pool.execute(sql, [email, code]);
    return rows[0] || null;
}

async function markSignupVerificationUsed(id) {
    const sql = `UPDATE signup_verifications SET used = TRUE WHERE id = ?`;
    await pool.execute(sql, [id]);
}

async function createEmailChangeVerification(userId, pendingUsername, pendingEmail, code, expiresAt) {
    await pool.execute(`DELETE FROM email_change_verifications WHERE user_id = ? AND used = FALSE`, [userId]);
    const sql = `INSERT INTO email_change_verifications (user_id, pending_username, pending_email, code, expires_at)
                 VALUES (?, ?, ?, ?, ?)`;
    await pool.execute(sql, [userId, pendingUsername, pendingEmail, code, expiresAt]);
}

async function getEmailChangeVerification(userId, code) {
    const sql = `SELECT * FROM email_change_verifications
                 WHERE user_id = ? AND code = ? AND used = FALSE AND expires_at > NOW()
                 ORDER BY created_at DESC
                 LIMIT 1`;
    const [rows] = await pool.execute(sql, [userId, code]);
    return rows[0] || null;
}

async function markEmailChangeVerificationUsed(id) {
    const sql = `UPDATE email_change_verifications SET used = TRUE WHERE id = ?`;
    await pool.execute(sql, [id]);
}

// ═══════════════════════════════════════════
//  USER SETTINGS FUNCTIONS (Table 8)
// ═══════════════════════════════════════════

async function getUserSettings(userId) {
    const sql = `SELECT * FROM user_settings WHERE user_id = ?`;
    const [rows] = await pool.execute(sql, [userId]);
    return rows[0] || null;
}

async function updateUserSettings(userId, settings) {
    const { theme, notifications_enabled, privacy_level, auto_delete_days } = settings;
    const sql = `UPDATE user_settings SET theme = ?, notifications_enabled = ?, privacy_level = ?, auto_delete_days = ?
                 WHERE user_id = ?`;
    await pool.execute(sql, [theme, notifications_enabled, privacy_level, auto_delete_days, userId]);
}

async function createUserSettings(userId) {
    const sql = `INSERT INTO user_settings (user_id) VALUES (?)`;
    await pool.execute(sql, [userId]);
}

// ═══════════════════════════════════════════
//  STARRED FILES FUNCTIONS (Table 9)
// ═══════════════════════════════════════════

async function starFile(userId, fileId) {
    const sql = `INSERT IGNORE INTO starred_files (user_id, file_id) VALUES (?, ?)`;
    await pool.execute(sql, [userId, fileId]);
}

async function unstarFile(userId, fileId) {
    const sql = `DELETE FROM starred_files WHERE user_id = ? AND file_id = ?`;
    await pool.execute(sql, [userId, fileId]);
}

async function getStarredFiles(userId) {
    const sql = `SELECT f.id, f.original_name, f.file_size, f.file_type, f.uploaded_at, s.starred_at
                 FROM starred_files s
                 JOIN cloud_files f ON s.file_id = f.id
                 WHERE s.user_id = ? AND f.status = 'ready'
                 ORDER BY s.starred_at DESC LIMIT 200`;
    const [rows] = await pool.execute(sql, [userId]);
    return rows;
}

async function isFileStarred(userId, fileId) {
    const sql = `SELECT 1 FROM starred_files WHERE user_id = ? AND file_id = ?`;
    const [rows] = await pool.execute(sql, [userId, fileId]);
    return rows.length > 0;
}

// ═══════════════════════════════════════════
//  AUDIT LOG FUNCTIONS (Table 10)
// ═══════════════════════════════════════════

async function logAudit(userId, action, resourceType, resourceId, details, ipAddress, status = 'success') {
    const sql = `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await pool.execute(sql, [userId || null, action, resourceType || null, resourceId || null, details || null, ipAddress || null, status]);
}

async function getAuditLogs(filter = {}) {
    const { userId, action, limit = 100, offset = 0 } = filter;
    let sql = `SELECT * FROM audit_logs WHERE 1=1`;
    const params = [];

    if (userId) {
        sql += ` AND user_id = ?`;
        params.push(userId);
    }
    if (action) {
        sql += ` AND action = ?`;
        params.push(action);
    }

    // MySQL does not always accept placeholders for LIMIT/OFFSET in prepared statements
    // so append numeric values directly after validation.
    const lim = Math.max(1, parseInt(limit) || 100);
    const off = Math.max(0, parseInt(offset) || 0);
    sql += ` ORDER BY logged_at DESC LIMIT ${lim} OFFSET ${off}`;

    const [rows] = await pool.execute(sql, params);
    return rows;
}

// ═══════════════════════════════════════════
//  TRANSFER HISTORY FUNCTIONS (Table 3)
// ═══════════════════════════════════════════

async function saveTransferHistory(userId, { fileNameEnc, fileSize, fileType, direction }) {
    const sql = `INSERT INTO transfer_history (user_id, file_name_enc, file_size, file_type, direction)
                 VALUES (?, ?, ?, ?, ?)`;
    await pool.execute(sql, [userId, fileNameEnc, fileSize, fileType || 'application/octet-stream', direction || 'sent']);
}

async function getTransferHistory(userId) {
    const sql = `SELECT id, file_name_enc, file_size, file_type, direction, transferred_at 
                 FROM transfer_history WHERE user_id = ? ORDER BY transferred_at DESC LIMIT 50`;
    const [rows] = await pool.execute(sql, [userId]);
    return rows;
}

// ═══════════════════════════════════════════
//  CLOUD VAULT FUNCTIONS (Table 4)
// ═══════════════════════════════════════════

async function createCloudFile({ id, userId, originalName, fileSize, fileType, storagePath, chunkSize, totalChunks }) {
    const sql = `INSERT INTO cloud_files 
                 (id, user_id, original_name, file_size, file_type, storage_path, chunk_size, total_chunks, iv_list)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]')`;
    await pool.execute(sql, [id, userId, originalName, fileSize, fileType || 'application/octet-stream', storagePath, chunkSize, totalChunks]);
}

async function getCloudFile(fileId) {
    const sql = `SELECT * FROM cloud_files WHERE id = ? AND status != 'deleted'`;
    const [rows] = await pool.execute(sql, [fileId]);
    return rows[0] || null;
}

async function getUserCloudFiles(userId) {
    const sql = `SELECT id, original_name, file_size, file_type, status, uploaded_at 
                 FROM cloud_files WHERE user_id = ? AND status = 'ready' ORDER BY uploaded_at DESC`;
    const [rows] = await pool.execute(sql, [userId]);
    return rows;
}

async function updateCloudFileChunk(fileId, chunkIndex, ivHex) {
    // Append IV to the iv_list JSON array
    const sql = `UPDATE cloud_files 
                 SET chunks_uploaded = chunks_uploaded + 1,
                     iv_list = JSON_ARRAY_APPEND(COALESCE(iv_list, '[]'), '$', ?)
                 WHERE id = ?`;
    await pool.execute(sql, [ivHex, fileId]);
}

async function completeCloudFile(fileId) {
    const sql = `UPDATE cloud_files SET status = 'ready' WHERE id = ?`;
    await pool.execute(sql, [fileId]);
}

async function deleteCloudFile(fileId) {
    const sql = `UPDATE cloud_files SET status = 'deleted' WHERE id = ?`;
    await pool.execute(sql, [fileId]);
}

async function getUserStorageUsed(userId) {
    const sql = `SELECT COALESCE(SUM(file_size), 0) AS total FROM cloud_files WHERE user_id = ? AND status = 'ready'`;
    const [rows] = await pool.execute(sql, [userId]);
    return rows[0].total;
}

async function cleanupIncompleteUploads() {
    // Delete uploads that have been 'uploading' for more than 1 hour
    const sql = `SELECT id, storage_path FROM cloud_files 
                 WHERE status = 'uploading' AND uploaded_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)`;
    const [rows] = await pool.execute(sql);
    if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        await pool.execute(`DELETE FROM cloud_files WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }
    return rows; // return so server can delete files from disk
}

// ═══════════════════════════════════════════
//  PERSISTENT SHARED FILES FUNCTIONS
// ═══════════════════════════════════════════

async function createSharedFile({ id, userId, transferId, originalName, fileSize, fileType, storagePath, aesKeyHex, chunkSize, totalChunks, downloadLimit, expiresAt }) {
    const sql = `INSERT INTO shared_files 
                 (id, user_id, transfer_id, original_name, file_size, file_type, storage_path, aes_key_hex, chunk_size, total_chunks, download_limit, expires_at, iv_list)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`;
    await pool.execute(sql, [id, userId, transferId, originalName, fileSize, fileType || 'application/octet-stream', storagePath, aesKeyHex, chunkSize, totalChunks, downloadLimit, expiresAt]);
}

async function getSharedFile(id) {
    const sql = `SELECT * FROM shared_files WHERE id = ?`;
    const [rows] = await pool.execute(sql, [id]);
    return rows[0] || null;
}

async function getSharedFileByTransferId(transferId) {
    const sql = `SELECT * FROM shared_files WHERE transfer_id = ? AND status = 'ready' AND expires_at > NOW() AND download_count < download_limit`;
    const [rows] = await pool.execute(sql, [transferId]);
    return rows[0] || null;
}

async function updateSharedFileChunk(id, ivHex) {
    const sql = `UPDATE shared_files 
                 SET chunks_uploaded = chunks_uploaded + 1,
                     iv_list = JSON_ARRAY_APPEND(COALESCE(iv_list, '[]'), '$', ?)
                 WHERE id = ?`;
    await pool.execute(sql, [ivHex, id]);
}

async function completeSharedFile(id) {
    const sql = `UPDATE shared_files SET status = 'ready' WHERE id = ?`;
    await pool.execute(sql, [id]);
}

async function incrementSharedFileDownload(id) {
    const sql = `UPDATE shared_files SET download_count = download_count + 1 WHERE id = ?`;
    await pool.execute(sql, [id]);
}

async function deleteSharedFile(id) {
    const sql = `UPDATE shared_files SET status = 'deleted' WHERE id = ?`;
    await pool.execute(sql, [id]);
}

async function cleanExpiredSharedFiles() {
    // Select files that expired or reached download limit, and are not yet deleted
    const sql = `SELECT id, storage_path FROM shared_files 
                 WHERE status != 'deleted' AND 
                 (expires_at <= NOW() OR (status = 'ready' AND download_count >= download_limit) OR (status = 'uploading' AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)))`;
    const [rows] = await pool.execute(sql);
    if (rows.length > 0) {
        const ids = rows.map(r => r.id);
        await pool.execute(`UPDATE shared_files SET status = 'deleted' WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
    }
    return rows;
}

// ═══════════════════════════════════════════
//  FILE ACCESS LOG FUNCTIONS (Table 5)
// ═══════════════════════════════════════════

async function logFileAccess(fileId, userId, action, ipAddress) {
    const sql = `INSERT INTO file_access_logs (file_id, user_id, action, ip_address) VALUES (?, ?, ?, ?)`;
    await pool.execute(sql, [fileId, userId, action, ipAddress || null]);
}

async function getFileAccessLogs(fileId) {
    const sql = `SELECT action, ip_address, accessed_at FROM file_access_logs 
                 WHERE file_id = ? ORDER BY accessed_at DESC LIMIT 20`;
    const [rows] = await pool.execute(sql, [fileId]);
    return rows;
}

// ═══════════════════════════════════════════
//  CONNECTION TEST
// ═══════════════════════════════════════════

async function testConnection() {
    try {
        const conn = await pool.getConnection();
        console.log('✅ Database connected successfully');
        conn.release();
        return true;
    } catch (err) {
        console.error('❌ Database connection failed:', err.message);
        return false;
    }
}

module.exports = {
    pool,
    // Table 1: Transfers
    createTransfer, getTransfer, updateStatus, deleteTransfer, cleanExpired,
    // Table 2: Users
    createUser, getUserByEmail, getUserById, getUserByUsername, updateStorageUsed,
    // Table 3: Login History
    ensureLoginHistoryTable, ensureAllNewTables, saveLoginHistory, getLoginHistory,
    // Table 4: Transfer History
    saveTransferHistory, getTransferHistory,
    // Table 5: Cloud Files
    createCloudFile, getCloudFile, getUserCloudFiles, updateCloudFileChunk,
    completeCloudFile, deleteCloudFile, getUserStorageUsed, cleanupIncompleteUploads,
    // Persistent Shared Files
    createSharedFile, getSharedFile, getSharedFileByTransferId, updateSharedFileChunk,
    completeSharedFile, incrementSharedFileDownload, deleteSharedFile, cleanExpiredSharedFiles,
    // Table 6: Access Logs
    logFileAccess, getFileAccessLogs,
    // Table 7: Password Reset Tokens
    createPasswordResetToken, getPasswordResetToken, deletePasswordResetToken,
    createSignupVerification, getSignupVerification, markSignupVerificationUsed,
    createEmailChangeVerification, getEmailChangeVerification, markEmailChangeVerificationUsed,
    // Table 8: User Settings
    getUserSettings, updateUserSettings, createUserSettings,
    // Table 9: Starred Files
    starFile, unstarFile, getStarredFiles, isFileStarred,
    // Table 10: Audit Logs
    logAudit, getAuditLogs,
    // Password management
    updateUserPassword, getUserPasswordHashById, updateUserProfile,
    // Utils
    testConnection
};
