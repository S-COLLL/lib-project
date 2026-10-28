const { tx } = require('../config/db');
const L = require('./lib');

/**
 * Marks overdue loans, sends due-soon/overdue notices, expires memberships and lapsed
 * reservations (passing the copy to the next in the queue). Runs hourly and before the dashboard.
 */
async function runMaintenance() {
  await tx(async (c) => {
    const s = await L.getSettings(c);
    const today = L.startOfDay(new Date());

    const [overdue] = await c.query(
      `SELECT l.loan_id, l.member_id, l.due_date, l.transaction_id, l.overdue_notified, b.title, m.name
       FROM loans l JOIN books b ON b.book_id = l.book_id JOIN members m ON m.member_id = l.member_id
       WHERE l.status = 'Issued' AND l.due_date < ? FOR UPDATE`,
      [today]
    );
    for (const i of overdue) {
      await c.query(`UPDATE loans SET status = 'Overdue', overdue_notified = 1 WHERE loan_id = ?`, [i.loan_id]);
      if (!i.overdue_notified) {
        await L.notify(c, {
          audience: 'member',
          memberId: i.member_id,
          type: 'overdue',
          title: 'Book overdue',
          message: `"${i.title}" was due on ${new Date(i.due_date).toDateString()}. A fine of ${L.money(s.finePerDay)}/day applies.`,
          link: 'issues.html',
        });
        await L.notify(c, { type: 'overdue', title: 'Book overdue', message: `${i.name} has not returned "${i.title}" (${i.transaction_id}).`, link: 'returns.html' });
      }
    }

    const [dueSoon] = await c.query(
      `SELECT l.loan_id, l.member_id, l.due_date, b.title FROM loans l JOIN books b ON b.book_id = l.book_id
       WHERE l.status = 'Issued' AND l.due_soon_notified = 0 AND l.due_date >= ? AND l.due_date <= ?`,
      [today, L.addDays(today, s.dueSoonDays + 1)]
    );
    for (const i of dueSoon) {
      await c.query('UPDATE loans SET due_soon_notified = 1 WHERE loan_id = ?', [i.loan_id]);
      await L.notify(c, {
        audience: 'member',
        memberId: i.member_id,
        type: 'due-soon',
        title: 'Book due soon',
        message: `"${i.title}" is due on ${new Date(i.due_date).toDateString()}. Return or renew it to avoid fines.`,
        link: 'issues.html',
      });
    }

    const [expiring] = await c.query(`SELECT member_id FROM members WHERE status = 'Active' AND membership_expiry < NOW()`);
    for (const m of expiring) {
      await c.query(`UPDATE members SET status = 'Expired', expiry_notified = 1 WHERE member_id = ?`, [m.member_id]);
      await L.notify(c, { audience: 'member', memberId: m.member_id, type: 'membership', title: 'Membership expired', message: 'Your library membership has expired. Renew it at the desk to keep borrowing.' });
    }

    const [lapsed] = await c.query(`SELECT reservation_id, book_id FROM reservations WHERE status IN ('Available','Waiting') AND expiry_date IS NOT NULL AND expiry_date < NOW() FOR UPDATE`);
    const touched = new Set();
    for (const r of lapsed) {
      await c.query(`UPDATE reservations SET status = 'Expired' WHERE reservation_id = ?`, [r.reservation_id]);
      touched.add(r.book_id);
    }
    for (const bookId of touched) await L.processReservationQueue(c, bookId, s);
  });
}

module.exports = { runMaintenance };
