/**
 * One-time conversion of a database seeded in Ft to Indian rupees, keeping every record.
 * Everything is first converted at the old seed's rate (₹ = Ft ÷ 4) with the ₹10/day late-fine policy;
 * rows that came from the demo snapshot are then restored to their exact ₹ values by code.
 * The settings row currency = INR marks a database as done, so this runs at most once. The server
 * calls it on start (and on Vercel, on each instance's first request); it can also be run by hand.
 * Run: npm run convert:inr
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const path = require('path');
const { pathToFileURL } = require('url');
const mysql = require('mysql2/promise');
const { connectionOptions } = require('../../backend/config/connection');
const { HUNGARIAN } = require('./seed');

const FT_PER_RUPEE = 4;
const rupees = (ft) => Math.round(Number(ft) / FT_PER_RUPEE);
const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

/** Converts the database if it still holds Ft amounts. Returns a summary when it converted, otherwise null. */
async function convert() {
  const conn = await mysql.createConnection(connectionOptions());
  const q = (sql, params) => conn.query(sql, params);
  try {
    const [[marked]] = await q(`SELECT 1 FROM settings WHERE setting_key = 'currency' AND setting_value = 'INR'`);
    if (marked) return null;

    await conn.beginTransaction();
    // Lock existing rows first: a second server instance waits here, then sees the marker this one wrote.
    // (Locking the missing 'currency' key first would let both take the same gap lock and deadlock on insert.)
    const [rows] = await q(`SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('finePerDay', 'membershipFee') FOR UPDATE`);
    const [marker] = await q(`SELECT setting_key, setting_value FROM settings WHERE setting_key = 'currency' FOR UPDATE`);
    const cur = Object.fromEntries([...rows, ...marker].map((r) => [r.setting_key, r.setting_value]));
    const isFt = !cur.currency && Number(cur.finePerDay) === 500 && Number(cur.membershipFee) === 2000;
    if (!isFt) {
      if (!cur.currency) await q(`INSERT INTO settings (setting_key, setting_value) VALUES ('currency', 'INR')`);
      await conn.commit();
      return null;
    }

    const snapshotPath = path.join(__dirname, '..', '..', 'frontend', 'js', 'demo', 'demo-data.js');
    const data = (await import(pathToFileURL(snapshotPath).href)).default;
    const s = data.settings;
    // "500 Ft/day" → "₹10/day"; any other "1,234 Ft" → ₹ at the old rate
    const text = (v) =>
      String(v)
        .replace(/\d[\d,]* Ft\/day/g, `${money(s.finePerDay)}/day`)
        .replace(/(\d[\d,]*) Ft\b/g, (_, n) => money(rupees(n.replace(/,/g, ''))));

    // Books
    await q('UPDATE books SET price = ROUND(price / ?), purchase_price = ROUND(purchase_price / ?), current_value = ROUND(current_value / ?)', [FT_PER_RUPEE, FT_PER_RUPEE, FT_PER_RUPEE]);
    for (const b of data.books) {
      await q('UPDATE books SET price = ?, purchase_price = ?, current_value = ? WHERE book_code = ?', [b.price, b.purchasePrice || 0, b.currentValue || b.price, b.bookId]);
    }
    for (const h of HUNGARIAN) {
      await q('UPDATE books SET price = ?, purchase_price = ?, current_value = ? WHERE isbn = ?', [h.price, Math.round(h.price * 0.8), h.price, h.isbn]);
    }

    // Loans (charges recorded at return)
    await q(
      `UPDATE loans SET late_fine = days_overdue * ?, damage_charge = ROUND(damage_charge / ?), lost_charge = ROUND(lost_charge / ?)
       WHERE return_date IS NOT NULL`,
      [s.finePerDay, FT_PER_RUPEE, FT_PER_RUPEE]
    );
    for (const r of data.returns) {
      await q('UPDATE loans SET late_fine = ?, damage_charge = ?, lost_charge = ? WHERE transaction_id = ?', [r.lateFine, r.damageCharge, r.lostCharge, r.transactionId]);
    }
    await q('UPDATE loans SET fine_amount = late_fine + damage_charge + lost_charge WHERE return_date IS NOT NULL');

    // Fines: paid / discount / waived keep their share of the charge
    const snapFines = Object.fromEntries(data.fines.map((f) => [f.fineId, f]));
    const ratio = {};
    const [fines] = await q('SELECT fine_id, fine_code, type, description, days_overdue, original_amount, discount, paid_amount, waived_amount FROM fines');
    for (const f of fines) {
      const snap = snapFines[f.fine_code];
      const old = Number(f.original_amount);
      const amount = snap ? snap.originalAmount : f.type === 'Late Fine' ? f.days_overdue * s.finePerDay : rupees(old);
      const k = amount / old;
      ratio[f.fine_id] = k;
      const discount = snap ? snap.discount : Math.round(f.discount * k);
      const paid = snap ? snap.paidAmount : Math.round(f.paid_amount * k);
      const waived = snap ? snap.waivedAmount : Math.min(Math.round(f.waived_amount * k), amount - discount - paid);
      await q('UPDATE fines SET original_amount = ?, discount = ?, paid_amount = ?, waived_amount = ?, rate_per_day = ?, description = ? WHERE fine_id = ?', [
        amount, discount, paid, waived, f.type === 'Late Fine' ? s.finePerDay : 0, snap ? snap.description : text(f.description), f.fine_id,
      ]);
    }

    // Payments
    const snapPayments = Object.fromEntries(data.payments.map((p) => [p.paymentId, p]));
    const [payments] = await q('SELECT payment_id, payment_code, fine_id, amount, reason FROM fine_payments');
    for (const p of payments) {
      const snap = snapPayments[p.payment_code];
      const amount = snap ? snap.amount : Math.max(1, p.fine_id ? Math.round(p.amount * ratio[p.fine_id]) : rupees(p.amount));
      await q('UPDATE fine_payments SET amount = ?, reason = ? WHERE payment_id = ?', [amount, snap ? snap.reason : text(p.reason), p.payment_id]);
    }

    // Notifications: seeded ones (same id, type and title as the snapshot order) get their original text back
    const snapNotes = [...data.notifications].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const [notes] = await q(`SELECT notification_id, type, title, message FROM notifications WHERE message LIKE '%Ft%'`);
    for (const n of notes) {
      const snap = snapNotes[n.notification_id - 1];
      const message = snap && snap.type === n.type && snap.title === n.title ? snap.message : text(n.message);
      await q('UPDATE notifications SET message = ? WHERE notification_id = ?', [message, n.notification_id]);
    }

    // Settings: the ₹ policy
    for (const k of ['finePerDay', 'maxPendingFine', 'lostProcessingFee', 'membershipFee']) {
      await q('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [String(s[k]), k]);
    }
    await q(`INSERT INTO settings (setting_key, setting_value) VALUES ('currency', 'INR')`);

    await conn.commit();
    return `Converted Ft to ₹: ${fines.length} fines, ${payments.length} payments, ${notes.length} notifications; late fine now ${money(s.finePerDay)}/day.`;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  convert()
    .then((summary) => console.log(summary || 'Nothing to convert: this database is already in ₹.'))
    .catch((err) => {
      console.error('Conversion failed:', err.message);
      process.exit(1);
    });
}

module.exports = { convert };
