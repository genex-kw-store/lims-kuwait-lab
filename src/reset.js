// reset.js - wipe database and re-seed master data (fresh start)
const fs = require('fs');
const path = require('path');
const { DB_PATH } = require('./db');
for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) { try { fs.unlinkSync(f); } catch {} }
const { db } = require('./db');
const { seed } = require('./seed');
seed(db);
console.log('Database reset and seeded. Default logins restored (admin/Admin@123 ...).');
