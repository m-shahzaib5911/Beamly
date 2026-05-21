USE cipherbeam;

-- Migration: Rename encrypted filename column to plaintext
-- Run this if you have existing data that needs migration
ALTER TABLE cloud_files CHANGE COLUMN original_name_enc original_name VARCHAR(512) NOT NULL;

-- Migration: Add login history table for authentication audits
CREATE TABLE IF NOT EXISTS login_history (
	id           BIGINT AUTO_INCREMENT PRIMARY KEY,
	user_id      INT NOT NULL,
	ip_address   VARCHAR(45),
	user_agent   VARCHAR(512),
	logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	INDEX idx_login_user (user_id),
	INDEX idx_login_time (logged_in_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: Add password reset tokens table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_tokens (user_id),
    INDEX idx_expires (expires_at),
    INDEX idx_token (token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: Add user settings table
CREATE TABLE IF NOT EXISTS user_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    theme ENUM('light','dark') DEFAULT 'dark',
    notifications_enabled BOOLEAN DEFAULT TRUE,
    privacy_level ENUM('public','private','friends') DEFAULT 'private',
    auto_delete_days INT DEFAULT 30,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_settings (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: Add starred files (favorites) table
CREATE TABLE IF NOT EXISTS starred_files (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    file_id VARCHAR(36) NOT NULL,
    starred_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (file_id) REFERENCES cloud_files(id) ON DELETE CASCADE,
    UNIQUE KEY unique_starred (user_id, file_id),
    INDEX idx_user_starred (user_id),
    INDEX idx_file_starred (file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: Add audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: Add signup verification codes table
CREATE TABLE IF NOT EXISTS signup_verifications (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migration: Add email change verification codes table
CREATE TABLE IF NOT EXISTS email_change_verifications (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- If creating fresh tables, use schema.sql instead
