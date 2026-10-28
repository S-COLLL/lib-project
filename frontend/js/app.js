// SmartLib core: layout shell, auth guard, theme, UI helpers.
import { api, session, ApiError, DEMO_MODE, resetDemoData } from './api.js';
import { icon } from './icons.js';
import { LANG, LOCALE, LANGS, setLang } from './i18n.js';

export { api, session, ApiError, icon, DEMO_MODE, LANG, LOCALE, LANGS, setLang };

export const STAFF = ['admin', 'librarian', 'staff'];
export const isStaff = (u = session.user) => !!u && STAFF.includes(u.role);
export const hasRole = (...roles) => !!session.user && roles.includes(session.user.role);

/* =============================== Formatting =============================== */

export const h = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// Money is shown in Hungarian forint. The helper keeps SmartLib's name so every page uses it unchanged.
export const CURRENCY = 'Ft';
export const inr = (n, digits = 0) =>
  `${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: 2 })} ${CURRENCY}`;
export const num = (n) => Number(n || 0).toLocaleString('en-US');
export const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d) =>
  d ? new Date(d).toLocaleString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const isoDate = (d) => {
  const x = d ? new Date(d) : new Date();
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export function relTime(d) {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return LANG === 'hu' ? 'épp most' : 'just now';
  // [unit, seconds per unit, use this unit while abs < limit]
  const units = [
    ['minute', 60, 3600],
    ['hour', 3600, 86400],
    ['day', 86400, 604800],
    ['week', 604800, 2629800],
    ['month', 2629800, 31557600],
    ['year', 31557600, Infinity],
  ];
  const [unit, secs] = units.find(([, , limit]) => abs < limit);
  return new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' }).format(-Math.round(diff / secs), unit);
}
export const daysUntil = (d) => Math.ceil((new Date(d).setHours(23, 59, 0, 0) - Date.now()) / 86400000);
export const initials = (name = '') =>
  name
    .replace(/^(dr|mr|mrs|ms)\.?\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');
export const slug = (s = '') => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-');
export const qp = (name) => new URLSearchParams(location.search).get(name);

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ============================ Small components ============================ */

export const badge = (status, extra = '') => `<span class="badge badge-${slug(status)} ${extra}">${h(status)}</span>`;

const AVATAR_BG = ['#0f766e', '#334155', '#1e3a8a', '#115e59', '#475569', '#0e7490', '#3730a3'];
export function avatar(name, photo, size = '') {
  if (photo) return `<span class="avatar ${size}"><img src="${h(photo)}" alt="" loading="lazy"></span>`;
  const bg = AVATAR_BG[[...String(name)].reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_BG.length];
  return `<span class="avatar ${size}" style="background:${bg}" aria-hidden="true">${h(initials(name) || '?')}</span>`;
}

export const emptyState = (title, text = '', ic = 'inbox', action = '') =>
  `<div class="empty"><div class="e-icon">${icon(ic)}</div><h3>${h(title)}</h3><p class="small">${h(text)}</p>${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;

export const errorState = (msg) =>
  `<div class="error-state"><div class="row">${icon('alert')}<span>${h(msg)}</span></div><button class="btn btn-sm" onclick="location.reload()">${icon('refresh')}Retry</button></div>`;

export const skeletonRows = (cols, rows = 6) =>
  Array.from(
    { length: rows },
    () => `<tr>${Array.from({ length: cols }, (_, i) => `<td><div class="skeleton sk-line" style="width:${i === 1 ? 80 : 40 + ((i * 17) % 50)}%"></div></td>`).join('')}</tr>`
  ).join('');

export const skeletonCards = (n = 4, height = 120) =>
  Array.from({ length: n }, () => `<div class="card card-pad"><div class="skeleton sk-title"></div><div class="skeleton sk-line" style="width:70%"></div><div class="skeleton" style="height:${height - 50}px;margin-top:12px"></div></div>`).join('');

export function animateCounter(el, target, { duration = 1100, format = num } = {}) {
  const start = performance.now();
  const from = 0;
  const step = (t) => {
    const p = Math.min(1, (t - start) / duration);
    const eased = 1 - Math.pow(1 - p, 4);
    el.textContent = format(Math.round(from + (target - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function occupancyClass(pct) {
  if (pct >= 100) return 'occ-full';
  if (pct >= 80) return 'occ-high';
  if (pct >= 50) return 'occ-med';
  return 'occ-low';
}
export const occupancyBlocks = (pct) => {
  const n = Math.max(0, Math.min(10, Math.round(pct / 10)));
  return `${'█'.repeat(n)}${'░'.repeat(10 - n)}`;
};

export function renderPagination(el, { page, pages, total, limit }, onChange) {
  if (!el) return;
  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(total, page * limit);
  const nums = [];
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  el.innerHTML = `<span class="small muted">Showing <strong>${from}–${to}</strong> of <strong>${num(total)}</strong></span>
    <div class="pages">
      <button class="page-btn" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft', 'sr-icon')}</button>
      ${nums.map((p) => (p === '…' ? '<span class="page-btn" style="border:0;cursor:default">…</span>' : `<button class="page-btn ${p === page ? 'active' : ''}" data-p="${p}">${p}</button>`)).join('')}
      <button class="page-btn" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="Next page">${icon('chevronRight')}</button>
    </div>`;
  el.querySelectorAll('button[data-p]').forEach((b) =>
    b.addEventListener('click', () => {
      if (!b.disabled) onChange(Number(b.dataset.p));
    })
  );
  el.querySelectorAll('svg').forEach((s) => {
    s.style.width = '15px';
    s.style.height = '15px';
  });
}

const scriptCache = {};
export function loadScript(src) {
  if (!scriptCache[src]) {
    scriptCache[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }
  return scriptCache[src];
}
export const LIBS = {
  chart: 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  qrcode: 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  barcode: 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  autotable: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js',
  scanner: 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js',
};

/* ================================= Toasts ================================= */

function toastStack() {
  let el = document.querySelector('.toast-stack');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast-stack';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  return el;
}
export function toast(message, type = 'success', title) {
  const icons = { success: 'checkCircle', error: 'alert', info: 'info', warning: 'alert' };
  const titles = { success: 'Success', error: 'Something went wrong', info: 'Notice', warning: 'Heads up' };
  const duration = type === 'error' ? 6000 : 3800;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<div class="t-icon">${icon(icons[type])}</div><div style="flex:1;min-width:0"><strong>${h(title || titles[type])}</strong><p>${h(message)}</p></div>
    <button class="icon-btn" style="width:26px;height:26px;color:var(--text-2)" aria-label="Dismiss">${icon('x')}</button><span class="t-bar" style="animation-duration:${duration}ms"></span>`;
  const close = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  el.querySelector('button').onclick = close;
  toastStack().appendChild(el);
  setTimeout(close, duration);
}
export const toastError = (err) => toast(err?.message || String(err), 'error');

/* ================================= Modals ================================= */

/**
 * openModal({ title, subtitle, body, footer, size, onOpen }) → { el, close }
 * body/footer are HTML strings. Buttons with [data-close] close the modal.
 */
export function openModal({ title, subtitle = '', body = '', footer = '', size = '', onOpen, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${h(title)}">
    <div class="modal-head"><div><h2>${h(title)}</h2>${subtitle ? `<div class="mh-sub">${subtitle}</div>` : ''}</div>
      <button class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => {
      wrap.remove();
      if (!document.querySelector('.modal-backdrop')) document.body.style.overflow = '';
      prevFocus?.focus?.();
      onClose?.();
    }, 240);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && document.querySelector('.modal-backdrop:last-of-type') === wrap) close();
  };
  wrap.addEventListener('mousedown', (e) => {
    if (e.target === wrap) close();
  });
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const modal = { el: wrap, close, body: wrap.querySelector('.modal-body') };
  setTimeout(() => wrap.querySelector('input:not([type=hidden]):not([readonly]),select,textarea')?.focus(), 60);
  onOpen?.(modal);
  return modal;
}

