/**
 * DG Jesus Church — Report & Dashboard
 * Handles: identity check, dashboard rendering, TypeForm report flow,
 *          report detail sheet, ask-leader sheet, overdue detection.
 */

// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  person:   null,   // { id, name, firstName, groupIds }
  group:    null,   // { groupName, groupRecordId, groupId, members }
  reports:  [],     // recent reports from Airtable

  // Form
  formDate:       '',
  presentIds:     new Set(),
  guestCount:     0,
  guests:         [],   // [{ name, surname, gender }]
  comments:       '',

  // UI
  currentStep: 'date',
  formDirection: 'fwd',
};

const STEPS = ['date', 'attendance', 'guests', 'guest-details', 'comments'];

// ── Helpers ────────────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const show = id => { const el = $(id); if (el) el.classList.remove('hidden'); };
const hide = id => { const el = $(id); if (el) el.classList.add('hidden'); };

async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function loading(on) {
  on ? show('overlay-loading') : hide('overlay-loading');
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Date helpers ───────────────────────────────────────────────────────────────
function daysUntilTuesday() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun … 6=Sat; 2=Tue
  return day === 2 ? 0 : (2 - day + 7) % 7;
}

function nextTuesdayDate() {
  const d = new Date();
  const diff = daysUntilTuesday();
  d.setDate(d.getDate() + diff);
  return d;
}

