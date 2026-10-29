// REST client for the SmartLib backend.
// When the frontend is served by the Express server the API is same-origin.
// When opened from a separate static server (e.g. VS Code Live Server on :5500)
// it falls back to http://localhost:5000. Override with localStorage 'smartlib-api'.
function apiOrigin() {
  try {
    const custom = localStorage.getItem('smartlib-api');
    if (custom) return custom;
  } catch {
    /* storage unavailable */
  }
  if (location.protocol === 'file:' || ['5500', '5501', '8080'].includes(location.port)) return 'http://localhost:3000';
  return '';
}

export const API_BASE = `${apiOrigin().replace(/\/$/, '')}/api`;

const TOKEN_KEY = 'smartlib-token';
const USER_KEY = 'smartlib-user';

export const session = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  setUser(user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function qs(params) {
  if (!params) return '';
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.append(k, v);
  });
  const s = u.toString();
  return s ? `?${s}` : '';
}

/**
 * Demo mode: the whole backend runs in the browser (js/demo/demo-api.js) with data in
 * localStorage. Always on for static hosting (GitHub Pages) and for a separate demo
 * deployment whose host name has "demo" in it (e.g. smartlib-demo.vercel.app); being a
 * different site, it never affects the real one. Elsewhere on with ?demo=1, off with ?demo=0.
 */
function detectDemo() {
  const demoHost = location.hostname.endsWith('github.io') || /(^|-)demo(-|$)/.test(location.hostname.split('.')[0]);
  try {
    const flag = new URLSearchParams(location.search).get('demo');
    if (flag === '1') localStorage.setItem('smartlib-demo', '1');
    if (flag === '0') localStorage.removeItem('smartlib-demo');
    return demoHost || localStorage.getItem('smartlib-demo') === '1';
  } catch {
    return demoHost;
  }
}
export const DEMO_MODE = detectDemo();
let demoModule = null;

function handleUnauthorized(status, path) {
  if (status === 401 && !path.startsWith('/auth/login')) {
    session.clear();
    const here = location.pathname.split('/').pop() || 'index.html';
    if (here !== 'index.html') location.href = `index.html?next=${encodeURIComponent(here + location.search)}&expired=1`;
  }
}

async function demoCall(method, path, body, params) {
  demoModule = demoModule || (await import('./demo/demo-api.js'));
  try {
    return await demoModule.demoRequest(method, path, { body, params, token: session.token });
  } catch (e) {
    if (!e.status) throw new ApiError(e.message || 'Demo error', 500);
    handleUnauthorized(e.status, path);
    throw new ApiError(e.message, e.status, e.details);
  }
}
export async function resetDemoData() {
  demoModule = demoModule || (await import('./demo/demo-api.js'));
  demoModule.resetDemo();
}

async function request(method, path, { body, params } = {}) {
  if (DEMO_MODE) return demoCall(method, path, body, params);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(`${API_BASE}${path}${qs(params)}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the SmartLib server. Is the backend running?', 0);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    handleUnauthorized(res.status, path);
    throw new ApiError(data?.message || `Request failed (${res.status})`, res.status, data?.details);
  }
  return data;
}

export const api = {
  get: (path, params) => request('GET', path, { params }),
  post: (path, body) => request('POST', path, { body: body ?? {} }),
  put: (path, body) => request('PUT', path, { body: body ?? {} }),
  patch: (path, body) => request('PATCH', path, { body: body ?? {} }),
  del: (path) => request('DELETE', path),
};