export function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal({
      title,
      size: 'modal-sm',
      body: `<p class="muted">${message}</p>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${h(confirmText)}</button>`,
      onClose: () => !answered && resolve(false),
    });
    m.el.querySelector('[data-ok]').onclick = () => {
      answered = true;
      resolve(true);
      m.close();
    };
  });
}

export function printModal(modal) {
  document.body.classList.add('printing-modal');
  const done = () => {
    document.body.classList.remove('printing-modal');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1500);
  return modal;
}

/* ================================== Forms ================================= */

export function formData(form) {
  const out = {};
  new FormData(form).forEach((v, k) => {
    out[k] = typeof v === 'string' ? v.trim() : v;
  });
  form.querySelectorAll('input[type=checkbox][name]').forEach((c) => {
    out[c.name] = c.checked;
  });
  return out;
}

export function clearErrors(form) {
  form.querySelectorAll('.field.invalid').forEach((f) => f.classList.remove('invalid'));
  form.querySelectorAll('.field-error').forEach((e) => e.remove());
}
export function setFieldError(form, name, msg) {
  const input = form.querySelector(`[name="${name}"]`);
  const field = input?.closest('.field');
  if (!field) return false;
  field.classList.add('invalid');
  const e = document.createElement('div');
  e.className = 'field-error';
  e.textContent = msg;
  field.appendChild(e);
  return true;
}
/** Client-side validation driven by HTML attributes (required, min, max, pattern, type=email). */
export function validateForm(form, extra = () => ({})) {
  clearErrors(form);
  const errors = {};
  form.querySelectorAll('input[name],select[name],textarea[name]').forEach((el) => {
    if (el.disabled || el.type === 'hidden' || el.type === 'checkbox') return;
    const v = el.value.trim();
    const label = el.closest('.field')?.querySelector('label')?.textContent.replace('*', '').trim() || el.name;
    if (el.required && !v) errors[el.name] = `${label} is required`;
    else if (v && el.type === 'email' && !/^\S+@\S+\.\S+$/.test(v)) errors[el.name] = 'Enter a valid email address';
    else if (v && el.type === 'number' && el.min !== '' && Number(v) < Number(el.min)) errors[el.name] = `${label} must be at least ${el.min}`;
    else if (v && el.type === 'number' && el.max !== '' && Number(v) > Number(el.max)) errors[el.name] = `${label} must be at most ${el.max}`;
    else if (v && el.pattern && !new RegExp(`^(?:${el.pattern})$`).test(v)) errors[el.name] = el.title || `${label} is invalid`;
    else if (v && el.minLength > 0 && v.length < el.minLength) errors[el.name] = `${label} must be at least ${el.minLength} characters`;
  });
  Object.assign(errors, extra(formData(form)) || {});
  Object.entries(errors).forEach(([k, m]) => setFieldError(form, k, m));
  const first = form.querySelector('.field.invalid input, .field.invalid select, .field.invalid textarea');
  if (first) {
    first.focus();
    first.closest('.field').animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(5px)' }, { transform: 'translateX(0)' }], { duration: 260 });
  }
  return Object.keys(errors).length === 0;
}
/** Show server-side validation details on the form. */
export function applyServerErrors(form, err) {
  let shown = false;
  if (err?.details) Object.entries(err.details).forEach(([k, m]) => (shown = setFieldError(form, k, m) || shown));
  if (!shown) toastError(err);
}

