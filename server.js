const express = require('express');
const http = require('http');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 5);
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

const db = require('./db');
const xss = require('xss-clean');

const SMTP_USER = String(process.env.SMTP_USER || process.env.GMAIL_USER || '').trim();
const SMTP_PASSWORD = String(process.env.SMTP_PASSWORD || process.env.GMAIL_PASSWORD || '').trim();
const SMTP_FROM_EMAIL = String(process.env.SMTP_FROM_EMAIL || SMTP_USER).trim();
const SMTP_FROM_NAME = String(process.env.SMTP_FROM_NAME || 'Beamly').trim();
const SMTP_HOST = String(process.env.SMTP_HOST || 'smtp.gmail.com').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true' ? true : SMTP_PORT === 465;

let smtpTransporter = null;

function getSmtpTransporter() {
    if (!SMTP_USER || !SMTP_PASSWORD) {
        return null;
    }

    if (!smtpTransporter) {
        smtpTransporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_SECURE,
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASSWORD
            }
        });
    }

    return smtpTransporter;
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Upload directory
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer config — store raw encrypted bytes
const chunkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB per chunk (encrypted chunk + overhead)
});

// ═══════════════════════════════════════════
//  SESSION STORE (MySQL)
// ═══════════════════════════════════════════

const sessionStore = new MySQLStore({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'cipherbeam',
    clearExpired: true,
    checkExpirationInterval: 900000,
    expiration: 86400000
});

// ═══════════════════════════════════════════
//  MIDDLEWARE
// ═══════════════════════════════════════════

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(xss());

app.use(session({
    key: 'beamly_session',
    secret: process.env.SESSION_SECRET || 'fallback_secret_change_me',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 86400000,
        httpOnly: true,
        secure: false,
        sameSite: 'lax'
    }
}));

app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

function requireAuth(req, res, next) {
    if (req.session && req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Please log in to access this resource' });
    }
}

async function writeAuditLog(req, { userId = null, action, resourceType = null, resourceId = null, details = null, status = 'success' }) {
    try {
        const detailsValue = typeof details === 'string' || details === null
            ? details
            : JSON.stringify(details);
        await db.logAudit(userId, action, resourceType, resourceId, detailsValue, req?.ip || null, status);
    } catch (err) {
        console.error('Audit logging failed:', err.message);
    }
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function isEmailServiceConfigured() {
    return Boolean(SMTP_USER && SMTP_PASSWORD);
}

async function verifyEmailServiceAtStartup() {
    if (!isEmailServiceConfigured()) {
        console.warn('⚠️  Gmail SMTP email service is not configured.');
        return false;
    }

    const transporter = getSmtpTransporter();
    try {
        await transporter.verify();
        console.log(`✅ Gmail SMTP service ready (${SMTP_USER})`);
        return true;
    } catch (err) {
        console.error('❌ Gmail SMTP verification failed:', err.message);
        return false;
    }
}

async function sendEmail({ to, subject, text, html }) {
    if (!isEmailServiceConfigured()) {
        throw new Error('Email service unavailable');
    }

    const transporter = getSmtpTransporter();
    const fromAddress = SMTP_FROM_NAME ? `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>` : SMTP_FROM_EMAIL;
    return transporter.sendMail({
        from: fromAddress,
        to,
        subject,
        text,
        ...(html ? { html } : {})
    });
}

function mapSmtpError(err) {
    const code = String(err?.code || '').toUpperCase();
    const responseCode = Number(err?.responseCode || 0);

    if (code === 'EAUTH' || responseCode === 534 || responseCode === 535) {
        return { status: 502, message: 'SMTP auth failed. Check Gmail app password and SMTP credentials.' };
    }

    if (code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNECTION') {
        return { status: 504, message: 'SMTP connection timed out. Check network/firewall and SMTP host/port.' };
    }

    if (responseCode === 550 || responseCode === 551 || responseCode === 553 || responseCode === 554) {
        return { status: 400, message: 'Recipient email rejected by SMTP server.' };
    }

    return { status: 502, message: err?.message || 'SMTP send failed' };
}

// Select frontend folder
const FRONTEND_DIR = process.env.FRONTEND_DIR || 'public';
console.log(`Serving frontend from: ${FRONTEND_DIR}`);

// Serve landing page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, FRONTEND_DIR, 'index.html'));
});

// Short URL route
app.get('/:id([a-zA-Z0-9_-]{5})', async (req, res, next) => {
    try {
        const transfer = await db.getTransfer(req.params.id);
        if (transfer) {
            res.sendFile(path.join(__dirname, FRONTEND_DIR, 'download.html'));
        } else {
            next();
        }
    } catch (err) {
        console.error('Short URL route error:', err);
        next(err);
    }
});

app.use(express.static(path.join(__dirname, FRONTEND_DIR)));

const rooms = new Map();

// ═══════════════════════════════════════════
//  AUTH API
// ═══════════════════════════════════════════

