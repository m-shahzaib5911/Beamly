# 🔐 Beamly - End-to-End Encrypted File Sharing

[![Node.js](https://img.shields.io/badge/Node.js-18.0+-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-4.21+-blue?style=flat-square&logo=express)](https://expressjs.com/)
[![MySQL](https://img.shields.io/badge/MySQL-8.0+-orange?style=flat-square&logo=mysql)](https://www.mysql.com/)
[![License](https://img.shields.io/badge/License-MIT-purple?style=flat-square)](LICENSE)
[![Security](https://img.shields.io/badge/Encryption-AES--256-red?style=flat-square)](docs/)
[![WebSocket](https://img.shields.io/badge/RealTime-WebSocket-cyan?style=flat-square)](https://socket.io/)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen?style=flat-square)](https://github.com)

> 🚀 **Secure, zero-storage file sharing with end-to-end encryption**

Beamly is a modern file-sharing platform that prioritizes **privacy** and **security**. Share files directly between users with **military-grade AES-256 encryption**, maintain a **private encrypted vault**, and keep complete **audit logs** of all activities.

---

## ✨ Key Features

### 🔒 Security First
- **AES-256 Encryption**: All files encrypted end-to-end before transmission
- **Zero-Knowledge Architecture**: Server never holds unencrypted data
- **Bcrypt Password Hashing**: Secure password storage with salt rounds
- **OTP Email Verification**: Additional security layer for authentication
- **Session Management**: MySQL-backed secure sessions

### 📤 Real-Time P2P Transfers
- **WebSocket-based** direct file transfers between users
- **No Server Storage**: Files stream directly without saving to disk
- **Fast & Efficient**: Real-time progress tracking
- **Automatic Expiry**: Transfer links expire after configurable time

### 🗂️ Encrypted Cloud Vault
- **Upload & Store**: Keep files in encrypted cloud storage
- **Quota Management**: 5GB default storage per user
- **Chunk Upload Support**: Upload large files in encrypted chunks
- **Progress Tracking**: Monitor upload completion
- **Access Logs**: See who accessed which files and when

### 👤 User Management
- **User Registration**: Secure signup with email verification
- **Login History**: Track all login attempts with IP & User-Agent
- **Password Reset**: OTP-based secure password recovery
- **User Settings**: Customizable storage quotas and preferences

### 📊 Comprehensive Audit Trail
- **Access Logs**: Track all file downloads and access attempts
- **Transfer History**: Complete history of sent/received files
- **IP Tracking**: Log IP addresses for security monitoring
- **Timestamp Records**: All activities timestamped for compliance

---

## 📋 System Architecture

### Tech Stack

**Frontend:**
- HTML5, CSS3, JavaScript (Vanilla ES6+)
- WebSocket client for real-time transfers
- Web Crypto API for client-side encryption

**Backend:**
- Node.js + Express.js
- WebSocket (ws library) for real-time P2P transfers
- Multer for file upload handling

**Database:**
- MySQL 8.0 with InnoDB engine
- Connection pooling for performance
- 10+ tables for comprehensive data management

**Security Libraries:**
- Bcrypt (password hashing)
- UUID (unique identifiers)
- Nanoid (short transfer IDs)
- XSS-Clean (XSS protection)
- Nodemailer (email delivery)

---

## 🚀 Installation & Setup

### Prerequisites

- **Node.js** 18.0 or higher
- **MySQL** 8.0 or higher
- **npm** 9.0 or higher

### Step 1: Clone Repository

```bash
git clone https://github.com/yourusername/beamly.git
cd beamly
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment Variables

1. Copy the example configuration:
```bash
cp .env.example .env
```

2. Edit `.env` and fill in your configuration:

```bash
# Database Configuration
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_secure_password
DB_NAME=cipherbeam

# Security
SESSION_SECRET=your_random_secret_key_here

# SMTP (for emails)
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=your_app_password
SMTP_FROM_EMAIL=your_email@gmail.com
```

### Step 4: Create Database

#### Option A: Using SQL Script (Recommended)

```bash
mysql -h localhost -u root -p < schema.sql
```

#### Option B: Using Fix Database Script

```bash
node fix-db.js
```

### Step 5: Start the Server

```bash
# Development
npm run dev

# Production
npm start
```

The server will start on `http://localhost:3000`

---

## 🔧 Configuration Guide

### Database Setup

#### Default Configuration
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=cipherbeam
```

#### Creating Database Manually

If you prefer to set up manually:

```bash
# 1. Connect to MySQL
mysql -u root -p

# 2. Create database and user
CREATE DATABASE cipherbeam;
CREATE USER 'beamly_user'@'localhost' IDENTIFIED BY 'strong_password';
GRANT ALL PRIVILEGES ON cipherbeam.* TO 'beamly_user'@'localhost';
FLUSH PRIVILEGES;

# 3. Exit and import schema
exit

# 4. Import the schema
mysql -u beamly_user -p cipherbeam < schema.sql
```

### Email Configuration

#### Gmail Setup (Recommended)

1. Enable 2-Factor Authentication on your Google Account
2. Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
3. Generate an app-specific password
4. Add to `.env`:

```env
SMTP_USER=your_email@gmail.com
SMTP_PASSWORD=xxxx_xxxx_xxxx_xxxx  # Generated app password
SMTP_FROM_EMAIL=your_email@gmail.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
```

#### Alternative: Outlook / SendGrid

**Outlook:**
```env
SMTP_HOST=smtp.outlook.com
SMTP_PORT=587
SMTP_USER=your_email@outlook.com
SMTP_PASSWORD=your_password
```

**SendGrid:**
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_USER=apikey
SMTP_PASSWORD=your_sendgrid_api_key
```

### Security Configuration

Generate a secure session secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to `.env`:
```env
SESSION_SECRET=your_generated_secret_here
```

---

## 📁 Project Structure

```
beamly/
├── public/                      # Frontend files
│   ├── index.html              # Landing page
│   ├── auth.html               # Login/Signup page
│   ├── dashboard.html          # User dashboard
│   ├── vault.html              # Encrypted vault
│   ├── sender.html             # Send files page
│   ├── receiver.html           # Receive files page
│   ├── css/
│   │   └── style.css           # Styling
│   └── js/
│       ├── auth.js             # Authentication logic
│       ├── crypto.js           # Client-side encryption
│       ├── dashboard.js        # Dashboard logic
│       ├── sender.js           # Sender logic
│       ├── receiver.js         # Receiver logic
│       └── vault.js            # Vault management
│
├── uploads/                     # Encrypted file storage
│
├── server.js                   # Main server file
├── db.js                       # Database connection & queries
├── schema.sql                  # Database schema
├── fix-db.js                   # Database setup/reset script
│
├── .env.example                # Configuration template
├── .gitignore                  # Git ignore rules
├── package.json                # Dependencies
├── README.md                   # This file
└── LICENSE                     # MIT License
```

---

## 🔐 Database Schema Overview

### 10 Core Tables

1. **transfers** - P2P transfer sessions
2. **users** - User accounts & authentication
3. **login_history** - Login attempts & tracking
4. **transfer_history** - Sent/received files log
5. **cloud_files** - Encrypted vault storage
6. **file_access_logs** - File access audit trail
7. **file_shares** - Share permissions & expiry
8. **user_settings** - User preferences
9. **password_reset_tokens** - Password reset links
10. **sessions** - Express session store

---

## 🚦 Usage Guide

### For Users

#### 1. Sign Up
- Create account with email
- Verify email with OTP
- Set secure password

#### 2. Send Files (P2P)
- Go to "Send Files"
- Upload file (encrypted locally)
- Share link with recipient
- Link expires after configured time

#### 3. Receive Files
- Share your receive link
- Files stream directly to your computer
- No storage on server

#### 4. Use Vault
- Upload to "Cloud Vault" for persistent storage
- Store up to 5GB (configurable)
- Access anytime with your password

#### 5. View Activity
- Dashboard shows transfer history
- Access logs show all file views
- Login history shows security info

---

## 🛠️ API Endpoints

### Authentication
```
POST   /api/auth/signup          - Create new account
POST   /api/auth/verify-otp      - Verify OTP
POST   /api/auth/login           - Login
POST   /api/auth/logout          - Logout
POST   /api/auth/reset-password  - Request password reset
```

### File Transfers
```
POST   /api/transfer/create      - Create transfer session
POST   /api/transfer/upload      - Upload file chunks
GET    /api/transfer/:id         - Get transfer metadata
```

### Vault
```
POST   /api/vault/upload         - Upload to vault
GET    /api/vault/files          - List vault files
DELETE /api/vault/files/:id      - Delete vault file
```

### User
```
GET    /api/user/me              - Get current user
GET    /api/user/usage           - Get storage usage
GET    /api/user/login-history   - Get login logs
```

---

## 🧪 Testing

### Manual Testing
1. Open browser to `http://localhost:3000`
2. Create test accounts
3. Test P2P transfers
4. Test vault uploads
5. Check audit logs

### Database Testing
```bash
# View users
SELECT * FROM users;

# View transfer history
SELECT * FROM transfer_history;

# View login history
SELECT * FROM login_history;
```

---

## 🔒 Security Best Practices

### Deployment
- [ ] Change all `.env` secrets in production
- [ ] Use environment-specific configurations
- [ ] Enable HTTPS/SSL certificates
- [ ] Implement rate limiting
- [ ] Use strong database passwords
- [ ] Enable MySQL user permissions properly
- [ ] Regular security audits
- [ ] Keep dependencies updated

### Database
- [ ] Use strong passwords
- [ ] Restrict MySQL access to localhost only
- [ ] Regular backups
- [ ] Monitor access logs
- [ ] Use connection pooling

### Application
- [ ] Keep Node.js updated
- [ ] Run vulnerability scans: `npm audit`
- [ ] Implement CSRF protection
- [ ] Enable CORS properly
- [ ] Sanitize all inputs

---

## 📦 Dependencies

```json
{
  "bcrypt": "^6.0.0",
  "cors": "^2.8.5",
  "dotenv": "^16.4.7",
  "express": "^4.21.2",
  "express-mysql-session": "^3.0.3",
  "express-session": "^1.19.0",
  "multer": "^2.1.1",
  "mysql2": "^3.12.0",
  "nanoid": "^5.1.7",
  "nodemailer": "^8.0.7",
  "uuid": "^11.1.0",
  "ws": "^8.18.0",
  "xss-clean": "^0.1.4"
}
```

---

## 🐛 Troubleshooting

### Database Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:3306
```
**Solution:** Ensure MySQL is running
```bash
# macOS
brew services start mysql

# Windows (Command Prompt as Admin)
net start MySQL80

# Linux
sudo systemctl start mysql
```

### SMTP Error
```
Error: Invalid login: 535-5.7.8 Username and password not accepted
```
**Solution:** Check credentials in `.env`:
- Gmail: Use app password (not regular password)
- Verify email account settings
- Enable "Less secure apps" if using Gmail

### Port Already in Use
```
Error: listen EADDRINUSE :::3000
```
**Solution:** Change PORT in `.env` or kill process:
```bash
# Find process on port 3000
lsof -i :3000

# Kill it
kill -9 <PID>
```

### Permission Denied (uploads folder)
```
Error: EACCES: permission denied, mkdir './uploads'
```
**Solution:** Create uploads folder manually:
```bash
mkdir -p uploads
chmod 755 uploads
```

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

---

## 📞 Support

For issues, feature requests, or questions:
- Open an [Issue](https://github.com/yourusername/beamly/issues)
- Check [Documentation](docs/)
- Review [Architecture](BEAMLY_PRESENTATION.md)

---

## 🎯 Roadmap

- [ ] Two-Factor Authentication (2FA)
- [ ] File versioning & recovery
- [ ] Team/Organization support
- [ ] Advanced sharing permissions
- [ ] Compression before encryption
- [ ] Mobile app (React Native)
- [ ] Desktop app (Electron)
- [ ] End-to-end encrypted messaging
- [ ] Zero-knowledge backup system
- [ ] Decentralized storage integration

---

## 📊 Project Statistics

- **Frontend:** HTML5, CSS3, Vanilla JavaScript
- **Backend:** Node.js + Express
- **Database:** MySQL 8.0+
- **Encryption:** AES-256-CBC
- **Real-time:** WebSocket
- **Security:** Bcrypt, CORS, XSS-Clean

---

**Made with ❤️ by Beamly Team**

*Privacy is not optional. Security is not negotiable.*

---

### Quick Links
- 📖 [API Documentation](docs/)
- 🏗️ [Architecture](BEAMLY_PRESENTATION.md)
- 🔐 [Security Policy](docs/SECURITY.md)
- 🚀 [Deployment Guide](docs/DEPLOYMENT.md)