export async function withLoading(btn, fn) {
  btn?.classList.add('loading');
  if (btn) btn.disabled = true;
  try {
    return await fn();
  } finally {
    btn?.classList.remove('loading');
    if (btn) btn.disabled = false;
  }
}

/** Resize an uploaded image to a small data URL (stored directly in the database). */
export function imageToDataUrl(file, max = 360) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file'));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Could not read image'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/* ================================== Theme ================================= */

export function setTheme(theme, originEl) {
  const apply = () => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('smartlib-theme', theme);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
  };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (document.startViewTransition && !reduce && originEl) {
    const r = originEl.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = document.startViewTransition(apply);
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' }
      );
    });
  } else {
    document.documentElement.classList.add('theme-transition');
    apply();
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 450);
  }
}
export const currentTheme = () => document.documentElement.getAttribute('data-theme') || 'light';

/* ================================= Layout ================================= */

const NAV = [
  { group: 'Overview' },
  { key: 'dashboard', label: 'Dashboard', icon: 'home', href: 'dashboard.html' },
  { group: 'Catalogue' },
  { key: 'books', label: 'Books', icon: 'book', href: 'books.html' },
  { key: 'authors', label: 'Authors', icon: 'pen', href: 'authors.html' },
  { key: 'categories', label: 'Categories', icon: 'folder', href: 'categories.html' },
  { key: 'shelves', label: 'Shelves', icon: 'shelf', href: 'shelves.html' },
  { group: 'Circulation' },
  { key: 'members', label: 'Members', icon: 'users', href: 'members.html', staff: true },
  { key: 'issues', label: 'Issue Books', studentLabel: 'My Loans', icon: 'bookOpen', href: 'issues.html' },
  { key: 'returns', label: 'Return Books', icon: 'undo', href: 'returns.html', staff: true },
  { key: 'reservations', label: 'Reservations', icon: 'bookmark', href: 'reservations.html' },
  { group: 'Finance' },
  { key: 'fines', label: 'Fines', icon: 'rupee', href: 'fines.html' },
  { key: 'payments', label: 'Payments', icon: 'card', href: 'payments.html' },
  { key: 'reports', label: 'Reports', icon: 'chart', href: 'reports.html', staff: true },
  { group: 'Smart Tools' },
  { key: 'ai', label: 'AI Assistant', icon: 'sparkles', href: 'ai-assistant.html' },
  { key: 'notifications', label: 'Notifications', icon: 'bell', href: 'notifications.html' },
  { key: 'settings', label: 'Settings', icon: 'settings', href: 'settings.html' },
];

const brandSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5"/><path d="M9 7h6M9 11h4"/><path d="m16 13 1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor"/></svg>`;
export const BRAND_SVG = brandSvg;

function buildSidebar(active, user) {
  const staff = isStaff(user);
  const items = NAV.filter((n) => n.group || !n.staff || staff);
  // Drop empty groups
  const cleaned = items.filter((n, i) => !n.group || (items[i + 1] && !items[i + 1].group));
  let idx = 0;
  const links = cleaned
    .map((n) => {
      if (n.group) return `<div class="nav-group-label">${n.group}</div>`;
      idx += 1;
      const label = !staff && n.studentLabel ? n.studentLabel : n.label;
      return `<a class="nav-link ${n.key === active ? 'active' : ''}" href="${n.href}" style="animation-delay:${idx * 22}ms" title="${label}" ${n.key === active ? 'aria-current="page"' : ''}>
        ${icon(n.icon)}<span>${label}</span>${n.key === 'notifications' ? '<em class="nav-badge hidden" data-nav-unread></em>' : ''}</a>`;
    })
    .join('');
  return `<aside class="sidebar" id="sidebar" aria-label="Main navigation">
    <a class="sidebar-brand" href="dashboard.html"><span class="brand-mark">${brandSvg}</span>
      <span class="brand-text"><strong>Smart<span>Lib</span></strong><small>AI Library System</small></span></a>
    <nav class="sidebar-nav">${links}</nav>
    <div class="sidebar-foot"><button class="sidebar-collapse" id="collapseBtn">${icon('chevronLeft')}<span>Collapse sidebar</span></button></div>
  </aside><div class="overlay" id="overlay"></div>`;
}