app.post('/api/auth/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
        if (username.length < 3 || username.length > 50) return res.status(400).json({ error: 'Username must be 3-50 characters' });
        if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ error: 'Username: letters, numbers, underscores only' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });
        if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const existingEmail = await db.getUserByEmail(email);
        if (existingEmail) {
            await writeAuditLog(req, {
                action: 'signup',
                resourceType: 'user',
                details: { email, reason: 'email_exists' },
                status: 'failure'
            });
            return res.status(409).json({ error: 'Email already registered' });
        }
        const existingUsername = await db.getUserByUsername(username);
        if (existingUsername) {
            await writeAuditLog(req, {
                action: 'signup',
                resourceType: 'user',
                details: { username, reason: 'username_exists' },
                status: 'failure'
            });
            return res.status(409).json({ error: 'Username already taken' });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        
        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60000); // 15 mins
        
        // Delete any pending unused verification for this email/username first
        await db.pool.execute(
            `DELETE FROM signup_verifications WHERE (LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)) AND used = FALSE`,
            [email, username]
        );
        
        await db.createSignupVerification(username, email, passwordHash, otp, expiresAt);

        // Send verification email
        try {
            await sendEmail({
                to: email,
                subject: 'Verify your Beamly account',
                text: `Welcome to Beamly. Use this 6-digit verification code to complete signup: ${otp}. This code expires in 15 minutes.`,
                html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
                    <h2 style="color:#38bdf8;margin:0 0 16px;">Verify your Beamly account</h2>
                    <p style="margin:0 0 12px;">Enter this code to finish creating your account:</p>
                    <div style="background:#1e293b;padding:16px;border-radius:8px;text-align:center;margin:16px 0;">
                        <span style="font-size:32px;font-weight:700;letter-spacing:6px;color:#38bdf8;">${otp}</span>
                    </div>
                    <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">This code expires in <strong>15 minutes</strong>.</p>
                    <p style="margin:0;font-size:13px;color:#64748b;">If you did not request this, please ignore this email.</p>
                </div>`,
                category: 'Account Verification'
            });
        } catch (mailErr) {
            console.error("Failed to send verification email:", mailErr);
            return res.status(500).json({ error: 'Failed to send verification email.' });
        }

        res.status(201).json({
            message: 'Verification code sent to your email.',
            verificationRequired: true
        });
    } catch (err) {
        console.error('Signup error:', err);
        if (err?.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Email or username already in use' });
        }
        await writeAuditLog(req, {
            action: 'signup',
            resourceType: 'user',
            details: { username: req.body?.username || null, email: req.body?.email || null, reason: 'server_error' },
            status: 'failure'
        });
        res.status(500).json({ error: 'Signup failed' });
    }
});

app.post('/api/auth/signup/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });

        const verification = await db.getSignupVerification(email, code);
        if (!verification) {
            return res.status(400).json({ error: 'Invalid or expired verification code' });
        }

        if (new Date() > new Date(verification.expires_at)) {
            return res.status(400).json({ error: 'Verification code has expired' });
        }

        // Verify email isn't somehow taken since they started
        const existingEmail = await db.getUserByEmail(email);
        if (existingEmail) return res.status(409).json({ error: 'Email already registered' });
        
        const existingUsername = await db.getUserByUsername(verification.username);
        if (existingUsername) return res.status(409).json({ error: 'Username already taken' });

        // Create user
        const userId = await db.createUser(verification.username, email, verification.password_hash);
        
        // Mark as used
        await db.markSignupVerificationUsed(verification.id);

        // Login the user
        req.session.userId = userId;
        req.session.username = verification.username;
        await saveSession(req);

        await writeAuditLog(req, {
            userId,
            action: 'signup',
            resourceType: 'user',
            resourceId: String(userId),
            details: { username: verification.username, email, verified: true }
        });

        res.status(201).json({
            message: 'Account verified and created',
            user: { id: userId, username: verification.username, email }
        });
    } catch (err) {
        console.error('Verify error:', err);
        res.status(500).json({ error: 'Verification failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

        const user = await db.getUserByEmail(email);
        if (!user) {
            await writeAuditLog(req, {
                action: 'login',
                resourceType: 'user',
                details: { email, reason: 'user_not_found' },
                status: 'failure'
            });
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            await writeAuditLog(req, {
                userId: user.id,
                action: 'login',
                resourceType: 'user',
                resourceId: String(user.id),
                details: { email, reason: 'invalid_password' },
                status: 'failure'
            });
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        req.session.userId = user.id;
        req.session.username = user.username;
        await saveSession(req);

        await db.saveLoginHistory(
            user.id,
            req.ip || null,
            req.get('user-agent') || null
        );

        await writeAuditLog(req, {
            userId: user.id,
            action: 'login',
            resourceType: 'user',
            resourceId: String(user.id),
            details: { email }
        });

        res.json({ message: 'Login successful', user: { id: user.id, username: user.username, email: user.email } });
    } catch (err) {
        console.error('Login error:', err);
        await writeAuditLog(req, {
            action: 'login',
            resourceType: 'user',
            details: { email: req.body?.email || null, reason: 'server_error' },
            status: 'failure'
        });
        res.status(500).json({ error: 'Login failed' });
    }
});

app.post('/api/auth/logout', (req, res) => {
    const userId = req.session?.userId || null;
    req.session.destroy((err) => {
        if (err) {
            writeAuditLog(req, {
                userId,
                action: 'logout',
                resourceType: 'user',
                resourceId: userId ? String(userId) : null,
                details: { reason: 'session_destroy_failed' },
                status: 'failure'
            });
            return res.status(500).json({ error: 'Logout failed' });
        }
        writeAuditLog(req, {
            userId,
            action: 'logout',
            resourceType: 'user',
            resourceId: userId ? String(userId) : null
        });
        res.clearCookie('beamly_session');
        res.json({ message: 'Logged out' });
    });
});

app.get('/api/auth/me', async (req, res) => {
    if (!req.session || !req.session.userId) return res.json({ loggedIn: false });
    try {
        const user = await db.getUserById(req.session.userId);
        if (!user) return res.json({ loggedIn: false });
        res.json({
            loggedIn: true,
            user: {
                id: user.id, username: user.username, email: user.email,
                storageUsed: Number(user.storage_used), storageLimit: Number(user.storage_limit),
                createdAt: user.created_at
            }
        });
    } catch (err) {
        res.json({ loggedIn: false });
    }
});

app.post('/api/user/profile', requireAuth, async (req, res) => {
    try {
        const username = (req.body?.username || '').trim();
        const email = (req.body?.email || '').trim();

        if (!username || !email) {
            return res.status(400).json({ error: 'Username and email are required' });
        }
        if (username.length < 3 || username.length > 50) {
            return res.status(400).json({ error: 'Username must be 3-50 characters' });
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            return res.status(400).json({ error: 'Username: letters, numbers, underscores only' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email format' });
        }

        const currentUserId = Number(req.session.userId);
        const currentUser = await db.getUserById(currentUserId);
        if (!currentUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const existingEmail = await db.getUserByEmail(email);
        if (existingEmail && Number(existingEmail.id) !== currentUserId) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const existingUsername = await db.getUserByUsername(username);
        if (existingUsername && Number(existingUsername.id) !== currentUserId) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        const emailChanged = String(currentUser.email).toLowerCase() !== email.toLowerCase();

        if (emailChanged) {
            if (!isEmailServiceConfigured()) {
                await writeAuditLog(req, {
                    userId: currentUserId,
                    action: 'email_change_verification_sent',
                    resourceType: 'user',
                    resourceId: String(currentUserId),
                    details: { pendingEmail: email, pendingUsername: username, reason: 'smtp_not_configured' },
                    status: 'failure'
                });
                return res.status(503).json({ error: 'Email verification service is unavailable. Please try again later.' });
            }

            const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

            await db.createEmailChangeVerification(currentUserId, username, email, code, expiresAt);

            try {
                await sendEmail({
                    to: email,
                    subject: 'Verify your new Beamly email address',
                    text: `Use this 6-digit code to confirm your new Beamly email address: ${code}. This code expires in 10 minutes.`,
                    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
                        <h2 style="color:#38bdf8;margin:0 0 16px;">Verify your new email address</h2>
                        <p style="margin:0 0 12px;">You requested an email change for your Beamly account. Use this code to confirm:</p>
                        <div style="background:#1e293b;padding:16px;border-radius:8px;text-align:center;margin:16px 0;">
                            <span style="font-size:32px;font-weight:700;letter-spacing:6px;color:#38bdf8;">${code}</span>
                        </div>
                        <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">This code expires in <strong>10 minutes</strong>.</p>
                        <p style="margin:0;font-size:13px;color:#64748b;">If you did not request this, please ignore this email.</p>
                    </div>`,
                    category: 'Email Change Verification'
                });
            } catch (err) {
                console.error('Email verification send failed:', err);
                await writeAuditLog(req, {
                    userId: currentUserId,
                    action: 'email_change_verification_sent',
                    resourceType: 'user',
                    resourceId: String(currentUserId),
                    details: { pendingEmail: email, pendingUsername: username, reason: 'email_send_failed' },
                    status: 'failure'
                });
                return res.status(502).json({ error: 'Failed to send verification email. Please try again.' });
            }

            await writeAuditLog(req, {
                userId: currentUserId,
                action: 'email_change_verification_sent',
                resourceType: 'user',
                resourceId: String(currentUserId),
                details: { pendingEmail: email, pendingUsername: username }
            });

            return res.json({
                verificationRequired: true,
                message: 'A 6-digit verification code has been sent to your new email.',
                expiresInMinutes: 10
            });
        }

        await db.updateUserProfile(currentUserId, username, email);
        req.session.username = username;

        await writeAuditLog(req, {
            userId: currentUserId,
            action: 'profile_update',
            resourceType: 'user',
            resourceId: String(currentUserId),
            details: { username, email }
        });

        const updated = await db.getUserById(currentUserId);
        res.json({
            message: 'Profile updated successfully',
            user: {
                id: updated.id,
                username: updated.username,
                email: updated.email,
                storageUsed: Number(updated.storage_used),
                storageLimit: Number(updated.storage_limit),
                createdAt: updated.created_at
            }
        });
    } catch (err) {
        console.error('Profile update error:', err);
        await writeAuditLog(req, {
            userId: req.session.userId || null,
            action: 'profile_update',
            resourceType: 'user',
            resourceId: req.session?.userId ? String(req.session.userId) : null,
            details: { reason: 'server_error' },
            status: 'failure'
        });
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

app.post('/api/user/profile/verify-email', requireAuth, async (req, res) => {
    try {
        const code = String(req.body?.code || '').trim();
        if (!/^\d{6}$/.test(code)) {
            return res.status(400).json({ error: 'Verification code must be 6 digits' });
        }

        const currentUserId = Number(req.session.userId);
        const verification = await db.getEmailChangeVerification(currentUserId, code);
        if (!verification) {
            await writeAuditLog(req, {
                userId: currentUserId,
                action: 'email_change_verification_failed',
                resourceType: 'user',
                resourceId: String(currentUserId),
                details: { reason: 'invalid_or_expired_code' },
                status: 'failure'
            });
            return res.status(400).json({ error: 'Invalid or expired verification code' });
        }

        const existingEmail = await db.getUserByEmail(verification.pending_email);
        if (existingEmail && Number(existingEmail.id) !== currentUserId) {
            return res.status(409).json({ error: 'Email already registered' });
        }
        const existingUsername = await db.getUserByUsername(verification.pending_username);
        if (existingUsername && Number(existingUsername.id) !== currentUserId) {
            return res.status(409).json({ error: 'Username already taken' });
        }

        await db.updateUserProfile(currentUserId, verification.pending_username, verification.pending_email);
        await db.markEmailChangeVerificationUsed(verification.id);
        req.session.username = verification.pending_username;

        const updated = await db.getUserById(currentUserId);
        await writeAuditLog(req, {
            userId: currentUserId,
            action: 'email_change_verified',
            resourceType: 'user',
            resourceId: String(currentUserId),
            details: { email: verification.pending_email, username: verification.pending_username }
        });

        res.json({
            message: 'Email verified and profile updated successfully',
            user: {
                id: updated.id,
                username: updated.username,
                email: updated.email,
                storageUsed: Number(updated.storage_used),
                storageLimit: Number(updated.storage_limit),
                createdAt: updated.created_at
            }
        });
    } catch (err) {
        console.error('Verify email change error:', err);
        await writeAuditLog(req, {
            userId: req.session.userId || null,
            action: 'email_change_verification_failed',
            resourceType: 'user',
            resourceId: req.session?.userId ? String(req.session.userId) : null,
            details: { reason: 'server_error' },
            status: 'failure'
        });
        res.status(500).json({ error: 'Failed to verify email change' });
    }
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const user = await db.getUserPasswordHashById(req.session.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const currentMatches = await bcrypt.compare(currentPassword, user.password_hash);
        if (!currentMatches) {
            await writeAuditLog(req, {
                userId: req.session.userId,
                action: 'password_change',
                resourceType: 'user',
                resourceId: String(req.session.userId),
                details: { reason: 'invalid_current_password' },
                status: 'failure'
            });
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
        if (isSamePassword) {
            return res.status(400).json({ error: 'New password must be different from current password' });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await db.updateUserPassword(req.session.userId, hashed);

        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'password_change',
            resourceType: 'user',
            resourceId: String(req.session.userId)
        });

        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        await writeAuditLog(req, {
            userId: req.session.userId || null,
            action: 'password_change',
            resourceType: 'user',
            resourceId: req.session?.userId ? String(req.session.userId) : null,
            details: { reason: 'server_error' },
            status: 'failure'
        });
        res.status(500).json({ error: 'Failed to change password' });
    }
});

app.get('/api/auth/login-history', requireAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit, 10) || 20;
        const history = await db.getLoginHistory(req.session.userId, limit);
        res.json({ history });
    } catch (err) {
        console.error('Login history fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch login history' });
    }
});

