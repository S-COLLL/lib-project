import {
  initPage, api, h, icon, badge, toast, toastError, openModal, confirmDialog, bookCover, emptyState, errorState, hasRole, isStaff,
  qp, occupancyClass, occupancyBlocks, skeletonRows, validateForm, formData, applyServerErrors, withLoading,
} from './app.js';
import { openShelfQr, openMoveBook } from './shared.js';

const user = await initPage('shelves');
const canEdit = hasRole('admin', 'librarian');
const staff = isStaff(user);
const $ = (id) => document.getElementById(id);

let shelves = [];
let categories = [];
let floor = null;
let selected = qp('shelf');

$('entrance').innerHTML = `${icon('door')} Main entrance · stairs & lift`;
if (canEdit) {
  $('pageActions').innerHTML = `<button class="btn btn-primary" id="addShelf">${icon('plus')}Add shelf</button>`;
  $('addShelf').addEventListener('click', () => shelfForm());
}

async function load() {
  $('shelfTable').innerHTML = skeletonRows(12, 5);
  try {
    const [s, c] = await Promise.all([api.get('/shelves'), api.get('/categories')]);
    shelves = s.data;
    categories = c.data;
    const floors = [...new Set(shelves.map((x) => x.floor))].sort((a, b) => a - b);
    const sel = shelves.find((x) => x.shelfId === String(selected || '').toUpperCase() || x.code === String(selected || '').toUpperCase().replace(/^SH-/, ''));
    if (floor === null || !floors.includes(floor)) floor = sel ? sel.floor : floors[0];
    $('floorTabs').innerHTML = floors
      .map((f) => `<button class="tab ${f === floor ? 'active' : ''}" data-floor="${f}">Floor ${f}<span class="count">${shelves.filter((x) => x.floor === f).length}</span></button>`)
      .join('');
    renderMap();
    renderTable();
    if (sel) selectShelf(sel.shelfId, false);
    else if (!$('shelfPanel').innerHTML) $('shelfPanel').innerHTML = `<div class="sp-anim">${emptyState('Select a shelf', 'Click a shelf on the map to view its details and books.', 'shelf')}</div>`;
  } catch (e) {
    $('floorPlan').innerHTML = errorState(e.message);
  }
}

$('floorTabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-floor]');
  if (!t) return;
  floor = Number(t.dataset.floor);
  $('floorTabs').querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  renderMap();
});

function renderMap() {
  const onFloor = shelves.filter((s) => s.floor === floor);
  const sections = [];
  onFloor.forEach((s) => {
    let sec = sections.find((x) => x.name === s.section);
    if (!sec) sections.push((sec = { name: s.section, shelves: [] }));
    sec.shelves.push(s);
  });
  $('floorPlan').innerHTML = sections.length
    ? sections
        .map(
          (sec, i) => `<div class="section-block reveal" style="--i:${i}"><h3><span>${h(sec.name)}</span><span>${sec.shelves.length} ${sec.shelves.length > 1 ? 'shelves' : 'shelf'}</span></h3>
          <div class="shelf-tiles">${sec.shelves
            .map(
              (s) => `<button class="shelf-tile ${occupancyClass(s.occupancyPercent)} ${s.status !== 'Active' ? 'maint' : ''} ${s.shelfId === selected ? 'selected' : ''}" data-shelf="${s.shelfId}" style="--pct:${s.occupancyPercent}" aria-label="${h(s.name)}, ${s.occupancyPercent}% full">
              <span class="st-status"></span><div class="st-code">${h(s.code)}</div><div class="small muted">${h(s.name)}</div>
              <div class="st-blocks occ-blocks">${occupancyBlocks(s.occupancyPercent)}</div><div class="st-pct">${s.occupancyPercent}%</div></button>`
            )
            .join('')}</div></div>`
        )
        .join('')
    : emptyState('No shelves on this floor');
}

$('floorPlan').addEventListener('click', (e) => {
  const t = e.target.closest('[data-shelf]');
  if (t) selectShelf(t.dataset.shelf);
});