function buildTopbar(user) {
  return `<header class="topbar">
    <button class="icon-btn menu-toggle" id="menuBtn" aria-label="Open menu">${icon('menu')}</button>
    <div class="global-search" id="globalSearch">
      ${icon('search')}
      <input type="search" id="globalSearchInput" placeholder="Search books, authors, ISBN, members…" autocomplete="off" aria-label="Global search">
      <kbd>Ctrl K</kbd>
      <div class="search-results hidden" id="globalSearchResults"></div>
    </div>
    <div class="topbar-actions">
      ${DEMO_MODE ? '<span class="demo-chip hide-sm" title="Running entirely in your browser — data is saved only on this device">Demo</span>' : ''}
      <button class="icon-btn" id="scanBtn" title="Scan QR / barcode" aria-label="Scan QR code">${icon('scan')}</button>
      <div class="dropdown" id="notifDropdown">
        <button class="icon-btn" id="notifBtn" aria-label="Notifications">${icon('bell')}<span class="badge-dot hidden" id="notifCount"></span></button>
        <div class="dropdown-menu notif-panel" id="notifPanel">
          <div class="np-head"><strong>Notifications</strong><button class="link-btn small" id="markAllBtn">Mark all read</button></div>
          <div class="np-list" id="notifList"></div>
          <a class="np-foot" href="notifications.html">View all notifications</a>
        </div>
      </div>
      <button class="icon-btn theme-toggle" id="themeBtn" aria-label="Toggle dark mode" title="Toggle theme">${icon('sun', 'sun')}${icon('moon', 'moon')}</button>
      <div class="dropdown" id="profileDropdown">
        <button class="profile-btn" id="profileBtn" aria-label="Profile menu">${avatar(user.name, user.avatar, 'avatar-sm')}
          <span class="pb-text hide-sm"><strong>${h(user.name)}</strong><small>${h(user.role)}</small></span></button>
        <div class="dropdown-menu">
          <div class="dm-head"><strong>${h(user.name)}</strong><div class="small muted">${h(user.email)}</div>
            ${user.member ? `<div class="small muted">Member ID: <span class="mono">${h(user.member.memberId || '')}</span></div>` : ''}</div>
          ${user.member ? `<a class="dropdown-item" href="members.html?id=${h(user.member.memberId || '')}">${icon('user')}My membership</a>` : ''}
          <a class="dropdown-item" href="settings.html">${icon('settings')}Settings</a>
          <a class="dropdown-item" href="notifications.html">${icon('bell')}Notifications</a>
          ${DEMO_MODE ? `<button class="dropdown-item" id="resetDemoBtn">${icon('refresh')}Reset demo data</button>` : ''}
          <button class="dropdown-item danger" id="logoutBtn">${icon('logout')}Sign out</button>
        </div>
      </div>
    </div>
  </header>`;
}

function setupDropdowns() {
  document.querySelectorAll('.dropdown').forEach((dd) => {
    const trigger = dd.querySelector('button');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dd.classList.contains('open');
      document.querySelectorAll('.dropdown.open').forEach((d) => d.classList.remove('open'));
      if (!open) {
        dd.classList.add('open');
        dd.dispatchEvent(new CustomEvent('open'));
      }
    });
    dd.querySelector('.dropdown-menu').addEventListener('click', (e) => e.stopPropagation());
  });
  document.addEventListener('click', () => document.querySelectorAll('.dropdown.open').forEach((d) => d.classList.remove('open')));
}

/* ---------------------------- Notifications ---------------------------- */

export const NOTIF_TONE = {
  issued: ['bookOpen', 'tone-blue'],
  'due-soon': ['clock', 'tone-orange'],
  overdue: ['alert', 'tone-red'],
  fine: ['rupee', 'tone-orange'],
  payment: ['card', 'tone-green'],
  reservation: ['bookmark', 'tone-gold'],
  membership: ['user', 'tone-purple'],
  'new-book': ['book', 'tone-teal'],
  returned: ['undo', 'tone-teal'],
  system: ['info', 'tone-navy'],
};
export function notifItem(n, i = 0) {
  const [ic, tone] = NOTIF_TONE[n.type] || NOTIF_TONE.system;
  return `<div class="notif-item ${n.read ? '' : 'unread'}" data-id="${n._id}" data-link="${h(n.link || '')}" style="--i:${i}" role="button" tabindex="0">
    <div class="notif-icon ${tone}">${icon(ic)}</div>
    <div style="min-width:0"><div class="n-title">${h(n.title)}</div><div class="n-msg">${h(n.message)}</div><div class="n-time">${relTime(n.createdAt)}</div></div></div>`;
}

let lastUnread = null;
export async function refreshUnread() {
  try {
    const { unread } = await api.get('/notifications/unread-count');
    const dot = document.getElementById('notifCount');
    const nav = document.querySelector('[data-nav-unread]');
    if (dot) {
      dot.textContent = unread > 99 ? '99+' : unread;
      dot.classList.toggle('hidden', !unread);
      if (lastUnread !== null && unread > lastUnread) {
        dot.classList.remove('pulse');
        void dot.offsetWidth;
        dot.classList.add('pulse');
        toast('You have a new notification', 'info', 'Notifications');
      }
    }
    if (nav) {
      nav.textContent = unread;
      nav.classList.toggle('hidden', !unread);
    }
    lastUnread = unread;
  } catch {
    /* offline: ignore */
  }
}

