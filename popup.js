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

function statusSlug(s) { return (s || '').replace(/\s+/g, '-'); }

function matchesByCompany(jobCompany, eventCompany) {
  const jc = (jobCompany || '').toLowerCase();
  const ec = (eventCompany || '').toLowerCase();
  return jc === ec || jc.includes(ec) || ec.includes(jc);
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

  const { jobs = [], spreadsheetId, gmailEnabled, emailEvents = [], unresolvedEvents = [] } =
    await chrome.storage.local.get(['jobs', 'spreadsheetId', 'gmailEnabled', 'emailEvents', 'unresolvedEvents']);

  await chrome.storage.local.set({ unseenEmailCount: 0 });

  const openBtn = document.getElementById('open-sheet-btn');
  if (spreadsheetId) { openBtn.disabled = false; openBtn.title = ''; }

  renderJobs(jobs);
  renderUnresolvedEvents(unresolvedEvents, jobs);
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
    <div class="job-card" data-link="${esc(job.link)}" style="cursor:pointer">
      <div class="job-title">${esc(job.title) || 'Untitled'}</div>
      <div class="job-meta">${esc(job.company)}${job.company && job.location ? ' · ' : ''}${esc(job.location)}</div>
      <div class="job-footer">
        ${job.savedAt ? `<div class="job-date">Saved ${formatDate(job.savedAt)}</div>` : '<div></div>'}
        ${job.status ? `<span class="status-badge status-badge--${statusSlug(job.status)}">${esc(job.status)}</span>` : ''}
      </div>
      <button class="remove-btn" data-index="${i}" title="Remove">✕</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.job-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn')) return;
      chrome.tabs.create({ url: card.dataset.link });
    });
  });

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

// ── Unresolved events ─────────────────────────────────────────────────────────

function renderUnresolvedEvents(events, allJobs) {
  const section = document.getElementById('unresolved-section');
  const listEl  = document.getElementById('unresolved-list');

  if (!events.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';

  listEl.innerHTML = events.map((e, i) => {
    const matches = allJobs.filter(j => matchesByCompany(j.company, e.company));
    const options = matches.length
      ? matches.map((j, ji) => `<option value="${ji}">${esc(j.title)}</option>`).join('')
      : '';
    return `
      <div class="unresolved-card">
        <div class="unresolved-header">
          <span class="status-badge status-badge--${statusSlug(e.status)}">${esc(e.status)}</span>
          <span class="unresolved-company">${esc(e.company)}</span>
        </div>
        ${e.threadId
          ? `<a class="unresolved-subject" href="https://mail.google.com/mail/u/0/#all/${e.threadId}" target="_blank">${esc(e.subject)}</a>`
          : `<div class="unresolved-subject">${esc(e.subject)}</div>`
        }
        ${matches.length ? `
          <div class="unresolved-actions">
            <select class="unresolved-select" data-idx="${i}">
              <option value="-1">Select job…</option>
              ${options}
            </select>
            <button class="assign-btn" data-idx="${i}" disabled>Assign</button>
          </div>
        ` : `<div style="font-size:11px;color:#aaa;margin-bottom:4px">No tracked jobs found for ${esc(e.company)}</div>`}
        <button class="dismiss-btn" data-event-id="${esc(e.id)}">Dismiss</button>
      </div>
    `;
  }).join('');

  listEl.querySelectorAll('.unresolved-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const btn = listEl.querySelector(`.assign-btn[data-idx="${sel.dataset.idx}"]`);
      btn.disabled = sel.value === '-1';
    });
  });

  listEl.querySelectorAll('.assign-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i        = parseInt(btn.dataset.idx, 10);
      const sel      = listEl.querySelector(`.unresolved-select[data-idx="${i}"]`);
      const jobIdx   = parseInt(sel.value, 10);
      if (jobIdx === -1) return;
      const event    = events[i];
      const matches  = allJobs.filter(j => matchesByCompany(j.company, event.company));
      const selected = matches[jobIdx];
      btn.textContent = '…';
      btn.disabled = true;
      chrome.runtime.sendMessage({
        type: 'ASSIGN_EMAIL_EVENT',
        payload: { event, jobTitle: selected.title, jobCompany: selected.company },
      });
    });
  });

  listEl.querySelectorAll('.dismiss-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { unresolvedEvents: cur = [] } = await chrome.storage.local.get('unresolvedEvents');
      await chrome.storage.local.set({ unresolvedEvents: cur.filter(e => e.id !== btn.dataset.eventId) });
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
  listEl.innerHTML = events.map(e => {
    const tag  = e.threadId ? 'a' : 'div';
    const href = e.threadId ? `href="https://mail.google.com/mail/u/0/#all/${e.threadId}" target="_blank"` : '';
    return `
    <${tag} class="email-card" ${href}>
      <span class="status-badge status-badge--${statusSlug(e.status)}">${esc(e.status)}</span>
      <div class="email-body">
        <div class="email-company">${esc(e.company)}</div>
        ${e.title ? `<div class="email-title">${esc(e.title)}</div>` : ''}
        <div class="email-subject">${esc(e.subject)}</div>
        <div class="email-time">${formatDate(e.receivedAt)}</div>
      </div>
    </${tag}>
  `;
  }).join('');
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

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.jobs)             renderJobs(changes.jobs.newValue || []);
  if (changes.emailEvents)      renderEmailEvents(changes.emailEvents.newValue || [], true);
  if (changes.unresolvedEvents) {
    const { jobs = [] } = await chrome.storage.local.get('jobs');
    renderUnresolvedEvents(changes.unresolvedEvents.newValue || [], jobs);
  }
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
