-- Beamly Database Schema
-- Run this script to create the database and tables
-- Total: 10 Tables + sessions (auto-managed)

CREATE DATABASE IF NOT EXISTS cipherbeam;
USE cipherbeam;

-- ═══════════════════════════════════════════
--  TABLE 1: TRANSFERS (Real-time P2P streaming)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS transfers (
    id           VARCHAR(36) PRIMARY KEY,
    file_name    VARCHAR(255) NOT NULL,
    file_size    BIGINT NOT NULL,
    file_type    VARCHAR(100) DEFAULT 'application/octet-stream',
    aes_key_hex  VARCHAR(128),
    iv_hex       VARCHAR(64),
    status       ENUM('waiting','active','completed','expired') DEFAULT 'waiting',
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at   TIMESTAMP NOT NULL,
    INDEX idx_status (status),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 2: USERS (Authentication)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(50) NOT NULL UNIQUE,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    storage_used  BIGINT DEFAULT 0,
    storage_limit BIGINT DEFAULT 5368709120,               -- 5 GB default
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email (email),
    INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 3: LOGIN HISTORY (Authentication Audit)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS login_history (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    ip_address  VARCHAR(45),
    user_agent  VARCHAR(512),
    logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_login_user (user_id),
    INDEX idx_login_time (logged_in_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 4: TRANSFER HISTORY (P2P transfer logs)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS transfer_history (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    file_name_enc   VARCHAR(512) NOT NULL,
    file_size       BIGINT NOT NULL,
    file_type       VARCHAR(100) DEFAULT 'application/octet-stream',
    direction       ENUM('sent','received') DEFAULT 'sent',
    transferred_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_transferred (transferred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 5: CLOUD FILES (Encrypted Vault Storage)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cloud_files (
    id                VARCHAR(36) PRIMARY KEY,              -- Unique file ID
    user_id           INT NOT NULL,                         -- Owner
    original_name     VARCHAR(512) NOT NULL,                -- Original filename (plaintext for display)
    file_size         BIGINT NOT NULL,                      -- Original file size in bytes
    file_type         VARCHAR(100) DEFAULT 'application/octet-stream',
    storage_path      VARCHAR(512) NOT NULL,                -- Path to encrypted file on disk
    chunk_size        INT DEFAULT 2097152,                  -- 2MB default plaintext chunk size
    total_chunks      INT DEFAULT 0,                        -- Total encrypted chunks
    chunks_uploaded   INT DEFAULT 0,                        -- Progress tracking
    iv_list           LONGTEXT,                             -- JSON array of IVs (hex) per chunk
    status            ENUM('uploading','ready','deleted') DEFAULT 'uploading',
    uploaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_files (user_id, status),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 6: FILE ACCESS LOGS (Audit Trail)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS file_access_logs (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    file_id     VARCHAR(36) NOT NULL,                       -- Which file
    user_id     INT NOT NULL,                               -- Who accessed
    action      ENUM('upload','download','delete') NOT NULL,
    ip_address  VARCHAR(45),                                -- Client IP (IPv4/IPv6)
    accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES cloud_files(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_file_logs (file_id),
    INDEX idx_user_logs (user_id),
    INDEX idx_accessed (accessed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 7: PASSWORD RESET TOKENS (Account Recovery)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    token       VARCHAR(64) NOT NULL UNIQUE,              -- Secure random token
    expires_at  TIMESTAMP NOT NULL,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_tokens (user_id),
    INDEX idx_expires (expires_at),
    INDEX idx_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 8: USER SETTINGS (Preferences)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_settings (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    user_id                 INT NOT NULL UNIQUE,
    theme                   ENUM('light','dark') DEFAULT 'dark',
    notifications_enabled   BOOLEAN DEFAULT TRUE,
    privacy_level           ENUM('private') DEFAULT 'private',
    auto_delete_days        INT DEFAULT 30,                -- Auto-delete completed transfers after N days
    created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_settings (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 9: STARRED FILES (Favorites/Bookmarks)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS starred_files (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT NOT NULL,
    file_id     VARCHAR(36) NOT NULL,
    starred_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES cloud_files(id) ON DELETE CASCADE,
    UNIQUE KEY unique_starred (user_id, file_id),
    INDEX idx_user_starred (user_id),
    INDEX idx_file_starred (file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 10: AUDIT LOGS (Security & Activity)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS audit_logs (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT,                                   -- NULL for system events
    action          VARCHAR(100) NOT NULL,                 -- login, logout, signup, file_upload, file_delete, settings_change, etc.
    resource_type   VARCHAR(50),                           -- user, file, transfer, etc.
    resource_id     VARCHAR(255),
    details         TEXT,                                  -- JSON or description
    ip_address      VARCHAR(45),
    status          ENUM('success','failure') DEFAULT 'success',
    logged_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_audit_user (user_id),
    INDEX idx_audit_action (action),
    INDEX idx_audit_time (logged_at),
    INDEX idx_audit_resource (resource_type, resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 11: SHARED FILES (Persistent Offline Sharing)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shared_files (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 12: SIGNUP VERIFICATIONS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS signup_verifications (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    username          VARCHAR(50) NOT NULL,
    email             VARCHAR(255) NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    code              VARCHAR(6) NOT NULL,                  -- 6-digit OTP
    expires_at        TIMESTAMP NOT NULL,
    used              BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_signup_verify_email (email),
    INDEX idx_signup_verify_code (code),
    INDEX idx_signup_verify_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═══════════════════════════════════════════
--  TABLE 13: EMAIL CHANGE VERIFICATIONS
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS email_change_verifications (
    id                BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id           INT NOT NULL,
    pending_username  VARCHAR(50) NOT NULL,
    pending_email     VARCHAR(255) NOT NULL,
    code              VARCHAR(6) NOT NULL,                  -- 6-digit OTP
    expires_at        TIMESTAMP NOT NULL,
    used              BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_email_verify_user (user_id),
    INDEX idx_email_verify_pending (pending_email),
    INDEX idx_email_verify_code (code),
    INDEX idx_email_verify_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