async function loadNotifPanel() {
  const list = document.getElementById('notifList');
  list.innerHTML = Array.from({ length: 3 }, () => '<div style="padding:14px 16px"><div class="skeleton sk-line" style="width:60%"></div><div class="skeleton sk-line"></div></div>').join('');
  try {
    const { data } = await api.get('/notifications', { limit: 8 });
    list.innerHTML = data.length ? data.map(notifItem).join('') : emptyState('All caught up', 'No notifications yet', 'bell');
  } catch (e) {
    list.innerHTML = `<div style="padding:16px">${errorState(e.message)}</div>`;
  }
}

export function bindNotifClicks(container, after) {
  container.addEventListener('click', async (e) => {
    const item = e.target.closest('.notif-item');
    if (!item) return;
    if (item.classList.contains('unread')) {
      item.classList.remove('unread');
      api.patch(`/notifications/${item.dataset.id}/read`).then(refreshUnread).catch(() => {});
    }
    after?.(item);
    if (item.dataset.link) setTimeout(() => navigate(item.dataset.link), 120);
  });
}

/* ----------------------------- Global search ----------------------------- */

export function coverThumb(book, size = 'cover-sm') {
  return bookCover(book, size);
}

function setupGlobalSearch(user) {
  const input = document.getElementById('globalSearchInput');
  const box = document.getElementById('globalSearchResults');
  let focusIdx = -1;
  const hide = () => box.classList.add('hidden');
  const run = debounce(async (q) => {
    if (q.length < 2) return hide();
    box.classList.remove('hidden');
    box.innerHTML = '<div class="search-empty"><div class="skeleton sk-line" style="width:70%;margin:auto"></div></div>';
    try {
      const [books, members] = await Promise.all([
        api.get('/books', { search: q, limit: 6 }),
        isStaff(user) ? api.get('/members', { search: q, limit: 4 }) : Promise.resolve({ data: [] }),
      ]);
      let html = '';
      if (books.data.length) {
        html += `<div class="sr-group">Books · ${books.pagination.total}</div>`;
        html += books.data
          .map(
            (b) => `<a class="search-item" href="book-details.html?id=${b.bookId}">${bookCover(b, 'cover-xs')}
            <div style="min-width:0;flex:1"><div class="t-title" style="font-weight:600">${h(b.title)}</div>
            <div class="si-meta">${h(b.authorName)} · ${h(b.categoryName)} · <span class="gold-text">F${b.location?.floor} · Shelf ${h(b.location?.shelfCode)} · R${h(b.location?.rack)}</span></div></div>${badge(b.availableCopies > 0 ? 'Available' : b.status)}</a>`
          )
          .join('');
      }
      if (members.data.length) {
        html += '<div class="sr-group">Members</div>';
        html += members.data
          .map((m) => `<a class="search-item" href="members.html?id=${m.memberId}">${avatar(m.name, m.profilePhoto, 'avatar-sm')}<div style="flex:1"><div style="font-weight:600">${h(m.name)}</div><div class="si-meta">${m.memberId} · ${h(m.department)}</div></div>${badge(m.status)}</a>`)
          .join('');
      }
      html += `<a class="search-item" href="books.html?search=${encodeURIComponent(q)}" style="color:var(--accent-text);font-weight:500">${icon('search')} See all results for “${h(q)}”</a>`;
      if (!books.data.length && !members.data.length) html = `<div class="search-empty">No matches for “${h(q)}”. Try the <a href="ai-assistant.html?q=${encodeURIComponent(q)}">AI Assistant</a>.</div>`;
      box.innerHTML = html;
      focusIdx = -1;
      box.querySelectorAll('svg').forEach((s) => {
        s.style.width = '16px';
      });
    } catch (e) {
      box.innerHTML = `<div class="search-empty">${h(e.message)}</div>`;
    }
  }, 220);
  input.addEventListener('input', () => run(input.value.trim()));
  input.addEventListener('focus', () => input.value.trim().length >= 2 && box.classList.remove('hidden'));
  input.addEventListener('keydown', (e) => {
    const items = [...box.querySelectorAll('.search-item')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusIdx = (focusIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((it, i) => it.classList.toggle('focused', i === focusIdx));
    } else if (e.key === 'Enter') {
      const q = input.value.trim();
      if (!q) return;
      api.post('/auth/search-history', { term: q }).catch(() => {});
      navigate(focusIdx >= 0 && items[focusIdx] ? items[focusIdx].getAttribute('href') : `books.html?search=${encodeURIComponent(q)}`);
    } else if (e.key === 'Escape') {
      hide();
      input.blur();
    }
  });
  box.addEventListener('click', (e) => {
    if (e.target.closest('a') && input.value.trim()) api.post('/auth/search-history', { term: input.value.trim() }).catch(() => {});
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#globalSearch')) hide();
  });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    } else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      e.preventDefault();
      input.focus();
    }
  });
}

