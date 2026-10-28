const mysql = require('mysql2/promise');
const { connectionOptions } = require('./connection');

// Serverless hosts (Vercel) run many small instances: keep each pool small (MYSQL_POOL_SIZE=3) and drop idle connections.
const pool = mysql.createPool(
  connectionOptions({
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_POOL_SIZE) || 10,
    maxIdle: Number(process.env.MYSQL_POOL_SIZE) || 10,
    idleTimeout: 60000,
    enableKeepAlive: true,
    decimalNumbers: true,
  })
);

/** Runs fn(connection) inside one InnoDB transaction; any thrown error rolls everything back. */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function checkSchema() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('users','books','loans','settings')`
  );
  if (rows[0].n < 4) {
    const err = new Error(`Database '${process.env.MYSQL_DATABASE || 'library_app'}' has no tables. Run "npm run setup" (or start with AUTO_SEED=true).`);
    err.code = 'NO_SCHEMA';
    throw err;
  }
}

module.exports = { pool, tx, checkSchema };
