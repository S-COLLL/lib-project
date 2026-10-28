const fs = require('fs');

/**
 * TLS settings for cloud MySQL (Aiven, etc.). MYSQL_SSL_CA may hold the CA certificate itself
 * (PEM text, "\n" escapes allowed) or a path to the .pem file. MYSQL_SSL=true uses the system CAs.
 */
function sslOptions() {
  const ca = process.env.MYSQL_SSL_CA;
  if (ca) {
    const pem = ca.includes('-----BEGIN') ? ca.replace(/\\n/g, '\n') : fs.readFileSync(ca, 'utf8');
    return { ca: pem, rejectUnauthorized: true };
  }
  if (process.env.MYSQL_SSL === 'true') return { rejectUnauthorized: true };
  return undefined;
}

/** Connection settings from the MYSQL_* environment variables. */
function connectionOptions(extra = {}) {
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'library_app',
    charset: 'utf8mb4',
    ssl: sslOptions(),
    ...extra,
  };
}

module.exports = { connectionOptions };
