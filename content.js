(() => {
  const BTN_ID = 'jt-capture-btn';

  // --- Helpers ---

  function getJobId() {
    const param = new URLSearchParams(window.location.search).get('currentJobId');
    if (param) return param;
    const match = window.location.pathname.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : null;
  }

  function extractJobData() {
    const jobId = getJobId();

    const title =
      document.querySelector('.job-details-jobs-unified-top-card__job-title h1')?.innerText.trim() ||
      document.querySelector('h1.t-24')?.innerText.trim() ||
      document.querySelector('h1')?.innerText.trim() ||
      '';

    const company =
      document.querySelector('.job-details-jobs-unified-top-card__company-name a')?.innerText.trim() ||
      document.querySelector('.job-details-jobs-unified-top-card__company-name')?.innerText.trim() ||
      document.querySelector('[data-tracking-control-name="public_jobs_topcard-org-name"]')?.innerText.trim() ||
      '';

    const location =
      document.querySelector('.job-details-jobs-unified-top-card__bullet')?.innerText.trim() ||
      document.querySelector('.job-details-jobs-unified-top-card__primary-description-container .tvm__text')?.innerText.trim() ||
      '';

    const link = jobId
      ? `https://www.linkedin.com/jobs/view/${jobId}/`
      : window.location.href;

    return { title, company, location, link };
  }

  // --- UI ---

  function showToast(message, isError = false) {
    const existing = document.getElementById('jt-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'jt-toast';
    toast.className = isError ? 'jt-toast jt-toast--error' : 'jt-toast jt-toast--success';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // --- Button injection ---

  const ICON_TRACK = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:middle;flex-shrink:0"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="9" x2="9" y2="21"/></svg>`;
  const ICON_CHECK = `<svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:middle;flex-shrink:0"><polyline points="20 6 9 17 4 12"/></svg>`;

  function setTracked(btn) {
    btn.innerHTML = `${ICON_CHECK}<span aria-hidden="true" style="vertical-align:middle">Tracked</span>`;
    btn.classList.remove('artdeco-button--primary');
    btn.classList.add('artdeco-button--secondary');
    btn.disabled = true;
  }

  function injectButton(saveBtn, tracked) {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'artdeco-button artdeco-button--3 jt-track-btn';

    if (tracked) {
      setTracked(btn);
    } else {
      btn.classList.add('artdeco-button--primary');
      btn.innerHTML = `${ICON_TRACK}<span aria-hidden="true" style="vertical-align:middle">Track</span>`;

      btn.addEventListener('click', () => {
        btn.disabled = true;
        if (!isContextValid()) {
          btn.disabled = false;
          showToast('Please refresh the page to reconnect LinkedList', true);
          return;
        }
        const data = extractJobData();
        if (!data.title && !data.company) {
          btn.disabled = false;
          showToast('Could not extract job details — try scrolling down first', true);
          return;
        }

        const payload = { ...data, date_saved: new Date().toISOString() };

        chrome.runtime.sendMessage({ type: 'TRACK_JOB', payload }, (response) => {
          if (response?.ok) {
            setTracked(btn);
            showToast('Tracked in LinkedList');
          } else if (response?.error === 'not_signed_in') {
            showToast('Sign in via the LinkedList popup first', true);
          } else {
            showToast('Failed to save — try again', true);
          }
        });
      });
    }

    saveBtn.insertAdjacentElement('afterend', btn);
  }

  // --- SPA-aware wiring ---
  // LinkedIn is a React SPA. When you click a job in search results the right
  // panel re-renders but there's no page navigation, so we need two signals:
  //   1. MutationObserver – catches the Save button being added/removed in the DOM
  //   2. URL polling – catches the currentJobId changing so we reset the button
  //      even when React reuses the same DOM node for the save button

  function isContextValid() {
    try { return !!chrome.runtime?.id; } catch { return false; }
  }

  let lastJobId = null;
  let cachedJobs = [];

  chrome.storage.local.get('jobs', ({ jobs = [] }) => { cachedJobs = jobs; });
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.jobs) cachedJobs = changes.jobs.newValue || [];
  });

  function syncButton() {
    const saveBtn = document.querySelector('.jobs-save-button');
    const ourBtn  = document.getElementById(BTN_ID);
    const jobId   = getJobId();

    if (ourBtn && jobId !== lastJobId) {
      ourBtn.remove();
    }

    if (saveBtn && !document.getElementById(BTN_ID)) {
      lastJobId = jobId;
      const link = jobId ? `https://www.linkedin.com/jobs/view/${jobId}/` : window.location.href;
      const tracked = cachedJobs.some(j => j.link === link);
      injectButton(saveBtn, tracked);
    } else if (!saveBtn && ourBtn) {
      ourBtn.remove();
    }
  }

  const observer = new MutationObserver(syncButton);
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('popstate', syncButton);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SYNC_BUTTON') {
      syncButton();
      setTimeout(syncButton, 500);
    }
  });

  const poll = setInterval(syncButton, 500);

  syncButton();
})();
