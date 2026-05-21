// Run this script to fix the database: node fix-db.js
const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixDatabase() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'cipherbeam'
    });

    console.log('Connected to database...');

    try {
        // Drop all user data and start fresh
        console.log('Clearing all user data...');
        
        await connection.execute('SET FOREIGN_KEY_CHECKS = 0');
        await connection.execute('TRUNCATE TABLE audit_logs');
        await connection.execute('TRUNCATE TABLE starred_files');
        await connection.execute('TRUNCATE TABLE user_settings');
        await connection.execute('TRUNCATE TABLE password_reset_tokens');
        await connection.execute('TRUNCATE TABLE file_access_logs');
        await connection.execute('TRUNCATE TABLE cloud_files');
        await connection.execute('TRUNCATE TABLE transfer_history');
        await connection.execute('TRUNCATE TABLE login_history');
        await connection.execute('TRUNCATE TABLE transfers');
        await connection.execute('TRUNCATE TABLE users');
        await connection.execute('SET FOREIGN_KEY_CHECKS = 1');
        
        console.log('✅ All users and files deleted!');
        console.log('\n✅ Database is ready! Restart the server and create a new account.');

    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        await connection.end();
    }
}

fixDatabase();