async function selectShelf(shelfId, updateUrl = true) {
  selected = shelfId;
  document.querySelectorAll('.shelf-tile').forEach((t) => t.classList.toggle('selected', t.dataset.shelf === shelfId));
  if (updateUrl) history.replaceState(null, '', `?shelf=${shelfId}`);
  const panel = $('shelfPanel');
  panel.innerHTML = '<div style="padding:20px"><div class="skeleton sk-title"></div><div class="skeleton sk-block" style="margin-top:14px"></div></div>';
  try {
    const { data: s, books } = await api.get(`/shelves/${shelfId}`);
    const occ = occupancyClass(s.occupancyPercent);
    panel.innerHTML = `<div class="sp-anim ${occ}">
      <div class="sp-head">
        <div class="row-between"><div><span class="tag mono">${s.shelfId}</span> ${badge(s.status)}</div>
          <div class="row" style="gap:4px"><button class="btn btn-sm btn-icon btn-ghost" id="spQr" title="Shelf QR code" aria-label="Shelf QR code">${icon('qr')}</button>
          ${canEdit ? `<button class="btn btn-sm btn-icon btn-ghost" id="spEdit" title="Edit shelf" aria-label="Edit shelf">${icon('edit')}</button>` : ''}</div></div>
        <h2 style="font-size:22px;margin-top:10px">${h(s.name)}</h2>
        <div class="muted small">Floor ${s.floor} · ${h(s.section)} Section · ${s.category ? `${h(s.category.name)}` : 'No category'} · ${s.racks} racks × ${s.rowsPerRack} rows</div>
        <div class="row" style="margin-top:14px;align-items:flex-end;gap:14px"><div class="sp-big">${s.occupancyPercent}%</div><div class="occ-blocks" style="font-size:15px;margin-bottom:4px">${occupancyBlocks(s.occupancyPercent)}</div></div>
        <div class="progress" style="margin-top:10px"><span style="width:0" data-w="${s.occupancyPercent}"></span></div>
        <div class="sp-stats"><div><small>Capacity</small><strong>${s.capacity}</strong></div><div><small>Occupied</small><strong>${s.occupied}</strong></div><div><small>Available</small><strong>${s.availableSpace}</strong></div></div>
      </div>
      <div class="row-between" style="padding:14px 20px 6px"><h3>Books stored <span class="muted small">(${books.length} titles)</span></h3><a class="small" href="books.html?search=shelf ${s.code}">Open in catalogue</a></div>
      ${books.length ? books.map((b, i) => `<div class="sp-book" style="--i:${i}">${bookCover(b, 'cover-xs')}<div style="flex:1;min-width:0"><a href="book-details.html?id=${b.bookId}" style="font-weight:600;color:var(--text);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h(b.title)}</a><div class="small muted">${b.availableCopies}/${b.quantity} available</div></div>
        <span class="pos" title="Rack · Row · Position">R${h(b.location.rack)}·${h(b.location.row)}·${h(b.location.position)}</span>${staff ? `<button class="btn btn-sm btn-icon btn-ghost" data-move="${b.bookId}" title="Move book" aria-label="Move ${h(b.title)}">${icon('move')}</button>` : ''}</div>`).join('') : `<div style="padding:0 20px 20px">${emptyState('Empty shelf', 'No books are stored here yet.', 'book')}</div>`}
    </div>`;
    requestAnimationFrame(() => panel.querySelector('[data-w]') && (panel.querySelector('[data-w]').style.width = `${Math.min(100, s.occupancyPercent)}%`));
    panel.querySelector('#spQr').onclick = () => openShelfQr(s);
    panel.querySelector('#spEdit')?.addEventListener('click', () => shelfForm(s));
    panel.querySelectorAll('[data-move]').forEach((b) =>
      b.addEventListener('click', () => {
        const book = books.find((x) => x.bookId === b.dataset.move);
        openMoveBook(book, () => load().then(() => selectShelf(shelfId, false)));
      })
    );
    if (window.innerWidth < 1100 && updateUrl) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    panel.innerHTML = `<div style="padding:20px">${errorState(e.message)}</div>`;
  }
}

