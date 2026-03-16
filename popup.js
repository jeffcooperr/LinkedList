// Popup reads jobs stored by the content script via localStorage on the LinkedIn tab.
// We inject a script into the active tab to pull the data out.

async function getJobs() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes('linkedin.com')) return [];

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => JSON.parse(localStorage.getItem('jt-jobs') || '[]'),
  });
  return results?.[0]?.result || [];
}

async function saveJobs(jobs) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (data) => localStorage.setItem('jt-jobs', JSON.stringify(data)),
    args: [jobs],
  });
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function renderJobs(jobs) {
  const listEl = document.getElementById('job-list');
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
    <div class="job-card" data-index="${i}">
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
      const current = await getJobs();
      current.splice(idx, 1);
      await saveJobs(current);
      renderJobs(current);
    });
  });
}

function esc(str = '') {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.getElementById('export-json-btn').addEventListener('click', async () => {
  const jobs = await getJobs();
  download('jobs.json', JSON.stringify(jobs, null, 2), 'application/json');
});

document.getElementById('export-csv-btn').addEventListener('click', async () => {
  const jobs = await getJobs();
  const header = 'Title,Company,Location,Link,Saved At';
  const rows = jobs.map(j =>
    [j.title, j.company, j.location, j.link, j.savedAt]
      .map(v => `"${(v || '').replace(/"/g, '""')}"`)
      .join(',')
  );
  download('jobs.csv', [header, ...rows].join('\n'), 'text/csv');
});

document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!confirm('Remove all tracked jobs?')) return;
  await saveJobs([]);
  renderJobs([]);
});

// Initial load
getJobs().then(renderJobs);
