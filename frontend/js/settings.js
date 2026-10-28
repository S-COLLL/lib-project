import {
  initPage, api, session, h, icon, badge, avatar, toast, toastError, openModal, fmtDate, setTheme, currentTheme, hasRole, validateForm,
  formData, applyServerErrors, withLoading, imageToDataUrl, emptyState, errorState, relTime, LANG, LANGS, setLang,
} from './app.js';

const user = await initPage('settings');
const admin = hasRole('admin');
const $ = (id) => document.getElementById(id);

const NAV = [
  ['appearance', 'Appearance', 'sun'],
  ['profile', 'Profile', 'user'],
  ['security', 'Password', 'lock'],
  ['policy', 'Library policy', 'sliders'],
  ...(admin ? [['users', 'User accounts', 'shield']] : []),
];
$('snav').innerHTML = NAV.map(([k, l, ic]) => `<a href="#${k}">${icon(ic)}${l}</a>`).join('');

$('sections').innerHTML = `
  <section class="card card-pad reveal" id="appearance" style="--i:0">
    <h2>Appearance</h2><p class="muted small" style="margin:4px 0 16px">Choose light, dark or match your system. The switch animates smoothly.</p>
    <div class="theme-cards">
      <button class="theme-card tc-light" data-theme-choice="light"><div class="tc-prev"><span></span><span></span></div><strong>☀️ Light</strong></button>
      <button class="theme-card tc-dark" data-theme-choice="dark"><div class="tc-prev"><span></span><span></span></div><strong>🌙 Dark</strong></button>
      <button class="theme-card tc-system" data-theme-choice="system"><div class="tc-prev"><span></span><span></span></div><strong>💻 System</strong></button>
    </div>
    <div class="field" style="margin-top:18px;max-width:280px"><label for="langSelect">Language / Nyelv</label>
      <select class="select" id="langSelect">${Object.entries(LANGS).map(([k, l]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  </section>

  <section class="card card-pad reveal" id="profile" style="--i:1">
    <h2>Profile</h2><p class="muted small" style="margin:4px 0 16px">Signed in as <span class="badge badge-role plain">${h(user.role)}</span> · last login ${user.lastLogin ? relTime(user.lastLogin) : '—'}</p>
    <form id="profileForm" novalidate class="form-grid">
      <div class="full row" style="gap:16px"><div id="avPrev">${avatar(user.name, user.avatar, 'avatar-lg')}</div><label class="btn btn-sm">${icon('upload')}Change photo<input type="file" accept="image/*" id="avFile" hidden></label><input type="hidden" name="avatar" value="${h(user.avatar || '')}"></div>
      <div class="field"><label>Name <span class="req">*</span></label><input class="input" name="name" required minlength="2" value="${h(user.name)}"></div>
      <div class="field"><label>Email</label><input class="input" value="${h(user.email)}" readonly></div>
      ${user.member ? `<div class="field"><label>Member ID</label><input class="input mono" value="${h(user.member.memberId)}" readonly></div><div class="field"><label>Membership valid until</label><input class="input" value="${fmtDate(user.member.membershipExpiry)}" readonly></div>` : ''}
      <div class="full"><button class="btn btn-primary" id="profileSave">${icon('check')}Save profile</button></div>
    </form>
  </section>

  <section class="card card-pad reveal" id="security" style="--i:2">
    <h2>Change password</h2><p class="muted small" style="margin:4px 0 16px">Passwords are hashed with bcrypt before being stored.</p>
    <form id="pwForm" novalidate class="form-grid form-grid-3">
      <div class="field"><label>Current password <span class="req">*</span></label><input class="input" type="password" name="currentPassword" required autocomplete="current-password"></div>
      <div class="field"><label>New password <span class="req">*</span></label><input class="input" type="password" name="newPassword" required minlength="6" autocomplete="new-password"></div>
      <div class="field"><label>Confirm new password <span class="req">*</span></label><input class="input" type="password" name="confirm" required autocomplete="new-password"></div>
      <div class="full"><button class="btn btn-secondary" id="pwSave">${icon('lock')}Update password</button></div>
    </form>
  </section>

  <section class="card card-pad reveal" id="policy" style="--i:3">
    <h2>Library policy</h2><p class="muted small" style="margin:4px 0 16px">${admin ? 'These values drive fine calculation, loan periods and borrowing limits.' : 'Current rules (only administrators can change them).'}</p>
    <form id="policyForm" novalidate class="form-grid form-grid-3"><div class="skeleton sk-block full"></div></form>
  </section>

  ${admin ? `<section class="card reveal" id="users" style="--i:4">
    <div class="card-head"><div><h2>User accounts</h2><div class="ch-sub">Admins, librarians, staff and student logins</div></div><button class="btn btn-primary btn-sm" id="addUser">${icon('plus')}Add user</button></div>
    <div class="card-body"><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Member</th><th>Last login</th><th>Status</th><th></th></tr></thead><tbody id="userRows"></tbody></table></div></div>
  </section>` : ''}`;