// ═══════════════════════════════════════════
//  USER HISTORY API
// ═══════════════════════════════════════════

app.get('/api/user/history', requireAuth, async (req, res) => {
    try {
        const history = await db.getTransferHistory(req.session.userId);
        res.json({ history });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

app.post('/api/user/history', requireAuth, async (req, res) => {
    try {
        const { fileNameEnc, fileSize, fileType, direction } = req.body;
        if (!fileNameEnc || !fileSize) return res.status(400).json({ error: 'Missing fields' });
        await db.saveTransferHistory(req.session.userId, { fileNameEnc, fileSize, fileType, direction });
        res.json({ message: 'Saved' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save history' });
    }
});

// ═══════════════════════════════════════════
//  TRANSFER API
// ═══════════════════════════════════════════

app.post('/api/transfers', async (req, res) => {
    try {
        const { fileName, fileSize, fileType, aesKeyHex, ivHex, expiryMinutes } = req.body;
        if (!fileName || !fileSize) return res.status(400).json({ error: 'Missing fields' });

        const id = nanoid(5);
        let mins = parseInt(expiryMinutes) || parseInt(process.env.LINK_EXPIRY_MINUTES) || 10;
        
        // Max 7 days limit
        if (mins > 10080) mins = 10080;
        
        // Only allow custom expiry if logged in
        if (!req.session || !req.session.userId) {
            mins = parseInt(process.env.LINK_EXPIRY_MINUTES) || 10;
        }
        
        const expiresAt = new Date(Date.now() + mins * 60 * 1000);

        await db.createTransfer({ id, fileName, fileSize, fileType: fileType || 'application/octet-stream', aesKeyHex, ivHex, expiresAt });
        const shareLink = `${req.protocol}://${req.get('host')}/${id}`;
        res.json({ transferId: id, shareLink, expiresAt: expiresAt.toISOString() });
    } catch (err) {
        res.status(500).json({ error: 'Failed to create transfer' });
    }
});

app.get('/api/transfers/:id', async (req, res) => {
    try {
        let transfer = await db.getTransfer(req.params.id);
        
        if (transfer) {
            return res.json({
                id: transfer.id, fileName: transfer.file_name, fileSize: transfer.file_size,
                fileType: transfer.file_type, aesKeyHex: transfer.aes_key_hex, ivHex: transfer.iv_hex,
                status: transfer.status, expiresAt: transfer.expires_at, isStored: false
            });
        }
        
        // Check if it's a persistent shared file
        const sharedFile = await db.getSharedFileByTransferId(req.params.id);
        if (sharedFile) {
            return res.json({
                id: sharedFile.transfer_id, fileName: sharedFile.original_name, fileSize: sharedFile.file_size,
                fileType: sharedFile.file_type, aesKeyHex: sharedFile.aes_key_hex,
                status: sharedFile.status, expiresAt: sharedFile.expires_at, isStored: true
            });
        }
        
        return res.status(404).json({ error: 'Transfer not found or expired' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to get transfer' });
    }
});

app.post('/api/transfers/send-email', requireAuth, async (req, res) => {
    try {
        const { transferId, recipientEmail, shareLink } = req.body;
        if (!transferId || !recipientEmail || !shareLink) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(recipientEmail))) {
            return res.status(400).json({ error: 'Invalid recipient email format' });
        }
        
        if (!isEmailServiceConfigured()) {
            return res.status(503).json({ error: 'Email service unavailable' });
        }
        
        const senderName = req.session.username;
        
        await sendEmail({
            to: recipientEmail,
            subject: `${senderName} shared a file with you via Beamly`,
            text: `${senderName} has securely shared a file with you using Beamly. Access it here: ${shareLink}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
                <h2 style="color:#38bdf8;margin:0 0 16px;">Secure File Received</h2>
                <p style="margin:0 0 12px;"><strong>${senderName}</strong> has securely shared a file with you via Beamly.</p>
                <div style="background:#1e293b;padding:24px;border-radius:8px;text-align:center;margin:24px 0;">
                    <a href="${shareLink}" style="display:inline-block;padding:12px 24px;background:#38bdf8;color:#0f172a;text-decoration:none;border-radius:100px;font-weight:bold;font-size:16px;">Download Secure File</a>
                </div>
                <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">This file is end-to-end encrypted and can only be downloaded once the sender is online, unless it was sent via our offline vault feature.</p>
            </div>`,
            category: 'File Share'
        });
        
        res.json({ message: 'Email sent successfully' });
    } catch (err) {
        console.error('Send email error:', {
            code: err?.code || null,
            responseCode: err?.responseCode || null,
            message: err?.message || null,
            response: err?.response || null
        });
        const mapped = mapSmtpError(err);
        res.status(mapped.status).json({ error: mapped.message });
    }
});

// ═══════════════════════════════════════════
//  OFFLINE PERSISTENT SHARE API
// ═══════════════════════════════════════════

app.post('/api/share/init', requireAuth, async (req, res) => {
    try {
        const { fileName, fileSize, fileType, aesKeyHex, chunkSize, totalChunks, downloadLimit, expiryMinutes } = req.body;

        if (!fileName || !fileSize || !totalChunks || !aesKeyHex) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const transferId = nanoid(5);
        const fileId = uuidv4();
        const storagePath = path.join(UPLOAD_DIR, `${fileId}_share.enc`);
        
        let mins = parseInt(expiryMinutes) || parseInt(process.env.LINK_EXPIRY_MINUTES) || 10;
        if (mins > 10080) mins = 10080; // max 7 days
        const expiresAt = new Date(Date.now() + mins * 60 * 1000);

        await db.createSharedFile({
            id: fileId,
            userId: req.session.userId,
            transferId,
            originalName: fileName,
            fileSize,
            fileType: fileType || 'application/octet-stream',
            storagePath,
            aesKeyHex,
            chunkSize: chunkSize || 2097152,
            totalChunks,
            downloadLimit: parseInt(downloadLimit) || 1,
            expiresAt
        });

        const shareLink = `${req.protocol}://${req.get('host')}/${transferId}`;

        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'share_upload_init',
            resourceType: 'shared_file',
            resourceId: fileId,
            details: { transferId, fileName, fileSize, totalChunks, downloadLimit }
        });

        res.json({ fileId, transferId, shareLink, totalChunks, expiresAt: expiresAt.toISOString() });
    } catch (err) {
        console.error('Share init error:', err);
        res.status(500).json({ error: 'Failed to initialize offline share' });
    }
});

app.post('/api/share/chunk/:id', requireAuth, chunkUpload.single('chunk'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No chunk data provided' });
        
        const fileId = req.params.id;
        const { ivHex, index } = req.body;
        
        if (!ivHex || index === undefined) {
            return res.status(400).json({ error: 'Missing ivHex or index' });
        }

        const sharedFile = await db.getSharedFile(fileId);
        if (!sharedFile || sharedFile.user_id !== req.session.userId) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        if (sharedFile.status !== 'uploading') {
            return res.status(400).json({ error: 'File is not in uploading state' });
        }

        fs.appendFileSync(sharedFile.storage_path, req.file.buffer);

        await db.updateSharedFileChunk(fileId, ivHex);

        res.json({ message: 'Chunk uploaded' });
    } catch (err) {
        console.error('Share chunk error:', err);
        res.status(500).json({ error: 'Failed to upload chunk' });
    }
});

app.post('/api/share/complete/:id', requireAuth, async (req, res) => {
    try {
        const fileId = req.params.id;
        
        const sharedFile = await db.getSharedFile(fileId);
        if (!sharedFile || sharedFile.user_id !== req.session.userId) {
            return res.status(404).json({ error: 'File not found or unauthorized' });
        }

        await db.completeSharedFile(fileId);

        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'share_upload_complete',
            resourceType: 'shared_file',
            resourceId: fileId
        });

        res.json({ message: 'Upload completed' });
    } catch (err) {
        console.error('Share complete error:', err);
        res.status(500).json({ error: 'Failed to complete upload' });
    }
});