/** Returns the ISO date for the most recent Tuesday (today if today is Tue). */
function lastTuesdayISO() {
  const today = new Date();
  const day = today.getDay();
  const daysBack = (day - 2 + 7) % 7; // 0 if today is Tuesday
  const d = new Date(today);
  d.setDate(today.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr + 'T12:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Overdue detection ──────────────────────────────────────────────────────────
/**
 * Returns true if the leader has not submitted a report since the most recent Tuesday
 * AND today is not Tuesday (Tue is submission day — give them the day).
 */
function isReportOverdue(reports) {
  const today = new Date();
  const day = today.getDay();

  // Don't show overdue on Tuesday itself
  if (day === 2) return false;

  const cutoff = lastTuesdayISO();
  const hasRecentReport = reports.some(r => r.date >= cutoff);
  return !hasRecentReport;
}

function renderOverdueBanner(reports) {
  if (isReportOverdue(reports)) {
    show('overdue-banner');
  } else {
    hide('overdue-banner');
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  const saved = localStorage.getItem('dg_person');
  if (!saved) {
    show('screen-unauth');
    return;
  }

  try {
    state.person = JSON.parse(saved);
  } catch {
    show('screen-unauth');
    return;
  }

  // Show dashboard immediately, load data in background
  show('screen-dashboard');
  renderHeader();
  renderCountdown();

  // Wire up ask-leader button
  const askBtn = $('ask-btn');
  if (askBtn) askBtn.addEventListener('click', openAskSheet);

  // Load group + reports in parallel
  loading(true);
  try {
    const groupData = await api(`get-group-members?personId=${encodeURIComponent(state.person.id)}`);
    state.group = groupData;
    $('app-bar-group').textContent = groupData.groupName || '';
    await loadReports(groupData.groupRecordId);
  } catch (err) {
    console.error('[init]', err.message);
  } finally {
    loading(false);
  }

  // Check for ?new=1 in URL (from notification click)
  if (new URLSearchParams(location.search).get('new') === '1') {
    startNewReport();
  }
}

// ── Header ─────────────────────────────────────────────────────────────────────
function renderHeader() {
  const p = state.person;
  $('app-bar-name').textContent = p.firstName || p.name || 'Leader';
}

// ── Countdown ──────────────────────────────────────────────────────────────────
function renderCountdown() {
  const days = daysUntilTuesday();
  const card = $('countdown-card');
  const numEl = $('countdown-number');
  const txtEl = $('countdown-text');
  const dateEl = $('countdown-date');

  const next = nextTuesdayDate();
  const dateStr = next.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });

  if (days === 0) {
    card.classList.add('is-today');
    numEl.textContent = '🎉';
    txtEl.textContent = 'DG is TODAY!';
    dateEl.textContent = "Don't forget your report";
  } else if (days === 1) {
    numEl.textContent = '1';
    txtEl.textContent = 'day until DG';
    dateEl.textContent = dateStr;
  } else {
    numEl.textContent = days;
    txtEl.textContent = 'days until DG';
    dateEl.textContent = dateStr;
  }
}

// ── Reports / Dashboard ────────────────────────────────────────────────────────
async function loadReports(groupRecordId) {
  try {
    // Always pass personId too — ensures reports show even if Group field wasn't linked
    const params = new URLSearchParams();
    if (groupRecordId) params.set('groupRecordId', groupRecordId);
    if (state.person?.id) params.set('personId', state.person.id);
    if (!params.toString()) { renderReports([]); return; }

    const { reports } = await api(`get-reports?${params.toString()}`);
    state.reports = reports || [];
    renderReports(state.reports);
    renderStats(state.reports);
    renderOverdueBanner(state.reports);
  } catch (err) {
    console.error('[loadReports]', err.message);
    renderReports([]);
  }
}

function renderStats(reports) {
  const now = new Date();
  const thisMonth = reports.filter(r => {
    const d = new Date(r.date + 'T12:00:00');
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  });

  const avg = thisMonth.length
    ? Math.round(thisMonth.reduce((s, r) => s + r.presentCount, 0) / thisMonth.length)
    : '–';
  const newPeople = thisMonth.reduce((s, r) => s + (r.firstTimerCount || 0), 0);

  $('stat-avg').textContent   = avg;
  $('stat-new').textContent   = newPeople;
  $('stat-total').textContent = reports.length;
}

function renderReports(reports) {
  const list = $('reports-list');
  if (!reports.length) {
    list.innerHTML = `
      <div class="reports-empty">
        <div class="reports-empty-icon">📋</div>
        <div>No reports yet — add your first one! 👆</div>
      </div>`;
    return;
  }

  list.innerHTML = reports.map((r, i) => {
    const hasGuests = r.firstTimerCount > 0;
    const badge = hasGuests
      ? `<span class="report-badge has-guests">${r.presentCount} + ${r.firstTimerCount} new 🌟</span>`
      : `<span class="report-badge">${r.presentCount} present</span>`;

    const guestNames = hasGuests && Array.isArray(r.firstTimers) && r.firstTimers.length
      ? r.firstTimers.map(g => g.name).filter(Boolean).join(', ')
      : '';

    return `
      <div class="report-row" onclick="openReportSheet(${i})" tabindex="0" role="button" aria-label="View report for ${formatDateShort(r.date)}">
        <div class="report-row-left">
          <div class="report-date">${formatDateShort(r.date)}</div>
          ${guestNames ? `<div class="report-meta">Guests: ${esc(guestNames)}</div>` : ''}
          ${r.comments ? `<div class="report-meta">${esc(r.comments.substring(0,55))}${r.comments.length>55?'…':''}</div>` : ''}
        </div>
        <div class="report-row-right">
          ${badge}
          <span class="report-chevron">›</span>
        </div>
      </div>`;
  }).join('');
}

// ── Report detail sheet ────────────────────────────────────────────────────────
window.openReportSheet = function(index) {
  const r = state.reports[index];
  if (!r) return;

  $('sheet-title').textContent = `Report – ${formatDate(r.date)}`;

  const guestRows = r.firstTimerCount > 0 ? `
    <div class="sheet-detail-row">
      <span class="sheet-detail-label">First-timers</span>
      <div class="sheet-detail-value">
        ${Array.isArray(r.firstTimers) && r.firstTimers.length
          ? `<div class="sheet-guests-wrap">${r.firstTimers.map(g => `
              <span class="sheet-guest-chip">
                🌟 ${esc(g.name)}${g.surname ? ' ' + esc(g.surname) : ''}
                ${g.gender ? `<span style="opacity:.6;font-size:.72rem">(${esc(g.gender)})</span>` : ''}
              </span>`).join('')}</div>`
          : r.firstTimerCount + ' guest(s)'
        }
      </div>
    </div>` : '';

  const commentsRow = r.comments ? `
    <div class="sheet-detail-row" style="flex-direction:column;gap:.5rem;">
      <span class="sheet-detail-label">Notes &amp; Prayer Requests</span>
      <div class="sheet-comments-block">${esc(r.comments)}</div>
    </div>` : '';

  $('sheet-body').innerHTML = `
    <div class="sheet-detail-row">
      <span class="sheet-detail-label">Date</span>
      <span class="sheet-detail-value">${formatDate(r.date)}</span>
    </div>
    <div class="sheet-detail-row">
      <span class="sheet-detail-label">Present</span>
      <span class="sheet-detail-value">${r.presentCount} member${r.presentCount !== 1 ? 's' : ''}</span>
    </div>
    ${guestRows}
    ${commentsRow}
  `;

  show('report-sheet-overlay');
  show('report-sheet');
  // Prevent body scroll
  document.body.style.overflow = 'hidden';
};

window.closeReportSheet = function() {
  hide('report-sheet-overlay');
  hide('report-sheet');
  document.body.style.overflow = '';
};

// ── Ask leader sheet ───────────────────────────────────────────────────────────
function openAskSheet() {
  $('ask-message').value = '';
  hide('ask-error');
  hide('ask-success');
  const btn = $('btn-ask-send');
  btn.disabled = false;
  btn.textContent = 'Send Message 🙏';
  show('ask-sheet-overlay');
  show('ask-sheet');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('ask-message').focus(), 300);
}

