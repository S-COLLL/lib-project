import { initPage, api, h, icon, toast, toastError, openModal, confirmDialog, emptyState, errorState, hasRole, validateForm, formData, applyServerErrors, withLoading, skeletonCards } from './app.js';

await initPage('categories');
const canEdit = hasRole('admin', 'librarian');
const $ = (id) => document.getElementById(id);
let cats = [];

if (canEdit) {
  $('pageActions').innerHTML = `<button class="btn btn-primary" id="add">${icon('plus')}Add category</button>`;
  $('add').addEventListener('click', () => catForm());
}

async function load() {
  $('grid').innerHTML = skeletonCards(8, 170);
  try {
    const { data } = await api.get('/categories');
    cats = data;
    $('grid').innerHTML = data.length
      ? data
          .map((c, i) => {
            const t = c.totalBooks || 1;
            return `<article class="card cat-card reveal" style="--i:${i}">
          <div class="row-between"><div class="row"><div class="cat-icon" aria-hidden="true">${h(c.icon || '📚')}</div><div><h3 style="font-size:16px">${h(c.name)}</h3><div class="small muted">${c.titles} title${c.titles === 1 ? '' : 's'} · ${h(c.categoryId)}</div></div></div>
          ${canEdit ? `<div class="row" style="gap:2px"><button class="btn btn-sm btn-icon btn-ghost" data-edit="${c.categoryId}" aria-label="Edit ${h(c.name)}">${icon('edit')}</button><button class="btn btn-sm btn-icon btn-ghost" data-del="${c.categoryId}" aria-label="Delete ${h(c.name)}">${icon('trash')}</button></div>` : ''}</div>
          <p class="small muted">${h(c.description || '')}</p>
          <div class="cat-nums"><div><small>Books</small><strong>${c.totalBooks}</strong></div><div><small>Available</small><strong class="text-success">${c.availableBooks}</strong></div><div><small>Issued</small><strong style="color:var(--info)">${c.issuedBooks}</strong></div></div>
          <div class="stack-bar" role="img" aria-label="${c.availableBooks} available, ${c.issuedBooks} issued, ${c.reservedBooks} reserved of ${c.totalBooks}">
            <span style="background:var(--success)" data-w="${(c.availableBooks / t) * 100}"></span><span style="background:var(--info)" data-w="${(c.issuedBooks / t) * 100}"></span><span style="background:var(--gold)" data-w="${(c.reservedBooks / t) * 100}"></span></div>
          ${c.subcategories?.length ? `<div class="row wrap" style="gap:6px">${c.subcategories.map((s) => `<span class="tag">${h(s)}</span>`).join('')}</div>` : ''}
          <a class="small" href="books.html?category=${encodeURIComponent(c.name)}" style="margin-top:auto">Browse ${h(c.name)} books →</a></article>`;
          })
          .join('')
      : `<div style="grid-column:1/-1">${emptyState('No categories')}</div>`;
    requestAnimationFrame(() => document.querySelectorAll('[data-w]').forEach((s) => (s.style.width = `${s.dataset.w}%`)));
  } catch (e) {
    $('grid').innerHTML = `<div style="grid-column:1/-1">${errorState(e.message)}</div>`;
  }
}

$('grid').addEventListener('click', async (e) => {
  const ed = e.target.closest('[data-edit]');
  const del = e.target.closest('[data-del]');
  if (ed) catForm(cats.find((c) => c.categoryId === ed.dataset.edit));
  if (del) {
    const c = cats.find((x) => x.categoryId === del.dataset.del);
    if (!(await confirmDialog({ title: `Delete ${h(c.name)}?`, message: 'Only categories without books can be deleted.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.del(`/categories/${c.categoryId}`);
      toast('Category deleted');
      load();
    } catch (err) {
      toastError(err);
    }
  }
});

function catForm(c = null) {
  const m = openModal({
    title: c ? `Edit ${c.name}` : 'Add category',
    body: `<form id="cF" novalidate class="form-grid">
      <div class="field"><label>Name <span class="req">*</span></label><input class="input" name="name" required minlength="2" maxlength="60" value="${h(c?.name || '')}"></div>
      <div class="field"><label>Icon (emoji)</label><input class="input" name="icon" maxlength="4" value="${h(c?.icon || '📚')}"></div>
      <div class="field full"><label>Description</label><textarea class="textarea" name="description" maxlength="500">${h(c?.description || '')}</textarea></div>
      <div class="field full"><label>Subcategories</label><input class="input" name="subcategories" value="${h((c?.subcategories || []).join(', '))}" placeholder="Comma separated"></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="cSave">${icon('check')}Save</button>`,
  });
  const form = m.el.querySelector('#cF');
  const btn = m.el.querySelector('#cSave');
  btn.onclick = async () => {
    if (!validateForm(form)) return;
    const d = formData(form);
    d.subcategories = d.subcategories.split(',').map((s) => s.trim()).filter(Boolean);
    await withLoading(btn, async () => {
      try {
        if (c) await api.put(`/categories/${c.categoryId}`, d);
        else await api.post('/categories', d);
        toast('Category saved');
        m.close();
        load();
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
}

load();