app.get('/api/share/stream/:transferId', async (req, res) => {
    try {
        const transferId = req.params.transferId;
        const sharedFile = await db.getSharedFileByTransferId(transferId);
        
        if (!sharedFile) {
            return res.status(404).json({ error: 'File not found, expired, or download limit reached' });
        }

        // Check if file exists on disk
        if (!fs.existsSync(sharedFile.storage_path)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        // Increment download count
        await db.incrementSharedFileDownload(sharedFile.id);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Transfer-Encoding', 'chunked');
        
        // Write start of array
        res.write('[');
        
        const ivList = typeof sharedFile.iv_list === 'string' ? JSON.parse(sharedFile.iv_list) : sharedFile.iv_list;
        
        const readStream = fs.createReadStream(sharedFile.storage_path, { highWaterMark: sharedFile.chunk_size + 16 }); // data + tag
        
        let chunkIndex = 0;
        let isFirst = true;

        readStream.on('data', (chunk) => {
            const ivHex = ivList[chunkIndex];
            
            if (!ivHex) {
                console.error(`Missing IV for chunk ${chunkIndex} of shared file ${sharedFile.id}`);
                return;
            }

            const prefix = isFirst ? '' : ',';
            isFirst = false;
            
            const chunkData = {
                iv: ivHex,
                data: chunk.toString('base64')
            };
            
            res.write(prefix + JSON.stringify(chunkData));
            chunkIndex++;
        });

        readStream.on('end', () => {
            res.write(']');
            res.end();
        });

        readStream.on('error', (err) => {
            console.error('Stream error:', err);
            if (!res.headersSent) res.status(500).json({ error: 'Streaming failed' });
            else res.end();
        });
        
    } catch (err) {
        console.error('Share stream error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'Streaming failed' });
    }
});

// ═══════════════════════════════════════════
//  ENCRYPTED VAULT API (Table 4 + Table 5)
// ═══════════════════════════════════════════

// Initialize upload — create file record
app.post('/api/vault/init', requireAuth, async (req, res) => {
    try {
        const { fileName, fileSize, fileType, chunkSize, totalChunks } = req.body;

        if (!fileName || !fileSize || !totalChunks) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check storage limit
        const user = await db.getUserById(req.session.userId);
        const currentUsed = Number(user.storage_used);
        const limit = Number(user.storage_limit);

        if (currentUsed + fileSize > limit) {
            await writeAuditLog(req, {
                userId: req.session.userId,
                action: 'vault_upload_init',
                resourceType: 'file',
                details: { fileName, fileSize, reason: 'storage_limit_exceeded' },
                status: 'failure'
            });
            return res.status(413).json({ 
                error: 'Storage limit exceeded',
                used: currentUsed,
                limit: limit,
                fileSize: fileSize
            });
        }

        const fileId = uuidv4();
        const storagePath = path.join(UPLOAD_DIR, `${fileId}.enc`);

        await db.createCloudFile({
            id: fileId,
            userId: req.session.userId,
            originalName: fileName,  // Store plaintext filename
            fileSize,
            fileType: fileType || 'application/octet-stream',
            storagePath,
            chunkSize: chunkSize || 2097152,
            totalChunks
        });

        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'vault_upload_init',
            resourceType: 'file',
            resourceId: fileId,
            details: { fileName, fileSize, totalChunks }
        });

        res.json({ fileId, totalChunks });
    } catch (err) {
        console.error('Vault init error:', err);
        res.status(500).json({ error: 'Failed to initialize upload' });
    }
});

