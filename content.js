(() => {
  const BTN_ID = 'jt-capture-btn';

  // --- Helpers ---

  function getJobId() {
    // Search page: ?currentJobId=xxx
    const param = new URLSearchParams(window.location.search).get('currentJobId');
    if (param) return param;
    // Direct view page: /jobs/view/1234567/
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

    // Always use the canonical /jobs/view/ URL
    const link = jobId
      ? `https://www.linkedin.com/jobs/view/${jobId}/`
      : window.location.href;

    return { title, company, location, link };
  }

  function escapeHtml(str = '') {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function csvEscape(str = '') {
    return str.replace(/"/g, '""');
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

  function showPanel(data) {
    const existing = document.getElementById('jt-panel');
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'jt-panel';
    panel.innerHTML = `
      <div class="jt-panel__header">
        <span>Job Captured</span>
        <button class="jt-panel__close" id="jt-panel-close">✕</button>
      </div>
      <div class="jt-panel__row"><span class="jt-panel__label">Title</span><span class="jt-panel__value">${escapeHtml(data.title) || '—'}</span></div>
      <div class="jt-panel__row"><span class="jt-panel__label">Company</span><span class="jt-panel__value">${escapeHtml(data.company) || '—'}</span></div>
      <div class="jt-panel__row"><span class="jt-panel__label">Location</span><span class="jt-panel__value">${escapeHtml(data.location) || '—'}</span></div>
      <div class="jt-panel__row"><span class="jt-panel__label">Link</span><span class="jt-panel__value jt-panel__link">${escapeHtml(data.link)}</span></div>
      <div class="jt-panel__actions">
        <button class="jt-btn" id="jt-copy-btn">Copy JSON</button>
        <button class="jt-btn" id="jt-copy-csv-btn">Copy CSV</button>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('jt-panel-close').addEventListener('click', () => panel.remove());
    document.getElementById('jt-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(JSON.stringify(data, null, 2))
        .then(() => showToast('Copied as JSON'))
        .catch(() => showToast('Copy failed', true));
    });
    document.getElementById('jt-copy-csv-btn').addEventListener('click', () => {
      const csv = `"${csvEscape(data.title)}","${csvEscape(data.company)}","${csvEscape(data.location)}","${csvEscape(data.link)}"`;
      navigator.clipboard.writeText(csv)
        .then(() => showToast('Copied as CSV'))
        .catch(() => showToast('Copy failed', true));
    });
  }

  // --- Button injection ---

  function injectButton(saveBtn) {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    // Reuse LinkedIn's own artdeco classes so sizing/spacing matches naturally
    btn.className = 'artdeco-button artdeco-button--primary artdeco-button--3 jt-track-btn';
    btn.innerHTML = `<span aria-hidden="true">Track Job</span>`;

    btn.addEventListener('click', async () => {
      const data = extractJobData();
      if (!data.title && !data.company) {
        showToast('Could not extract job details — try scrolling down first', true);
        return;
      }

      const payload = { ...data, date_saved: new Date().toISOString() };

      try {
        const res = await fetch('http://localhost:8000/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.status === 201) {
          showPanel(data);
          showToast('Job saved to tracker');
        } else if (res.status === 409) {
          showToast('Already tracked', true);
          return;
        } else {
          throw new Error(`Unexpected status ${res.status}`);
        }
      } catch (err) {
        showPanel(data);
        showToast('API unavailable — saved locally only', true);
      }

      const saved = JSON.parse(localStorage.getItem('jt-jobs') || '[]');
      if (!saved.find(j => j.link === data.link)) {
        saved.unshift({ ...data, savedAt: payload.date_saved });
        localStorage.setItem('jt-jobs', JSON.stringify(saved));
      }
    });

    saveBtn.insertAdjacentElement('afterend', btn);
  }

  // --- SPA-aware wiring ---
  // LinkedIn is a React SPA. When you click a job in search results the right
  // panel re-renders but there's no page navigation, so we need two signals:
  //   1. MutationObserver – catches the Save button being added/removed in the DOM
  //   2. URL polling – catches the currentJobId changing so we reset the button
  //      even when React reuses the same DOM node for the save button

  let lastJobId = null;

  function syncButton() {
    const saveBtn = document.querySelector('.jobs-save-button');
    const ourBtn  = document.getElementById(BTN_ID);
    const jobId   = getJobId();

    // Job changed — remove stale button so we re-inject fresh
    if (ourBtn && jobId !== lastJobId) {
      ourBtn.remove();
    }

    if (saveBtn && !document.getElementById(BTN_ID)) {
      lastJobId = jobId;
      injectButton(saveBtn);
    } else if (!saveBtn && ourBtn) {
      ourBtn.remove();
    }
  }

  const observer = new MutationObserver(syncButton);
  observer.observe(document.body, { childList: true, subtree: true });

  // Poll for URL changes (popstate isn't reliable for pushState SPAs)
  setInterval(() => {
    if (getJobId() !== lastJobId) syncButton();
  }, 500);

  syncButton();
})();