/* Appearance */
const markTheme = () => {
  let pref = 'system';
  try {
    pref = localStorage.getItem('smartlib-theme') || 'system';
  } catch {
    /* ignore */
  }
  document.querySelectorAll('[data-theme-choice]').forEach((b) => b.classList.toggle('active', b.dataset.themeChoice === pref));
};
markTheme();
document.querySelectorAll('[data-theme-choice]').forEach((b) =>
  b.addEventListener('click', () => {
    const c = b.dataset.themeChoice;
    if (c === 'system') {
      const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      setTheme(sys, b);
      try {
        localStorage.removeItem('smartlib-theme');
      } catch {
        /* ignore */
      }
    } else setTheme(c, b);
    markTheme();
  })
);
window.addEventListener('themechange', markTheme);
$('langSelect').addEventListener('change', (e) => setLang(e.target.value));

/* Profile */
const pf = $('profileForm');
$('avFile').addEventListener('change', async (e) => {
  try {
    pf.avatar.value = await imageToDataUrl(e.target.files[0], 200);
    $('avPrev').innerHTML = avatar(pf.name.value, pf.avatar.value, 'avatar-lg');
  } catch (err) {
    toastError(err);
  }
});
pf.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(pf)) return;
  await withLoading($('profileSave'), async () => {
    try {
      const { user: u } = await api.put('/auth/profile', formData(pf));
      session.setUser(u);
      toast('Profile updated');
    } catch (err) {
      applyServerErrors(pf, err);
    }
  });
});

/* Password */
const pw = $('pwForm');
pw.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validateForm(pw, (d) => (d.newPassword !== d.confirm ? { confirm: 'Passwords do not match' } : {}))) return;
  const { currentPassword, newPassword } = formData(pw);
  await withLoading($('pwSave'), async () => {
    try {
      await api.patch('/auth/password', { currentPassword, newPassword });
      toast('Password updated');
      pw.reset();
    } catch (err) {
      applyServerErrors(pw, err);
    }
  });
});

/* Policy */
const POLICY = [
  ['libraryName', 'Library name', 'text'],
  ['finePerDay', 'Late fine per day (₹)', 'number'],
  ['loanDays', 'Loan period (days)', 'number'],
  ['maxRenewals', 'Max renewals', 'number'],
  ['maxBooksPerMember', 'Max books per member', 'number'],
  ['maxPendingFine', 'Block borrowing above dues (₹)', 'number'],
  ['reservationHoldDays', 'Reservation hold (days)', 'number'],
  ['reservationValidityDays', 'Reservation validity (days)', 'number'],
  ['lostProcessingFee', 'Lost book processing fee (₹)', 'number'],
  ['damageChargePercent', 'Damage charge (% of price)', 'number'],
  ['membershipFee', 'Annual membership fee (₹)', 'number'],
  ['dueSoonDays', 'Due-soon reminder (days before)', 'number'],
  ['backupPath', 'Data backup folder (on the server)', 'text'],
];
const FULL_WIDTH = ['libraryName', 'backupPath'];
async function loadPolicy() {
  const f = $('policyForm');
  try {
    const { data } = await api.get('/settings');
    f.innerHTML =
      POLICY.map(([k, l, t]) => `<div class="field ${FULL_WIDTH.includes(k) ? 'full' : ''}"><label>${l}</label><input class="input ${k === 'backupPath' ? 'mono' : ''}" name="${k}" type="${t}" ${t === 'number' ? `min="0" ${k === 'damageChargePercent' ? 'max="100"' : ''}` : 'minlength="2"'} required value="${h(data[k])}" ${admin ? '' : 'readonly'}>${k === 'backupPath' ? '<span class="field-hint">Folder on the server where “Back up now” writes a JSON dump of every table. Relative paths start at the project folder.</span>' : ''}</div>`).join('') +
      (admin
        ? `<div class="full row" style="gap:10px;flex-wrap:wrap"><button class="btn btn-primary" id="policySave">${icon('check')}Save policy</button>
           <button class="btn" type="button" id="backupNow">${icon('download')}Back up now</button></div>`
        : '');
    $('backupNow')?.addEventListener('click', async (e) => {
      await withLoading(e.currentTarget, async () => {
        try {
          const { data: b } = await api.post('/settings/backup');
          toast(`${b.rows.toLocaleString('en-US')} rows from ${b.tables} tables saved to ${b.file}`, 'success', 'Backup created');
        } catch (err) {
          toastError(err);
        }
      });
    });
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (!validateForm(f)) return;
      const d = formData(f);
      POLICY.forEach(([k, , t]) => t === 'number' && (d[k] = Number(d[k])));
      await withLoading($('policySave'), async () => {
        try {
          await api.put('/settings', d);
          toast('Library policy saved');
        } catch (err) {
          applyServerErrors(f, err);
        }
      });
    };
  } catch (e) {
    f.innerHTML = `<div class="full">${errorState(e.message)}</div>`;
  }
}
loadPolicy();