// Upload one encrypted chunk
app.post('/api/vault/chunk/:fileId', requireAuth, chunkUpload.single('chunk'), async (req, res) => {
    try {
        const { fileId } = req.params;
        const { chunkIndex, iv } = req.body;

        const file = await db.getCloudFile(fileId);
        if (!file || file.user_id !== req.session.userId) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (file.status !== 'uploading') {
            return res.status(400).json({ error: 'Upload already completed' });
        }

        if (!req.file || !req.file.buffer) {
            return res.status(400).json({ error: 'No chunk data received' });
        }

        // Append encrypted chunk to file on disk
        // Format per chunk: [4-byte chunk length][encrypted data]
        const chunkData = req.file.buffer;
        const lengthBuffer = Buffer.alloc(4);
        lengthBuffer.writeUInt32BE(chunkData.length, 0);

        fs.appendFileSync(file.storage_path, lengthBuffer);
        fs.appendFileSync(file.storage_path, chunkData);

        // Update DB with IV for this chunk
        await db.updateCloudFileChunk(fileId, parseInt(chunkIndex), iv);

        res.json({ chunkIndex: parseInt(chunkIndex), received: true });
    } catch (err) {
        console.error('Vault chunk error:', err);
        res.status(500).json({ error: 'Failed to upload chunk' });
    }
});