/* ------------------------------ QR scanner ------------------------------ */

export function routeForCode(raw) {
  const text = String(raw || '').trim();
  try {
    const u = new URL(text);
    const file = u.pathname.split('/').pop();
    if (['book-details.html', 'shelves.html', 'members.html'].includes(file)) return `${file}${u.search}`;
  } catch {
    /* not a URL */
  }
  if (/^BK\d+$/i.test(text)) return `book-details.html?id=${text.toUpperCase()}`;
  if (/^(97[89])?\d{9}[\dX]$/i.test(text.replace(/-/g, ''))) return `book-details.html?id=${text.replace(/-/g, '')}`;
  if (/^SH-[A-Z]{1,3}$/i.test(text)) return `shelves.html?shelf=${text.toUpperCase()}`;
  if (/^MEM\d+$/i.test(text)) return `members.html?id=${text.toUpperCase()}`;
  return null;
}

export function openScanner() {
  let scanner = null;
  const m = openModal({
    title: 'Scan QR / Barcode',
    subtitle: 'Scan a book or shelf QR code, or type a Book ID, ISBN or Shelf ID.',
    body: `<div id="qrReader" class="scan-reader"><div class="empty" style="color:#94a3b8">${icon('camera')}<p class="small">Starting camera…</p></div></div>
      <div class="divider"></div>
      <form id="manualCode" class="row"><div class="input-group" style="flex:1">${icon('barcode')}<input class="input" name="code" placeholder="BK0001 · 9780062315007 · SH-A" aria-label="Code"></div>
      <button class="btn btn-primary">Open</button></form>`,
    onClose: () => scanner?.stop().catch(() => {}),
  });
  const go = (code) => {
    const route = routeForCode(code);
    if (!route) return toast(`Unrecognised code: ${code}`, 'warning');
    m.close();
    navigate(route);
  };
  m.el.querySelector('#manualCode').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.code.value.trim();
    if (v) go(v);
  });
  loadScript(LIBS.scanner)
    .then(() => {
      if (!document.body.contains(m.el)) return;
      scanner = new window.Html5Qrcode('qrReader');
      return scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 230, height: 230 } }, (decoded) => {
        scanner.stop().catch(() => {});
        go(decoded);
      });
    })
    .catch(() => {
      const el = m.el.querySelector('#qrReader');
      if (el) el.innerHTML = `<div class="empty" style="color:#94a3b8">${icon('camera')}<h3 style="color:#e2e8f0">Camera unavailable</h3><p class="small">Allow camera access (HTTPS or localhost) or enter the code below.</p></div>`;
    });
}

/* ---------------------------- Page transitions ---------------------------- */

export function navigate(href) {
  const page = document.querySelector('.page');
  if (!page || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    location.href = href;
    return;
  }
  page.classList.add('leaving');
  setTimeout(() => {
    location.href = href;
  }, 170);
}

function setupPageTransitions() {
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:') || !href.includes('.html')) return;
    e.preventDefault();
    navigate(href);
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) document.querySelector('.page')?.classList.remove('leaving');
  });
}

/* --------------------------------- Init --------------------------------- */

/**
 * initPage(key, { staffOnly }) — renders the shell around <main class="page">,
 * enforces authentication and returns the current user.
 */
