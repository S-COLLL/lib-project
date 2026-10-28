const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT) || 3306,
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'library_app',
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true,
  charset: 'utf8mb4',
});

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
    throw new Error(`Database '${process.env.MYSQL_DATABASE || 'library_app'}' has no tables. Import database/mysql/schema.sql first.`);
  }
}

module.exports = { pool, tx, checkSchema };
