/**
 * DG Jesus Church — Push Notification Registration
 * Vanilla JS, no build step required.
 */

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  vapidPublicKey: null,
  selectedUser: null,
};

// ── DOM helpers ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

function showStep(id) {
  document.querySelectorAll('.step').forEach((el) => {
    el.hidden = el.id !== id;
    el.classList.toggle('active', el.id === id);
  });
}

function showError(elementId, msg) {
  const el = $(elementId);
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
}

function hideError(elementId) {
  const el = $(elementId);
  if (el) el.hidden = true;
}

function setLoading(btn, isLoading, label) {
  btn.disabled = isLoading;
  btn.innerHTML = isLoading
    ? `<span class="spinner"></span>${label}`
    : label;
}

/** Escape HTML to prevent XSS when inserting untrusted strings into innerHTML. */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── VAPID key conversion ──────────────────────────────────────────────────────
/** Convert a base64url VAPID public key to a Uint8Array for the browser API. */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

// ── API client ────────────────────────────────────────────────────────────────
async function callApi(path, options = {}) {
  const res = await fetch(`/api/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ── Device name detection ─────────────────────────────────────────────────────
function getDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua))         return 'iPhone';
  if (/iPad/.test(ua))           return 'iPad';
  if (/Android.*Mobile/.test(ua)) return 'Android Phone';
  if (/Android/.test(ua))        return 'Android Tablet';
  if (/Macintosh/.test(ua))      return 'Mac';
  if (/Windows/.test(ua))        return 'Windows PC';
  if (/Linux/.test(ua))          return 'Linux';
  return 'Browser';
}

// ── iOS detection ─────────────────────────────────────────────────────────────
function isIOS() {
  return /iphone|ipad/i.test(navigator.userAgent);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // Safari-specific property
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // Already registered → go straight to the dashboard.
  // Add ?register=1 to the URL to force re-registration on a new device.
  const alreadyRegistered = localStorage.getItem('dg_person');
  const forceRegister = new URLSearchParams(location.search).get('register') === '1';
  if (alreadyRegistered && !forceRegister) {
    window.location.href = '/report';
    return;
  }

  // iOS in a browser tab: Push API is unavailable until installed on Home Screen
  if (isIOS() && !isStandalone()) {
    showStep('step-install');
    return;
  }

  // All other unsupported browsers
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    showStep('step-unsupported');
    return;
  }

  // Load VAPID public key from backend
  try {
    const cfg = await callApi('config');
    state.vapidPublicKey = cfg.vapidPublicKey;
  } catch {
    showError('search-error', 'Could not load configuration. Please refresh the page.');
  }

  // Wire up events
  $('btn-search').addEventListener('click', handleSearch);
  $('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleSearch();
  });

  $('btn-back').addEventListener('click', () => showStep('step-search'));

  $('btn-back2').addEventListener('click', () => {
    state.selectedUser = null;
    showStep('step-search');
  });

  $('btn-subscribe').addEventListener('click', handleSubscribe);

  $('btn-reset').addEventListener('click', () => {
    state.selectedUser = null;
    $('search-input').value = '';
    hideError('search-error');
    showStep('step-search');
  });
}

// ── Step 1: Search ────────────────────────────────────────────────────────────
async function handleSearch() {
  const input = $('search-input').value.trim();

  if (!input) {
    showError('search-error', 'Please enter your email address or full name.');
    return;
  }

  hideError('search-error');
  const btn = $('btn-search');
  setLoading(btn, true, 'Searching…');

  try {
    const isEmail = input.includes('@');
    const param = isEmail
      ? `email=${encodeURIComponent(input)}`
      : `name=${encodeURIComponent(input)}`;

    const { users = [] } = await callApi(`find-user?${param}`);

    if (users.length === 0) {
      showError(
        'search-error',
        'No account found. Please check your spelling or try your email address.'
      );
      return;
    }

    if (users.length === 1) {
      // Exact match — go straight to subscribe step
      selectUser(users[0]);
      return;
    }

    // Multiple matches — let the user pick
    renderUserList(users);
    showStep('step-confirm');
  } catch (err) {
    showError('search-error', err.message);
  } finally {
    setLoading(btn, false, 'Search');
  }
}

// ── Step 2: User selection ────────────────────────────────────────────────────
function renderUserList(users) {
  const list = $('user-list');
  list.innerHTML = '';

  users.forEach((user) => {
    const btn = document.createElement('button');
    btn.className = 'user-card-btn';
    btn.innerHTML = `
      <div class="person-name">${esc(user.name)}</div>
      ${user.email ? `<div class="person-email">${esc(user.email)}</div>` : ''}
      ${user.isLeader ? `<span class="person-badge">DG Leader</span>` : ''}
    `;
    btn.addEventListener('click', () => selectUser(user));
    list.appendChild(btn);
  });
}

function selectUser(user) {
  state.selectedUser = user;

  const card = $('user-confirmed');
  card.innerHTML = `
    <div class="person-name">${esc(user.name)}</div>
    ${user.email ? `<div class="person-email">${esc(user.email)}</div>` : ''}
    ${user.isLeader ? `<span class="person-badge">DG Leader</span>` : ''}
  `;

  showStep('step-subscribe');
}

// ── Step 3: Subscribe ─────────────────────────────────────────────────────────
async function handleSubscribe() {
  if (!state.selectedUser) return;

  hideError('subscribe-error');
  const btn = $('btn-subscribe');
  setLoading(btn, true, 'Enabling…');

  try {
    // 1. Request notification permission from the browser
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showError(
        'subscribe-error',
        'Permission was denied. Please enable notifications in your browser settings and try again.'
      );
      return;
    }

    // 2. Register the service worker
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/',
    });

    // Wait until the service worker is active
    await navigator.serviceWorker.ready;

    // 3. Subscribe to push
    const pushSub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey),
    });

    // 4. Save subscription to Airtable via backend
    await callApi('subscribe-user', {
      method: 'POST',
      body: {
        personId:     state.selectedUser.id,
        groupIds:     state.selectedUser.groupIds,
        subscription: pushSub.toJSON(),
        deviceName:   getDeviceName(),
        userAgent:    navigator.userAgent,
      },
    });

    // 5. Save identity to localStorage so report.html knows who this is
    localStorage.setItem('dg_person', JSON.stringify({
      id:       state.selectedUser.id,
      name:     state.selectedUser.name,
      firstName: state.selectedUser.firstName || state.selectedUser.name.split(' ')[0] || '',
      groupIds:  state.selectedUser.groupIds || [],
    }));

    // 6. Show success with link to dashboard
    const firstName = state.selectedUser.firstName || state.selectedUser.name;
    $('success-msg').textContent =
      `Notifications are now enabled for ${firstName} on this device.`;
    showStep('step-success');

  } catch (err) {
    // If the user dismissed the permission prompt it throws a DOMException
    if (err.name === 'NotAllowedError') {
      showError(
        'subscribe-error',
        'You dismissed the permission prompt. Please tap the bell icon in your address bar to allow notifications.'
      );
    } else {
      showError('subscribe-error', err.message || 'Something went wrong. Please try again.');
    }
  } finally {
    setLoading(btn, false, '<span class="btn-icon">🔔</span> Enable Notifications');
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────
init().catch(console.error);