function renderTable() {
  $('shelfTable').innerHTML = shelves.length
    ? shelves
        .map(
          (s, i) => `<tr style="--i:${i}" class="${occupancyClass(s.occupancyPercent)}"><td class="mono">${s.shelfId}</td><td class="t-title nowrap">${h(s.name)}</td><td>${s.floor}</td><td>${h(s.section)}</td><td>${s.racks}</td><td>${h(s.category?.name || '—')}</td>
          <td>${s.capacity}</td><td>${s.occupied}</td><td>${s.availableSpace}</td>
          <td><div class="row" style="gap:8px"><div class="progress" style="flex:1"><span style="width:${Math.min(100, s.occupancyPercent)}%"></span></div><strong class="small" style="color:var(--occ);min-width:34px">${s.occupancyPercent}%</strong></div></td>
          <td>${badge(s.status)}</td>
          <td><div class="actions"><button class="btn btn-sm btn-icon btn-ghost" data-view="${s.shelfId}" title="Show on map" aria-label="Show ${h(s.name)} on map">${icon('mapPin')}</button>
          ${canEdit ? `<button class="btn btn-sm btn-icon btn-ghost" data-edit="${s.shelfId}" title="Edit" aria-label="Edit ${h(s.name)}">${icon('edit')}</button><button class="btn btn-sm btn-icon btn-ghost" data-del="${s.shelfId}" title="Delete" aria-label="Delete ${h(s.name)}">${icon('trash')}</button>` : ''}</div></td></tr>`
        )
        .join('')
    : `<tr><td colspan="12">${emptyState('No shelves yet')}</td></tr>`;
}

$('shelfTable').addEventListener('click', async (e) => {
  const v = e.target.closest('[data-view]');
  const ed = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (v) {
    const s = shelves.find((x) => x.shelfId === v.dataset.view);
    floor = s.floor;
    $('floorTabs').querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', Number(x.dataset.floor) === floor));
    renderMap();
    selectShelf(s.shelfId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (ed) shelfForm(shelves.find((x) => x.shelfId === ed.dataset.edit));
  if (del) {
    const s = shelves.find((x) => x.shelfId === del.dataset.del);
    if (!(await confirmDialog({ title: `Delete ${h(s.name)}?`, message: 'Only empty shelves can be deleted.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.del(`/shelves/${s.shelfId}`);
      toast(`${s.name} deleted`);
      if (selected === s.shelfId) {
        selected = null;
        $('shelfPanel').innerHTML = '';
      }
      load();
    } catch (err) {
      toastError(err);
    }
  }
});

function shelfForm(s = null) {
  const m = openModal({
    title: s ? `Edit ${s.name}` : 'Add shelf',
    body: `<form id="shelfForm" novalidate class="form-grid">
      <div class="field"><label>Shelf code <span class="req">*</span></label><input class="input" name="code" required maxlength="3" pattern="[A-Za-z]{1,3}" title="1–3 letters" value="${h(s?.code || '')}" placeholder="Q"></div>
      <div class="field"><label>Shelf name</label><input class="input" name="name" value="${h(s?.name || '')}" placeholder="Shelf Q"></div>
      <div class="field"><label>Floor <span class="req">*</span></label><input class="input" type="number" name="floor" min="0" max="20" required value="${s?.floor ?? 1}"></div>
      <div class="field"><label>Section <span class="req">*</span></label><input class="input" name="section" required value="${h(s?.section || '')}" list="secList" placeholder="Fiction"><datalist id="secList">${[...new Set(shelves.map((x) => x.section))].map((x) => `<option value="${h(x)}">`).join('')}</datalist></div>
      <div class="field"><label>Racks</label><input class="input" type="number" name="racks" min="1" max="50" value="${s?.racks ?? 4}"></div>
      <div class="field"><label>Rows per rack</label><input class="input" type="number" name="rowsPerRack" min="1" max="26" value="${s?.rowsPerRack ?? 4}"></div>
      <div class="field"><label>Capacity (books) <span class="req">*</span></label><input class="input" type="number" name="capacity" min="1" required value="${s?.capacity ?? 30}"></div>
      <div class="field"><label>Status</label><select class="select" name="status">${['Active', 'Maintenance', 'Closed'].map((x) => `<option ${s?.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="field full"><label>Category</label><select class="select" name="category"><option value="">None</option>${categories.map((c) => `<option value="${c._id}" ${String(s?.category?._id) === String(c._id) ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</select></div>
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="shelfSave">${icon('check')}Save shelf</button>`,
  });
  const form = m.el.querySelector('#shelfForm');
  const btn = m.el.querySelector('#shelfSave');
  btn.onclick = async () => {
    if (!validateForm(form, (d) => (s && Number(d.capacity) < s.occupied ? { capacity: `At least ${s.occupied} (books currently stored)` } : {}))) return;
    const d = formData(form);
    d.code = d.code.toUpperCase();
    if (!d.name) delete d.name;
    await withLoading(btn, async () => {
      try {
        const res = s ? await api.put(`/shelves/${s.shelfId}`, d) : await api.post('/shelves', d);
        toast(`${res.data.name} saved`);
        m.close();
        selected = res.data.shelfId;
        floor = res.data.floor;
        load();
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
}

load();