// Finalize upload
app.post('/api/vault/complete/:fileId', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const file = await db.getCloudFile(fileId);

        if (!file || file.user_id !== req.session.userId) {
            return res.status(404).json({ error: 'File not found' });
        }

        await db.completeCloudFile(fileId);
        await db.updateStorageUsed(req.session.userId, file.file_size);
        await db.logFileAccess(fileId, req.session.userId, 'upload', req.ip);
        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'file_upload',
            resourceType: 'file',
            resourceId: fileId,
            details: { fileName: file.original_name, fileSize: file.file_size }
        });

        res.json({ message: 'Upload complete', fileId });
    } catch (err) {
        console.error('Vault complete error:', err);
        res.status(500).json({ error: 'Failed to finalize upload' });
    }
});

// List user's vault files
app.get('/api/vault/files', requireAuth, async (req, res) => {
    try {
        const files = await db.getUserCloudFiles(req.session.userId);
        const user = await db.getUserById(req.session.userId);
        res.json({
            files,
            storageUsed: Number(user.storage_used),
            storageLimit: Number(user.storage_limit)
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch vault files' });
    }
});

// Download encrypted file (stream) + IV data
app.get('/api/vault/download/:fileId', requireAuth, async (req, res) => {
    try {
        const file = await db.getCloudFile(req.params.fileId);
        if (!file || file.user_id !== req.session.userId) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (!fs.existsSync(file.storage_path)) {
            return res.status(404).json({ error: 'Encrypted file not found on disk' });
        }

        await db.logFileAccess(file.id, req.session.userId, 'download', req.ip);
        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'file_download',
            resourceType: 'file',
            resourceId: file.id,
            details: { fileName: file.original_name, fileSize: file.file_size }
        });

        // Send metadata as JSON header, then stream the encrypted file
        res.json({
            fileId: file.id,
            originalName: file.original_name,  // Plaintext filename
            fileSize: file.file_size,
            fileType: file.file_type,
            chunkSize: file.chunk_size,
            totalChunks: file.total_chunks,
            ivList: JSON.parse(file.iv_list || '[]')
        });
    } catch (err) {
        console.error('Vault download meta error:', err);
        res.status(500).json({ error: 'Failed to get file info' });
    }
});

// Stream the actual encrypted binary
app.get('/api/vault/stream/:fileId', requireAuth, async (req, res) => {
    try {
        const file = await db.getCloudFile(req.params.fileId);
        if (!file || file.user_id !== req.session.userId) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (!fs.existsSync(file.storage_path)) {
            return res.status(404).json({ error: 'Encrypted file not found on disk' });
        }

        const stat = fs.statSync(file.storage_path);
        res.set({
            'Content-Type': 'application/octet-stream',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${file.id}.enc"`
        });

        const readStream = fs.createReadStream(file.storage_path);
        readStream.pipe(res);
    } catch (err) {
        console.error('Vault stream error:', err);
        res.status(500).json({ error: 'Failed to stream file' });
    }
});

// Delete vault file
app.delete('/api/vault/files/:fileId', requireAuth, async (req, res) => {
    try {
        const file = await db.getCloudFile(req.params.fileId);
        if (!file || file.user_id !== req.session.userId) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Delete from disk
        if (fs.existsSync(file.storage_path)) {
            fs.unlinkSync(file.storage_path);
        }

        // Update storage
        await db.updateStorageUsed(req.session.userId, -file.file_size);
        await db.logFileAccess(file.id, req.session.userId, 'delete', req.ip);
        await db.deleteCloudFile(file.id);
        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'file_delete',
            resourceType: 'file',
            resourceId: file.id,
            details: { fileName: file.original_name, fileSize: file.file_size }
        });

        res.json({ message: 'File deleted' });
    } catch (err) {
        console.error('Vault delete error:', err);
        res.status(500).json({ error: 'Failed to delete file' });
    }
});

