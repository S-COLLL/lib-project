/**
 * One-step setup: creates the database from schema.sql and loads the demo data.
 * Uses the MYSQL_* values in .env.   Run: npm run setup
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { seed } = require('./seed');

async function main() {
  const database = process.env.MYSQL_DATABASE || 'library_app';
  if (!/^\w+$/.test(database)) throw new Error(`MYSQL_DATABASE "${database}" may only contain letters, digits and _`);
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8').replace(/\blibrary_app\b/g, database);
  await conn.query(sql);
  await conn.end();
  console.log(`Schema created in database "${database}".`);
  await seed();
}

main().catch((err) => {
  if (err.code === 'ER_ACCESS_DENIED_ERROR') console.error('MySQL refused the login — check MYSQL_USER / MYSQL_PASSWORD in .env.');
  else if (err.code === 'ECONNREFUSED') console.error('Cannot reach MySQL — is the MySQL service running, and are MYSQL_HOST / MYSQL_PORT right?');
  else console.error('Setup failed:', err.message);
  process.exit(1);
});
