/**
 * DG Jesus Church — Report & Dashboard
 * Handles: identity check, dashboard rendering, TypeForm report flow.
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
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Days until next Tuesday ────────────────────────────────────────────────────
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

  // Load group + reports in parallel
  loading(true);
  try {
    const [groupData, _] = await Promise.all([
      api(`get-group-members?personId=${encodeURIComponent(state.person.id)}`),
      loadReports(null), // will reload after group loads
    ]);
    state.group = groupData;
    $('app-bar-group').textContent = groupData.groupName;
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
  if (!groupRecordId) {
    renderReports([]);
    return;
  }
  try {
    const { reports } = await api(`get-reports?groupRecordId=${encodeURIComponent(groupRecordId)}`);
    state.reports = reports || [];
    renderReports(state.reports);
    renderStats(state.reports);
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
    list.innerHTML = '<div class="reports-empty">No reports yet — add your first one! 👆</div>';
    return;
  }

  list.innerHTML = reports.map(r => {
    const hasGuests = r.firstTimerCount > 0;
    const badge = hasGuests
      ? `<span class="report-badge has-guests">${r.presentCount} + ${r.firstTimerCount} new 🌟</span>`
      : `<span class="report-badge">${r.presentCount} present</span>`;

    const guestNames = hasGuests && Array.isArray(r.firstTimers) && r.firstTimers.length
      ? r.firstTimers.map(g => g.name).filter(Boolean).join(', ')
      : '';

    return `
      <div class="report-row">
        <div class="report-row-left">
          <div class="report-date">${formatDateShort(r.date)}</div>
          ${guestNames ? `<div class="report-meta">Guests: ${esc(guestNames)}</div>` : ''}
          ${r.comments ? `<div class="report-meta">${esc(r.comments.substring(0,60))}${r.comments.length>60?'…':''}</div>` : ''}
        </div>
        ${badge}
      </div>`;
  }).join('');
}

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
  state.guestCount = Math.max(0, state.guestCount + delta);
  $('guests-val').textContent = state.guestCount;
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

  // Entering from right (fwd) or left (back)
  next.style.transform = direction === 'fwd' ? 'translateX(60px)' : 'translateX(-60px)';
  next.style.opacity = '0';
  next.style.transition = 'none';
  // Force reflow
  next.offsetHeight; // eslint-disable-line no-unused-expressions
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
    await api('submit-report', {
      method: 'POST',
      body: {
        personId:       state.person.id,
        groupRecordId:  state.group?.groupRecordId || '',
        date:           state.formDate,
        presentCount:   state.presentIds.size,
        firstTimerCount: state.guestCount,
        firstTimers:    state.guests,
        comments:       state.comments,
      },
    });

    // Show success
    const dateStr = formatDate(state.formDate);
    const guestTxt = state.guestCount > 0 ? ` · ${state.guestCount} first-time guest${state.guestCount>1?'s':''}` : '';
    $('success-detail').textContent =
      `${dateStr}\n${state.group?.groupName || ''} · ${state.presentIds.size} present${guestTxt}`;

    goToStep('success', 'fwd');

    // Reload reports in background
    if (state.group?.groupRecordId) loadReports(state.group.groupRecordId);

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
