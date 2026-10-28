import { initPage, api, h, icon, toast, toastError, skeletonRows, emptyState, errorState, loadScript, LIBS, fmtDateTime, qp, withLoading } from './app.js';

await initPage('reports', { staffOnly: true });
const $ = (id) => document.getElementById(id);

const REPORTS = [
  ['books', 'Books Report', 'Full catalogue with stock & location', 'book', 'tone-navy', false],
  ['issued', 'Issued Books', 'Books currently with members', 'bookOpen', 'tone-blue', true],
  ['returned', 'Returned Books', 'Check-ins with late days & fines', 'undo', 'tone-teal', true],
  ['overdue', 'Overdue Report', 'Late loans and accruing fines', 'alert', 'tone-red', false],
  ['fines', 'Fine Report', 'Charges, discounts & balances', 'rupee', 'tone-orange', true],
  ['payments', 'Payment Report', 'All payments and receipts', 'card', 'tone-green', true],
  ['members', 'Member Report', 'Memberships, loans & dues', 'users', 'tone-purple', false],
  ['popular', 'Popular Books', 'Top 25 most borrowed titles', 'trending', 'tone-gold', false],
  ['shelves', 'Shelf Occupancy', 'Capacity used on every shelf', 'shelf', 'tone-teal', false],
];
let current = null;
let report = null;

$('printBtn').innerHTML = `${icon('printer')}Print`;
$('csvBtn').innerHTML = `${icon('download')}CSV`;
$('pdfBtn').innerHTML = `${icon('file')}PDF`;
$('reportGrid').innerHTML = REPORTS.map(([k, t, d, ic, tone], i) => `<button class="report-card reveal ${tone}" style="--i:${i}" data-r="${k}"><span class="rc-icon">${icon(ic)}</span><strong>${t}</strong><small>${d}</small></button>`).join('');
$('reportGrid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-r]');
  if (c) select(c.dataset.r);
});
['from', 'to'].forEach((k) => $(k).addEventListener('change', () => current && select(current)));

async function select(key) {
  current = key;
  const meta = REPORTS.find((r) => r[0] === key);
  history.replaceState(null, '', `?type=${key}`);
  document.querySelectorAll('.report-card').forEach((c) => c.classList.toggle('active', c.dataset.r === key));
  $('from').disabled = $('to').disabled = !meta[5];
  $('reportTitle').textContent = meta[1];
  $('reportMeta').textContent = 'Loading…';
  $('reportTable').innerHTML = `<table class="table"><tbody>${skeletonRows(8, 8)}</tbody></table>`;
  try {
    const { data } = await api.get(`/reports/${key}`, meta[5] ? { from: $('from').value, to: $('to').value } : {});
    report = data;
    const range = meta[5] && ($('from').value || $('to').value) ? ` · ${$('from').value || '…'} to ${$('to').value || 'today'}` : '';
    $('reportMeta').textContent = `${data.rows.length} rows · generated ${fmtDateTime(data.generatedAt)}${range}`;
    $('printTitle').textContent = `SmartLib — ${data.title}`;
    $('printMeta').textContent = $('reportMeta').textContent;
    $('reportTable').innerHTML = data.rows.length
      ? `<table class="table"><thead><tr>${data.columns.map((c) => `<th>${h(c)}</th>`).join('')}</tr></thead><tbody>${data.rows
          .map((r, i) => `<tr style="--i:${Math.min(i, 20)}">${r.map((v) => `<td>${h(v ?? '')}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      : emptyState('No data for this report', 'Try a different date range.', 'chart');
  } catch (e) {
    $('reportTable').innerHTML = errorState(e.message);
  }
}

const need = () => {
  if (!report) {
    toast('Select a report first', 'warning');
    return false;
  }
  return true;
};

$('printBtn').addEventListener('click', () => need() && window.print());

$('csvBtn').addEventListener('click', () => {
  if (!need()) return;
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [report.columns.map(esc).join(','), ...report.rows.map((r) => r.map(esc).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `smartlib-${report.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('CSV downloaded');
});

$('pdfBtn').addEventListener('click', (e) => {
  if (!need()) return;
  withLoading(e.currentTarget, async () => {
    try {
      await loadScript(LIBS.jspdf);
      await loadScript(LIBS.autotable);
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: report.columns.length > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, W, 64, 'F');
      doc.setFillColor(212, 167, 44);
      doc.rect(0, 64, W, 3, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.text('SmartLib', 36, 30);
      doc.setFontSize(11);
      doc.text(report.title, 36, 48);
      doc.setFontSize(9);
      doc.text(`Generated ${new Date(report.generatedAt).toLocaleString('en-IN')} · ${report.rows.length} rows`, W - 36, 48, { align: 'right' });
      // jsPDF's built-in fonts (WinAnsi) lack ₹ and ő/ű — use "Rs." and ö/ü so amounts and Hungarian titles stay readable
      const clean = (v) => String(v ?? '').replace(/₹/g, 'Rs.').replace(/ő/g, 'ö').replace(/Ő/g, 'Ö').replace(/ű/g, 'ü').replace(/Ű/g, 'Ü');
      doc.autoTable({
        startY: 82,
        head: [report.columns.map(clean)],
        body: report.rows.map((r) => r.map(clean)),
        styles: { fontSize: 8, cellPadding: 5, lineColor: [226, 232, 240], lineWidth: 0.5 },
        headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 36, right: 36 },
        didDrawPage: () => {
          doc.setFontSize(8);
          doc.setTextColor(100, 116, 139);
          doc.text(`Page ${doc.internal.getNumberOfPages()}`, W - 36, doc.internal.pageSize.getHeight() - 18, { align: 'right' });
        },
      });
      doc.save(`smartlib-${report.key}-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast('PDF downloaded');
    } catch (err) {
      toastError(err);
    }
  });
});

$('reportTable').innerHTML = emptyState('Choose a report above', 'Reports are generated live from the MySQL database.', 'chart');
if (qp('type')) select(qp('type'));