export async function initPage(key, { staffOnly = false, roles = null } = {}) {
  if (!session.token) {
    location.replace(`index.html?next=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`);
    return new Promise(() => {});
  }
  let user = session.user;
  if (!user) {
    try {
      user = (await api.get('/auth/me')).user;
      session.setUser(user);
    } catch {
      return new Promise(() => {});
    }
  }
  if ((staffOnly && !isStaff(user)) || (roles && !roles.includes(user.role))) {
    location.replace('dashboard.html?denied=1');
    return new Promise(() => {});
  }

  const main = document.querySelector('main.page');
  const shell = document.createElement('div');
  shell.className = 'shell';
  shell.innerHTML = `${buildSidebar(key, user)}<div class="main">${buildTopbar(user)}</div>`;
  document.body.prepend(shell);
  shell.querySelector('.main').appendChild(main);

  // Sidebar collapse / mobile
  const body = document.body;
  document.getElementById('collapseBtn').addEventListener('click', () => {
    body.classList.toggle('sidebar-collapsed');
    try {
      localStorage.setItem('smartlib-sidebar', body.classList.contains('sidebar-collapsed') ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event('resize'));
  });
  document.getElementById('menuBtn').addEventListener('click', () => body.classList.toggle('sidebar-open'));
  document.getElementById('overlay').addEventListener('click', () => body.classList.remove('sidebar-open'));

  document.getElementById('themeBtn').addEventListener('click', (e) => setTheme(currentTheme() === 'dark' ? 'light' : 'dark', e.currentTarget));
  document.getElementById('logoutBtn').addEventListener('click', () => {
    session.clear();
    navigate('index.html?loggedout=1');
  });
  document.getElementById('scanBtn').addEventListener('click', openScanner);
  document.getElementById('resetDemoBtn')?.addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Reset demo data?', message: 'All changes you made in this browser are discarded and the original demo library is restored.', confirmText: 'Reset', danger: true }))) return;
    await resetDemoData();
    session.clear();
    location.href = 'index.html?reset=1';
  });

  setupDropdowns();
  document.getElementById('notifDropdown').addEventListener('open', loadNotifPanel);
  bindNotifClicks(document.getElementById('notifList'));
  document.getElementById('markAllBtn').addEventListener('click', async () => {
    await api.patch('/notifications/read-all').catch(toastError);
    document.querySelectorAll('#notifList .notif-item.unread').forEach((n) => n.classList.remove('unread'));
    refreshUnread();
  });
  setupGlobalSearch(user);
  setupPageTransitions();

  refreshUnread();
  setInterval(refreshUnread, 60000);
  // Refresh the cached user in the background (role/membership changes)
  api
    .get('/auth/me')
    .then(({ user: fresh }) => session.setUser(fresh))
    .catch(() => {});

  if (qp('denied')) toast('You do not have permission to open that page.', 'warning');
  return user;
}

/* ============================ Book cover helper ============================ */

const COVER_BG = [
  'linear-gradient(145deg,#0f172a,#0f766e)',
  'linear-gradient(145deg,#1e293b,#334155)',
  'linear-gradient(145deg,#134e4a,#0f766e)',
  'linear-gradient(145deg,#0f172a,#1e3a8a)',
  'linear-gradient(145deg,#3f2d0c,#a16207)',
  'linear-gradient(145deg,#1e1b4b,#3730a3)',
  'linear-gradient(145deg,#422006,#0f172a)',
];

/**
 * Book cover: uploaded image → Open Library cover by ISBN → generated typographic cover.
 */
export function bookCover(book, size = 'cover-md') {
  const seed = [...String(book.title || '')].reduce((s, c) => s + c.charCodeAt(0), 0);
  const fallback = `<div class="cover-fallback" style="--cover-bg:${COVER_BG[seed % COVER_BG.length]}"><div><div class="cf-title">${h(book.title)}</div><div class="cf-rule"></div></div><div class="cf-author">${h(book.authorName || '')}</div></div>`;
  const src = book.coverImage || (book.isbn ? `https://covers.openlibrary.org/b/isbn/${book.isbn}-${size === 'cover-lg' ? 'L' : 'M'}.jpg?default=false` : '');
  const img = src ? `<img src="${h(src)}" alt="Cover of ${h(book.title)}" loading="lazy" onload="if(this.naturalWidth<10){this.remove()}else{this.previousElementSibling&&this.previousElementSibling.remove()}" onerror="this.remove()">` : '';
  return `<div class="cover ${size}">${fallback}${img}</div>`;
}

export function locationInline(loc) {
  if (!loc?.shelfCode) return '<span class="muted small">No location</span>';
  return `<span class="loc-inline">${icon('mapPin')}F${loc.floor} · ${h(loc.shelfCode)} · R${h(loc.rack)} · ${h(loc.row)}${h(loc.position)}</span>`;
}
