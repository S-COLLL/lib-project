require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { pool, checkSchema } = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { runMaintenance } = require('./utils/maintenance');

if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
// Behind a hosting proxy (Render) set TRUST_PROXY=1 so rate limiting sees the real client address.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
// The UI loads Chart.js/jsPDF from cdnjs, fonts from Google and covers from Open Library,
// and uses inline handlers, so Helmet's default CSP is turned off; the other headers stay on.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 2000, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', mode: 'mysql' }));

// Serverless (Vercel) has no always-on process for the hourly timer, so the first API
// request each hour (per instance) runs the maintenance job instead.
if (process.env.VERCEL) {
  let lastMaintenance = 0;
  app.use('/api', async (_req, _res, next) => {
    if (Date.now() - lastMaintenance > 60 * 60 * 1000) {
      lastMaintenance = Date.now();
      await runMaintenance().catch((e) => console.error('Maintenance failed:', e.message));
    }
    next();
  });
}

for (const name of ['auth', 'books', 'authors', 'categories', 'shelves', 'members', 'issues', 'returns', 'reservations', 'fines', 'payments', 'notifications', 'settings', 'reports', 'ai']) {
  app.use(`/api/${name}`, require(`./routes/${name}`));
}
app.use('/api', notFound);

const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND, { extensions: ['html'] }));
app.get('*', (req, res) => res.redirect('/index.html'));

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3000;

async function start() {
  const autoSeed = process.env.AUTO_SEED === 'true';
  try {
    await checkSchema();
  } catch (err) {
    if (err.code === 'NO_SCHEMA' && autoSeed) {
      // First start on a fresh (cloud) database: build the tables and load the demo library.
      console.log('AUTO_SEED: no tables yet, creating schema and demo data…');
      await require('../database/mysql/setup').createSchema();
      await require('../database/mysql/seed').seed();
    } else {
      if (err.code === 'ER_ACCESS_DENIED_ERROR') {
        console.error(`MySQL refused the login for "${process.env.MYSQL_USER || 'root'}". Put your MySQL password in .env (MYSQL_PASSWORD=...), save the file, then run npm start again.`);
      } else if (err.code === 'ECONNREFUSED') {
        console.error('Cannot reach MySQL. Is the MySQL service running? Check MYSQL_HOST / MYSQL_PORT in .env.');
      } else {
        console.error(err.message);
      }
      process.exit(1);
    }
  }
  if (autoSeed) {
    const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM users');
    if (n === 0) {
      console.log('AUTO_SEED: database is empty, loading demo data…');
      await require('../database/mysql/seed').seed();
    }
  }
  await runMaintenance().catch((e) => console.error('Maintenance failed:', e.message));
  setInterval(() => runMaintenance().catch((e) => console.error('Maintenance failed:', e.message)), 60 * 60 * 1000);
  app.listen(PORT, () => console.log(`Library app running on http://localhost:${PORT}`));
}

if (require.main === module) start();

module.exports = app;