// ═══════════════════════════════════════════
//  STARRED FILES API (Table: starred_files)
// ═══════════════════════════════════════════

app.get('/api/starred', requireAuth, async (req, res) => {
    try {
        const rows = await db.getStarredFiles(req.session.userId);
        res.json({ files: rows });
    } catch (err) {
        console.error('Get starred error:', err);
        res.status(500).json({ error: 'Failed to fetch starred files' });
    }
});

app.post('/api/star/:fileId', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        await db.starFile(req.session.userId, fileId);
        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'file_star',
            resourceType: 'file',
            resourceId: fileId
        });
        res.json({ message: 'Starred' });
    } catch (err) {
        console.error('Star error:', err);
        res.status(500).json({ error: 'Failed to star file' });
    }
});

app.post('/api/unstar/:fileId', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        await db.unstarFile(req.session.userId, fileId);
        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'file_unstar',
            resourceType: 'file',
            resourceId: fileId
        });
        res.json({ message: 'Unstarred' });
    } catch (err) {
        console.error('Unstar error:', err);
        res.status(500).json({ error: 'Failed to unstar file' });
    }
});

// ═══════════════════════════════════════════
//  USER SETTINGS API (Table: user_settings)
// ═══════════════════════════════════════════

app.get('/api/user/settings', requireAuth, async (req, res) => {
    try {
        let s = await db.getUserSettings(req.session.userId);
        if (!s) {
            await db.createUserSettings(req.session.userId);
            s = await db.getUserSettings(req.session.userId);
        }
        res.json({ settings: s });
    } catch (err) {
        console.error('Get settings error:', err);
        res.status(500).json({ error: 'Failed to get settings' });
    }
});