window.closeAskSheet = function() {
  hide('ask-sheet-overlay');
  hide('ask-sheet');
  document.body.style.overflow = '';
};

window.sendAskLeader = async function() {
  const message = $('ask-message').value.trim();
  hide('ask-error');

  if (!message) {
    show('ask-error');
    $('ask-error').textContent = 'Please write a message before sending.';
    return;
  }

  const btn = $('btn-ask-send');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    await api('ask-leader', {
      method: 'POST',
      body: {
        personId:     state.person?.id || '',
        personName:   state.person?.name || '',
        groupName:    state.group?.groupName || '',
        groupRecordId: state.group?.groupRecordId || '',
        message,
      },
    });

    hide('btn-ask-send');
    show('ask-success');

    // Auto-close after 2s
    setTimeout(() => {
      closeAskSheet();
      setTimeout(() => show('btn-ask-send'), 500);
    }, 2000);

  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Send Message 🙏';
    show('ask-error');
    $('ask-error').textContent = err.message || 'Could not send. Please try again.';
  }
};

// ── Start new report ───────────────────────────────────────────────────────────
function startNewReport() {
  // Reset form state
  state.formDate     = todayISO();
  state.presentIds   = new Set();
  state.guestCount   = 0;
  state.guests       = [];
  state.comments     = '';
  state.currentStep  = 'date';

  // Populate members grid
  renderMembersGrid();

  // Set default date
  $('input-date').value = state.formDate;

  // Reset guest stepper
  $('guests-val').textContent = '0';

  // Clear comments
  $('input-comments').value = '';

  // Go to form screen, show first step
  hide('screen-dashboard');
  show('screen-form');

  // Activate first step
  document.querySelectorAll('.form-step').forEach(el => {
    el.classList.remove('active', 'exit-fwd', 'exit-back');
  });
  $('step-date').classList.add('active');
  updateProgress();
}

function renderMembersGrid() {
  const grid = $('members-grid');
  if (!state.group || !state.group.members.length) {
    grid.innerHTML = '<p style="color:var(--muted);font-size:.9rem;">No members found for your group.</p>';
    return;
  }

  grid.innerHTML = state.group.members.map(m => `
    <div class="member-card" id="member-${m.id}" onclick="toggleMember('${m.id}')">
      ${esc(m.name)}
    </div>
  `).join('');
  updatePresentCount();
}

function toggleMember(id) {
  if (state.presentIds.has(id)) {
    state.presentIds.delete(id);
    $(`member-${id}`)?.classList.remove('present');
  } else {
    state.presentIds.add(id);
    $(`member-${id}`)?.classList.add('present');
  }
  updatePresentCount();
}

function updatePresentCount() {
  const n = state.presentIds.size;
  $('present-count').textContent = n === 1 ? '1 present' : `${n} present`;
}

function adjustGuests(delta) {
  const newVal = Math.max(0, state.guestCount + delta);
  if (newVal === state.guestCount) return;
  state.guestCount = newVal;
  const valEl = $('guests-val');
  valEl.textContent = state.guestCount;
  // Bump animation
  valEl.classList.remove('bump');
  void valEl.offsetWidth; // reflow
  valEl.classList.add('bump');
}

// ── TypeForm navigation ────────────────────────────────────────────────────────
function getStepSequence() {
  // Skip guest-details if no guests
  return state.guestCount > 0
    ? STEPS
    : STEPS.filter(s => s !== 'guest-details');
}

function updateProgress() {
  const seq = getStepSequence();
  const idx = seq.indexOf(state.currentStep);
  const pct = idx < 0 ? 100 : ((idx + 1) / (seq.length)) * 100;
  $('form-progress-fill').style.width = pct + '%';

  // Hide back button on first step
  const backBtn = $('form-back-btn');
  if (backBtn) {
    backBtn.style.visibility = idx <= 0 ? 'hidden' : 'visible';
  }
}

