/**
 * One-step setup: creates the tables from schema.sql and loads the demo data.
 * Uses the MYSQL_* values in .env (or the environment).   Run: npm run setup
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { connectionOptions } = require('../../backend/config/connection');
const { seed } = require('./seed');

/** Creates (or recreates) every table in MYSQL_DATABASE. Existing data in those tables is dropped. */
async function createSchema() {
  const database = process.env.MYSQL_DATABASE || 'library_app';
  if (!/^\w+$/.test(database)) throw new Error(`MYSQL_DATABASE "${database}" may only contain letters, digits and _`);
  const conn = await mysql.createConnection(connectionOptions({ database: undefined, multipleStatements: true }));
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/\blibrary_app\b/g, database);
    await conn.query(sql);
  } finally {
    await conn.end();
  }
  console.log(`Schema created in database "${database}".`);
}

if (require.main === module) {
  createSchema()
    .then(seed)
    .catch((err) => {
      if (err.code === 'ER_ACCESS_DENIED_ERROR') console.error('MySQL refused the login — check MYSQL_USER / MYSQL_PASSWORD in .env.');
      else if (err.code === 'ECONNREFUSED') console.error('Cannot reach MySQL — is the MySQL service running, and are MYSQL_HOST / MYSQL_PORT right?');
      else console.error('Setup failed:', err.message);
      process.exit(1);
    });
}

module.exports = { createSchema };
