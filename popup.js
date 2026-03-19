function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

async function fetchUserInfo(token) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function esc(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Screens ──────────────────────────────────────────────────────────────────

function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('main-screen').style.display = 'none';
}

async function showMainScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('main-screen').style.display = 'block';

  const { userInfo } = await chrome.storage.local.get('userInfo');
  if (userInfo?.email) {
    document.getElementById('user-email').textContent = userInfo.email;
  }

  const { jobs = [], spreadsheetId, gmailEnabled, emailEvents = [] } = await chrome.storage.local.get(['jobs', 'spreadsheetId', 'gmailEnabled', 'emailEvents']);

  const openBtn = document.getElementById('open-sheet-btn');
  if (spreadsheetId) { openBtn.disabled = false; openBtn.title = ''; }

  renderJobs(jobs);
  renderEmailEvents(emailEvents, gmailEnabled);
}

// ── Job list ─────────────────────────────────────────────────────────────────

function renderJobs(jobs) {
  const listEl  = document.getElementById('job-list');
  const emptyEl = document.getElementById('empty');
  const countEl = document.getElementById('job-count');

  countEl.textContent = `${jobs.length} job${jobs.length !== 1 ? 's' : ''}`;

  if (jobs.length === 0) {
    emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = jobs.map((job, i) => `
    <div class="job-card">
      <div class="job-title">${esc(job.title) || 'Untitled'}</div>
      <div class="job-meta">${esc(job.company)}${job.company && job.location ? ' · ' : ''}${esc(job.location)}</div>
      <div class="job-link"><a href="${esc(job.link)}" target="_blank">${esc(job.link)}</a></div>
      ${job.savedAt ? `<div class="job-date">Saved ${formatDate(job.savedAt)}</div>` : ''}
      <button class="remove-btn" data-index="${i}" title="Remove">✕</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.remove-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = parseInt(e.currentTarget.dataset.index, 10);
      const { jobs: current = [] } = await chrome.storage.local.get('jobs');
      current.splice(idx, 1);
      await chrome.storage.local.set({ jobs: current });
      renderJobs(current);
    });
  });
}

// ── Email events ─────────────────────────────────────────────────────────────

function renderEmailEvents(events, gmailEnabled) {
  const listEl   = document.getElementById('email-list');
  const emptyEl  = document.getElementById('email-empty');
  const enableBtn = document.getElementById('enable-gmail-btn');

  if (!gmailEnabled) {
    enableBtn.style.display = 'block';
    listEl.innerHTML = '';
    emptyEl.style.display = 'none';
    return;
  }

  enableBtn.style.display = 'none';

  if (!events.length) {
    emptyEl.style.display = 'block';
    listEl.innerHTML = '';
    return;
  }

  emptyEl.style.display = 'none';
  listEl.innerHTML = events.map(e => `
    <div class="email-card">
      <span class="status-badge status-badge--${esc(e.status)}">${esc(e.status)}</span>
      <div class="email-body">
        <div class="email-company">${esc(e.company)}</div>
        <div class="email-subject">${esc(e.subject)}</div>
        <div class="email-time">${formatDate(e.receivedAt)}</div>
      </div>
    </div>
  `).join('');
}

document.getElementById('enable-gmail-btn').addEventListener('click', async () => {
  const btn = document.getElementById('enable-gmail-btn');
  btn.textContent = 'Authorizing…';
  try {
    // Remove cached token so Chrome prompts for the new Gmail scope
    await new Promise(r => chrome.identity.clearAllCachedAuthTokens(r));
    await getToken(true); // re-auth with all scopes including Gmail
    await chrome.storage.local.set({ gmailEnabled: true });
    const { emailEvents = [] } = await chrome.storage.local.get('emailEvents');
    renderEmailEvents(emailEvents, true);
  } catch {
    btn.textContent = 'Enable';
  }
});

// ── Auth actions ──────────────────────────────────────────────────────────────

document.getElementById('signin-btn').addEventListener('click', async () => {
  const errorEl = document.getElementById('auth-error');
  errorEl.textContent = '';
  try {
    const token = await getToken(true);
    const userInfo = await fetchUserInfo(token);
    await chrome.storage.local.set({ userInfo });
    showMainScreen();
  } catch (err) {
    errorEl.textContent = 'Sign in failed — please try again.';
  }
});

document.getElementById('signout-btn').addEventListener('click', async () => {
  try {
    const token = await getToken(false);
    chrome.identity.removeCachedAuthToken({ token });
    fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, { method: 'POST' });
  } catch {}
  await chrome.storage.local.clear();
  showAuthScreen();
});

// ── Toolbar actions ───────────────────────────────────────────────────────────

document.getElementById('open-sheet-btn').addEventListener('click', async () => {
  const { spreadsheetId } = await chrome.storage.local.get('spreadsheetId');
  if (spreadsheetId) {
    chrome.tabs.create({ url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}` });
  }
});


// ── Live updates ─────────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.jobs)        renderJobs(changes.jobs.newValue || []);
  if (changes.emailEvents) renderEmailEvents(changes.emailEvents.newValue || [], true);
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await getToken(false);
    showMainScreen();
  } catch {
    showAuthScreen();
  }
})();