function goToStep(stepId, direction = 'fwd') {
  const current = document.querySelector('.form-step.active');
  const next = $('step-' + stepId);
  if (!next) return;

  if (current) {
    current.classList.remove('active');
    current.classList.add(direction === 'fwd' ? 'exit-fwd' : 'exit-back');
    setTimeout(() => current.classList.remove('exit-fwd', 'exit-back'), 350);
  }

  // Animate entering step
  next.style.transform = direction === 'fwd' ? 'translateX(50px)' : 'translateX(-50px)';
  next.style.opacity = '0';
  next.style.transition = 'none';
  next.offsetHeight; // force reflow
  next.style.transition = '';
  next.style.transform = '';
  next.style.opacity = '';
  next.classList.add('active');

  state.currentStep = stepId;
  updateProgress();
}

window.formNext = function () {
  // Collect current step's data before advancing
  if (state.currentStep === 'date') {
    const val = $('input-date').value;
    if (!val) { $('input-date').focus(); return; }
    state.formDate = val;
  }
  if (state.currentStep === 'guests') {
    state.guestCount = parseInt($('guests-val').textContent) || 0;
    if (state.guestCount > 0) renderGuestsForm();
  }

  const seq = getStepSequence();
  const idx = seq.indexOf(state.currentStep);
  if (idx < seq.length - 1) {
    goToStep(seq[idx + 1], 'fwd');
  }
};

window.formBack = function () {
  const seq = getStepSequence();
  const idx = seq.indexOf(state.currentStep);
  if (idx <= 0) {
    showDashboard();
    return;
  }
  goToStep(seq[idx - 1], 'back');
};

/**
 * Exit the form entirely without saving — goes back to the dashboard.
 * Called by the ✕ button in the form top bar.
 */
window.exitForm = function () {
  showDashboard();
};

function renderGuestsForm() {
  const form = $('guests-form');
  state.guests = Array.from({ length: state.guestCount }, (_, i) => state.guests[i] || { name: '', surname: '', gender: '' });

  form.innerHTML = state.guests.map((g, i) => `
    <div class="guest-block">
      <div class="guest-label">Guest ${i + 1}</div>
      <input class="field-text" type="text" placeholder="First name" id="g-name-${i}"
        value="${esc(g.name)}" oninput="state.guests[${i}].name=this.value" />
      <input class="field-text" type="text" placeholder="Surname" id="g-surname-${i}"
        value="${esc(g.surname)}" oninput="state.guests[${i}].surname=this.value" />
      <div class="gender-row">
        ${['Male','Female','Other'].map(opt => `
          <button class="gender-btn${g.gender===opt?' selected':''}"
            onclick="selectGender(${i},'${opt}',this)">${opt}</button>
        `).join('')}
      </div>
    </div>
  `).join('');
}

window.selectGender = function (idx, val, btn) {
  state.guests[idx].gender = val;
  btn.closest('.gender-row').querySelectorAll('.gender-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
};

// ── Submit ─────────────────────────────────────────────────────────────────────
window.submitReport = async function () {
  state.comments = $('input-comments').value.trim();

  loading(true);
  try {
    // Use groupRecordId from loaded group data, or fall back to the one saved
    // in localStorage at registration time (so Group is always linked even if
    // get-group-members had a transient failure)
    const groupRecordId = state.group?.groupRecordId || state.person?.groupIds?.[0] || '';

    await api('submit-report', {
      method: 'POST',
      body: {
        personId:        state.person.id,
        groupRecordId,
        date:            state.formDate,
        presentCount:    state.presentIds.size,
        firstTimerCount: state.guestCount,
        firstTimers:     state.guests,
        comments:        state.comments,
      },
    });

    // Show success
    const dateStr = formatDate(state.formDate);
    const guestTxt = state.guestCount > 0 ? ` · ${state.guestCount} first-time guest${state.guestCount>1?'s':''}` : '';
    $('success-detail').textContent =
      `${dateStr}\n${state.group?.groupName || ''} · ${state.presentIds.size} present${guestTxt}`;

    goToStep('success', 'fwd');

    // Reload reports in background (loadReports now always sends personId too)
    loadReports(state.group?.groupRecordId || state.person?.groupIds?.[0] || '');

  } catch (err) {
    alert('Could not submit report: ' + err.message);
  } finally {
    loading(false);
  }
};

// ── Show dashboard ─────────────────────────────────────────────────────────────
window.showDashboard = function () {
  hide('screen-form');
  show('screen-dashboard');
  // Clean URL
  if (location.search) history.replaceState({}, '', location.pathname);
};

window.startNewReport = startNewReport;

// ── Boot ───────────────────────────────────────────────────────────────────────
init().catch(console.error);