/* Users (admin) */
async function loadUsers() {
  if (!admin) return;
  try {
    const { data } = await api.get('/auth/users');
    $('userRows').innerHTML = data.length
      ? data
          .map(
            (u, i) => `<tr style="--i:${i}"><td><div class="row">${avatar(u.name, u.avatar, 'avatar-sm')}<div><div class="t-title">${h(u.name)}</div><div class="t-sub">${h(u.email)}</div></div></div></td>
        <td><select class="select" data-role="${u._id}" style="height:32px;width:auto" ${u._id === user._id ? 'disabled' : ''} aria-label="Role for ${h(u.name)}">${['admin', 'librarian', 'staff', 'student'].map((r) => `<option ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
        <td class="mono small">${u.member?.memberId || '—'}</td><td class="small">${u.lastLogin ? relTime(u.lastLogin) : 'Never'}</td><td>${badge(u.isActive ? 'Active' : 'Suspended')}</td>
        <td>${u._id === user._id ? '<span class="small muted">You</span>' : `<button class="btn btn-sm" data-toggle="${u._id}" data-active="${u.isActive}">${u.isActive ? 'Disable' : 'Enable'}</button>`}</td></tr>`
          )
          .join('')
      : `<tr><td colspan="6">${emptyState('No users')}</td></tr>`;
  } catch (e) {
    $('userRows').innerHTML = `<tr><td colspan="6">${errorState(e.message)}</td></tr>`;
  }
}
if (admin) {
  loadUsers();
  $('userRows').addEventListener('change', async (e) => {
    const s = e.target.closest('[data-role]');
    if (!s) return;
    try {
      await api.patch(`/auth/users/${s.dataset.role}`, { role: s.value });
      toast('Role updated');
    } catch (err) {
      toastError(err);
      loadUsers();
    }
  });
  $('userRows').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-toggle]');
    if (!b) return;
    try {
      await api.patch(`/auth/users/${b.dataset.toggle}`, { isActive: b.dataset.active !== 'true' });
      toast('Account updated');
      loadUsers();
    } catch (err) {
      toastError(err);
    }
  });
  $('addUser').addEventListener('click', () => {
    const m = openModal({
      title: 'Add user account',
      subtitle: 'Student accounts must use the email of an existing library member.',
      body: `<form id="uF" novalidate class="form-grid">
        <div class="field"><label>Name <span class="req">*</span></label><input class="input" name="name" required minlength="2"></div>
        <div class="field"><label>Email <span class="req">*</span></label><input class="input" type="email" name="email" required></div>
        <div class="field"><label>Role <span class="req">*</span></label><select class="select" name="role"><option>librarian</option><option>staff</option><option>admin</option><option>student</option></select></div>
        <div class="field"><label>Temporary password <span class="req">*</span></label><input class="input" type="password" name="password" required minlength="6"></div></form>`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="uGo">${icon('plus')}Create account</button>`,
    });
    const form = m.el.querySelector('#uF');
    const btn = m.el.querySelector('#uGo');
    btn.onclick = async () => {
      if (!validateForm(form)) return;
      await withLoading(btn, async () => {
        try {
          await api.post('/auth/users', formData(form));
          toast('User created');
          m.close();
          loadUsers();
        } catch (err) {
          applyServerErrors(form, err);
        }
      });
    };
  });
}