app.post('/api/user/settings', requireAuth, async (req, res) => {
    try {
        const settings = req.body || {};
        await db.updateUserSettings(req.session.userId, settings);
        await writeAuditLog(req, {
            userId: req.session.userId,
            action: 'settings_change',
            resourceType: 'user',
            resourceId: String(req.session.userId),
            details: {
                theme: settings.theme,
                notifications_enabled: settings.notifications_enabled,
                privacy_level: settings.privacy_level,
                auto_delete_days: settings.auto_delete_days
            }
        });
        res.json({ message: 'Settings updated' });
    } catch (err) {
        console.error('Update settings error:', err);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// ═══════════════════════════════════════════
//  PASSWORD RESET API (Table: password_reset_tokens)
// ═══════════════════════════════════════════

app.post('/api/auth/password-reset/request', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email required' });
        if (!isEmailServiceConfigured()) {
            return res.status(503).json({ error: 'Email service is unavailable. Please try again later.' });
        }
        const user = await db.getUserByEmail(email);
        if (!user) {
            await writeAuditLog(req, {
                action: 'password_reset_request',
                resourceType: 'user',
                details: { email, reason: 'user_not_found' },
                status: 'failure'
            });
            return res.json({ ok: true }); // don't reveal existence
        }

        const token = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        await db.createPasswordResetToken(user.id, token, expiresAt);
        await writeAuditLog(req, {
            userId: user.id,
            action: 'password_reset_request',
            resourceType: 'user',
            resourceId: String(user.id),
            details: { email: user.email }
        });

        try {
            await sendEmail({
                to: user.email,
                subject: 'Your Beamly password reset code',
                text: `Use this 6-digit code to reset your Beamly password: ${token}. This code expires in 15 minutes.`,
                html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0f172a;color:#e2e8f0;border-radius:12px;">
                    <h2 style="color:#38bdf8;margin:0 0 16px;">Beamly Password Reset</h2>
                    <p style="margin:0 0 12px;">You requested to reset your password. Use the code below:</p>
                    <div style="background:#1e293b;padding:16px;border-radius:8px;text-align:center;margin:16px 0;">
                        <span style="font-size:32px;font-weight:700;letter-spacing:6px;color:#38bdf8;">${token}</span>
                    </div>
                    <p style="margin:0 0 8px;font-size:14px;color:#94a3b8;">This code expires in <strong>15 minutes</strong>.</p>
                    <p style="margin:0;font-size:13px;color:#64748b;">If you did not request this, please ignore this email.</p>
                </div>`,
                category: 'Password Reset'
            });
            return res.json({ ok: true });
        } catch (err) {
            console.error('SMTP send failed:', err);
            return res.status(502).json({ error: 'Failed to send password reset email. Please try again.' });
        }
    } catch (err) {
        console.error('Password reset request error:', err);
        await writeAuditLog(req, {
            action: 'password_reset_request',
            resourceType: 'user',
            details: { email: req.body?.email || null, reason: 'server_error' },
            status: 'failure'
        });
        res.status(500).json({ error: 'Failed to request password reset' });
    }
});

app.post('/api/auth/password-reset/confirm', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Missing fields' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
        const rec = await db.getPasswordResetToken(token);
        if (!rec) {
            await writeAuditLog(req, {
                action: 'password_reset_confirm',
                resourceType: 'user',
                details: { reason: 'invalid_or_expired_token' },
                status: 'failure'
            });
            return res.status(400).json({ error: 'Invalid or expired token' });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await db.updateUserPassword(rec.user_id, hashed);
        await db.deletePasswordResetToken(token);
        await writeAuditLog(req, {
            userId: rec.user_id,
            action: 'password_reset_confirm',
            resourceType: 'user',
            resourceId: String(rec.user_id)
        });

        res.json({ message: 'Password updated' });
    } catch (err) {
        console.error('Password reset confirm error:', err);
        await writeAuditLog(req, {
            action: 'password_reset_confirm',
            resourceType: 'user',
            details: { reason: 'server_error' },
            status: 'failure'
        });
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// ═══════════════════════════════════════════
//  AUDIT LOGS & FILE ACCESS (read-only)
// ═══════════════════════════════════════════

app.get('/api/audit', requireAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = await db.getAuditLogs({ userId: req.session.userId, limit });
        res.json({ logs });
    } catch (err) {
        console.error('Audit fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

app.get('/api/file-access/:fileId', requireAuth, async (req, res) => {
    try {
        const { fileId } = req.params;
        const file = await db.getCloudFile(fileId);
        if (!file || file.user_id !== req.session.userId) return res.status(404).json({ error: 'File not found' });
        const logs = await db.getFileAccessLogs(fileId);
        res.json({ logs });
    } catch (err) {
        console.error('File access logs error:', err);
        res.status(500).json({ error: 'Failed to fetch file access logs' });
    }
});

// ═══════════════════════════════════════════
//  WEBSOCKET RELAY
// ═══════════════════════════════════════════

wss.on('connection', (ws) => {
    let currentRoom = null;
    let role = null;

    ws.on('message', async (data) => {
        try {
            let msg;
            let isBinary = false;

            if (data instanceof Buffer || data instanceof ArrayBuffer) {
                try { msg = JSON.parse(data.toString('utf8')); } catch { isBinary = true; }
            } else {
                msg = JSON.parse(data);
            }

            if (isBinary) {
                if (currentRoom && role === 'sender') {
                    const room = rooms.get(currentRoom);
                    if (room && room.recipient && room.recipient.readyState === 1) {
                        room.recipient.send(data, { binary: true });
                    }
                }
                return;
            }

            switch (msg.type) {
                case 'join-room': {
                    const { transferId, as } = msg;
                    const transfer = await db.getTransfer(transferId);
                    if (!transfer) { ws.send(JSON.stringify({ type: 'error', message: 'Transfer not found' })); return; }
                    currentRoom = transferId;
                    role = as;
                    if (!rooms.has(transferId)) rooms.set(transferId, { sender: null, recipient: null });
                    const room = rooms.get(transferId);
                    room[role] = ws;
                    console.log(`[WS] ${role} joined room ${transferId}`);
                    if (room.sender && room.recipient) {
                        await db.updateStatus(transferId, 'active');
                        room.sender.send(JSON.stringify({ type: 'recipient-ready' }));
                        room.recipient.send(JSON.stringify({ type: 'transfer-starting' }));
                    }
                    break;
                }
                case 'chunk-meta': {
                    if (currentRoom && role === 'sender') {
                        const room = rooms.get(currentRoom);
                        if (room && room.recipient && room.recipient.readyState === 1) room.recipient.send(JSON.stringify(msg));
                    }
                    break;
                }
                case 'transfer-complete': {
                    if (currentRoom) {
                        const room = rooms.get(currentRoom);
                        if (room) {
                            const other = role === 'sender' ? room.recipient : room.sender;
                            if (other && other.readyState === 1) other.send(JSON.stringify({ type: 'transfer-complete' }));
                        }
                        await db.deleteTransfer(currentRoom);
                        rooms.delete(currentRoom);
                    }
                    break;
                }
                case 'transfer-progress': {
                    if (currentRoom) {
                        const room = rooms.get(currentRoom);
                        if (room) {
                            const other = role === 'sender' ? room.recipient : room.sender;
                            if (other && other.readyState === 1) other.send(JSON.stringify(msg));
                        }
                    }
                    break;
                }
            }
        } catch (err) { console.error('[WS] Error:', err); }
    });

    ws.on('close', async () => {
        if (currentRoom) {
            const room = rooms.get(currentRoom);
            if (room) {
                const other = role === 'sender' ? room.recipient : room.sender;
                if (other && other.readyState === 1) {
                    other.send(JSON.stringify({ type: 'peer-disconnected', message: `${role} disconnected` }));
                }
                room[role] = null;
                if (!room.sender && !room.recipient) rooms.delete(currentRoom);
            }
        }
    });

    ws.on('error', (err) => console.error('[WS] Socket error:', err.message));
});

// ═══════════════════════════════════════════
//  CLEANUP CRON
// ═══════════════════════════════════════════

setInterval(async () => {
    try {
        const deleted = await db.cleanExpired();
        if (deleted > 0) console.log(`[CLEANUP] Removed ${deleted} expired transfer(s)`);

        // Cleanup incomplete vault uploads
        const incomplete = await db.cleanupIncompleteUploads();
        for (const file of incomplete) {
            if (fs.existsSync(file.storage_path)) {
                fs.unlinkSync(file.storage_path);
                console.log(`[CLEANUP] Removed incomplete upload: ${file.id}`);
            }
        }
        
        // Cleanup expired offline shared files
        const expiredSharedFiles = await db.cleanExpiredSharedFiles();
        for (const file of expiredSharedFiles) {
            if (fs.existsSync(file.storage_path)) {
                fs.unlinkSync(file.storage_path);
                console.log(`[CLEANUP] Removed expired shared file: ${file.id}`);
            }
        }
    } catch (err) {
        console.error('[CLEANUP] Error:', err.message);
    }
}, 60 * 1000);

// ═══════════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════════

const PORT = process.env.PORT || 3000;

async function start() {
    const dbOk = await db.testConnection();
    if (!dbOk) {
        console.error('⚠️  Cannot start without database.');
        process.exit(1);
    }

    await db.ensureLoginHistoryTable();
    await db.ensureAllNewTables();
    await verifyEmailServiceAtStartup();

    server.listen(PORT, '0.0.0.0', () => {
        console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║   Beamly Server Running                      ║
║                                              ║
║   Local:  http://localhost:${PORT}             ║
║   Mode:   ${process.env.NODE_ENV || 'development'}                    ║
║                                              ║
║   End-to-end encrypted                       ║
║   Encrypted Vault active                     ║
║   WebSocket relay active                     ║
║                                              ║
╚══════════════════════════════════════════════╝
        `);
    });
}

start();
