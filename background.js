const SHEET_TITLE = 'LinkedList';
const SHEET_HEADERS = ['Status', 'Position', 'Company', 'Location', 'Posted & Applicants (when tracked)', 'Notes'];

// ── Local job status sync ─────────────────────────────────────────────────────

async function updateLocalJobStatus(company, status, title) {
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  const needle      = company.toLowerCase();
  const titleNeedle = (title || '').toLowerCase();
  const updated = jobs.map(j => {
    const jc = (j.company || '').toLowerCase();
    if (jc !== needle && !jc.includes(needle) && !needle.includes(jc)) return j;
    if (titleNeedle) {
      const jt = (j.title || '').toLowerCase();
      if (!jt.includes(titleNeedle) && !titleNeedle.includes(jt)) return j;
    }
    return { ...j, status };
  });
  await chrome.storage.local.set({ jobs: updated });
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function updateBadge(unresolvedCount, unseenCount) {
  if (unresolvedCount > 0) {
    chrome.action.setBadgeText({ text: String(unresolvedCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  } else if (unseenCount > 0) {
    chrome.action.setBadgeText({ text: String(unseenCount) });
    chrome.action.setBadgeBackgroundColor({ color: '#2563eb' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.unresolvedEvents || changes.unseenEmailCount) {
    chrome.storage.local.get(['unresolvedEvents', 'unseenEmailCount'], ({ unresolvedEvents = [], unseenEmailCount = 0 }) => {
      updateBadge(unresolvedEvents.length, unseenEmailCount);
    });
  }
});

function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(token);
    });
  });
}

async function createSheet(token) {
  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: SHEET_TITLE } }),
  });
  const spreadsheet = await createRes.json();
  const spreadsheetId = spreadsheet.spreadsheetId;
  const sheetId = spreadsheet.sheets[0].properties.sheetId;

  // Write header row
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=RAW`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [SHEET_HEADERS] }),
    }
  );

  const colWidths = [130, 350, 250, 200, 300, 160]; // Status, Position, Company, Location, Posted & Applicants (when tracked), Notes

  // Status conditional format rules: [value, bgColor, textColor]
  const statusFormats = [
    ['Saved',        { red: 0.93, green: 0.93, blue: 0.93 }, { red: 0.30, green: 0.30, blue: 0.30 }],
    ['Applied',      { red: 0.91, green: 0.94, blue: 0.99 }, { red: 0.10, green: 0.45, blue: 0.91 }],
    ['Phone Screen', { red: 0.95, green: 0.91, blue: 0.99 }, { red: 0.58, green: 0.20, blue: 0.90 }],
    ['Interviewing', { red: 0.99, green: 0.95, blue: 0.80 }, { red: 0.76, green: 0.49, blue: 0.00 }],
    ['Offer',        { red: 0.90, green: 0.96, blue: 0.91 }, { red: 0.12, green: 0.56, blue: 0.24 }],
    ['Rejected',     { red: 0.99, green: 0.91, blue: 0.90 }, { red: 0.85, green: 0.19, blue: 0.15 }],
  ];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        // Header row: blue background, white bold text, centered
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.04, green: 0.40, blue: 0.76 },
                textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 }, fontSize: 11 },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
          },
        },
        // Freeze header row + hide gridlines
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1, hideGridlines: true } },
            fields: 'gridProperties.frozenRowCount,gridProperties.hideGridlines',
          },
        },
        // Tab color
        {
          updateSheetProperties: {
            properties: { sheetId, tabColorStyle: { rgbColor: { red: 0.04, green: 0.40, blue: 0.76 } } },
            fields: 'tabColorStyle',
          },
        },
        // Column widths
        ...colWidths.map((pixelSize, i) => ({
          updateDimensionProperties: {
            range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
            properties: { pixelSize },
            fields: 'pixelSize',
          },
        })),
        // Alternating row colors for data rows
        {
          addBanding: {
            bandedRange: {
              range: { sheetId, startRowIndex: 1, endColumnIndex: 6 },
              rowProperties: {
                firstBandColor: { red: 1, green: 1, blue: 1 },
                secondBandColor: { red: 0.97, green: 0.97, blue: 0.98 },
              },
            },
          },
        },
        // Status dropdown
        {
          setDataValidation: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 1 },
            rule: {
              condition: {
                type: 'ONE_OF_LIST',
                values: statusFormats.map(([v]) => ({ userEnteredValue: v })),
              },
              showCustomUi: true,
              strict: false,
            },
          },
        },
        // Conditional formatting per status value
        ...statusFormats.map(([value, bg, fg], index) => ({
          addConditionalFormatRule: {
            rule: {
              ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }],
              booleanRule: {
                condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
                format: {
                  backgroundColor: bg,
                  textFormat: { foregroundColor: fg, bold: true },
                },
              },
            },
            index,
          },
        })),
        // Header row height
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 },
            properties: { pixelSize: 42 },
            fields: 'pixelSize',
          },
        },
        // Data row height
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: 'ROWS', startIndex: 1 },
            properties: { pixelSize: 36 },
            fields: 'pixelSize',
          },
        },
        // All data cells: vertical center, clip text, font size 11, center aligned
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
            cell: {
              userEnteredFormat: {
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'CLIP',
                textFormat: { fontSize: 11 },
                horizontalAlignment: 'CENTER',
              },
            },
            fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat,horizontalAlignment)',
          },
        },
        // Status column: center aligned
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
            fields: 'userEnteredFormat(horizontalAlignment)',
          },
        },
        // Last column: center aligned
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 4, endColumnIndex: 6 },
            cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
            fields: 'userEnteredFormat(horizontalAlignment)',
          },
        },
        // Thick bottom border under header
        {
          updateBorders: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
            bottom: { style: 'SOLID_MEDIUM', color: { red: 0.02, green: 0.28, blue: 0.58 } },
          },
        },
        // Subtle horizontal borders between data rows
        {
          updateBorders: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 6 },
            bottom: { style: 'SOLID', color: { red: 0.88, green: 0.88, blue: 0.90 } },
          },
        },
        // Notes column: left aligned
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 },
            cell: { userEnteredFormat: { horizontalAlignment: 'LEFT' } },
            fields: 'userEnteredFormat(horizontalAlignment)',
          },
        },
        // Bold company names
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat(textFormat)',
          },
        },
      ],
    }),
  });

  return spreadsheetId;
}

async function appendRow(token, spreadsheetId, job) {
  const row = [
    'Saved',
    `=HYPERLINK("${job.link}","${(job.title || '').replace(/"/g, '""')}")`,
    job.company || '',
    job.location || '',
    [job.date_posted, job.applicants].filter(Boolean).join(' · '),
    '',
  ];
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    }
  );
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Sheets error ${res.status}`);
  }
}

// ── Email classification ──────────────────────────────────────────────────────

const VALID_STATUSES = ['Applied', 'Interviewing', 'Phone Screen', 'Offer', 'Rejected'];

const CLASSIFY_URL = 'https://linkedlist-proxy.vercel.app/api/classify';

async function classifyEmail(subject, snippet) {
  try {
    const res = await fetch(CLASSIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, snippet }),
    });
    if (!res.ok) { console.log('[classify] HTTP error', res.status); return null; }
    const { text } = await res.json();
    console.log('[classify] subject:', subject, '| snippet:', snippet, '| gemini raw:', JSON.stringify(text));
    if (!text || text === 'null') return null;
    const parts = text.split('|');
    const status  = parts[0].trim();
    const company = (parts[1] || '').trim();
    const title   = (parts[2] || '').trim();
    return VALID_STATUSES.includes(status) ? { status, company, title } : null;
  } catch (err) {
    console.log('[classify] error:', err);
    return null;
  }
}

function senderName(from) {
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.replace(/<[^>]+>/, '').trim();
}

function extractCompany(subject, from) {
  // LinkedIn application emails: "Your application was sent to Acme Corp"
  const m = subject.match(/sent to (.+)$/i);
  if (m) return m[1].trim();
  return senderName(from);
}

async function updateJobStatus(token, spreadsheetId, company, status, title = '') {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:C`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return { updated: false, ambiguous: false };
  const { values = [] } = await res.json();

  const needle = company.toLowerCase();
  const companyMatches = [];
  for (let i = values.length - 1; i >= 1; i--) {
    const cell = (values[i][2] || '').toLowerCase();
    if (cell === needle || cell.includes(needle) || needle.includes(cell)) companyMatches.push(i + 1);
  }
  if (companyMatches.length === 0) return { updated: false, ambiguous: false };

  let matchRow = -1;
  if (companyMatches.length === 1) {
    matchRow = companyMatches[0];
  } else if (title) {
    const titleNeedle = title.toLowerCase();
    for (const rowNum of companyMatches) {
      const cellTitle = (values[rowNum - 1][1] || '').toLowerCase();
      if (cellTitle.includes(titleNeedle) || titleNeedle.includes(cellTitle)) { matchRow = rowNum; break; }
    }
    if (matchRow === -1) return { updated: false, ambiguous: true };
  } else {
    return { updated: false, ambiguous: true };
  }

  const upd = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A${matchRow}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[status]] }),
    }
  );
  return { updated: upd.ok, ambiguous: false };
}

async function checkGmail(token) {
  const stored = await chrome.storage.local.get(['gmailHistoryId', 'seenEmailIds', 'seenThreadStatuses', 'emailEvents', 'spreadsheetId', 'unresolvedEvents']);
  const seenEmailIds       = stored.seenEmailIds       || [];
  const seenThreadStatuses = new Set(stored.seenThreadStatuses || []);
  const emailEvents        = stored.emailEvents        || [];
  const unresolvedEvents   = stored.unresolvedEvents   || [];

  // First run — capture current historyId as baseline, process nothing
  if (!stored.gmailHistoryId) {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Gmail ${res.status}`);
    const { historyId } = await res.json();
    await chrome.storage.local.set({ gmailHistoryId: historyId });
    return;
  }

  const histRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${stored.gmailHistoryId}&historyTypes=messageAdded&labelId=INBOX`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!histRes.ok) {
    if (histRes.status === 404) await chrome.storage.local.remove('gmailHistoryId'); // too old, reset
    return;
  }

  const history = await histRes.json();
  if (history.historyId) await chrome.storage.local.set({ gmailHistoryId: history.historyId });
  if (!history.history?.length) return;

  const newIds = [];
  for (const record of history.history) {
    for (const { message } of record.messagesAdded || []) {
      if (!seenEmailIds.includes(message.id)) newIds.push(message.id);
    }
  }
  if (!newIds.length) return;

  // Mark as seen immediately so concurrent runs don't reprocess the same emails
  await chrome.storage.local.set({ seenEmailIds: [...seenEmailIds, ...newIds].slice(-500) });

  const newEvents = [];
  const newUnresolved = [];
  for (const id of newIds) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!msgRes.ok) continue;
    const msg = await msgRes.json();
    const headers = msg.payload?.headers || [];
    const subject = headers.find(h => h.name === 'Subject')?.value || '';
    const from    = headers.find(h => h.name === 'From')?.value    || '';
    if (/jobalerts-noreply@linkedin\.com/i.test(from)) continue;
    const result = await classifyEmail(subject, msg.snippet || '');
    if (!result) continue;
    const { status, company: aiCompany, title: aiTitle } = result;
    const threadKey = `${msg.threadId}|${status}`;
    if (seenThreadStatuses.has(threadKey)) continue;
    seenThreadStatuses.add(threadKey);
    const company = aiCompany || extractCompany(subject, from);
    const title   = aiTitle   || '';
    let sheetUpdated = false;
    if (stored.spreadsheetId) {
      const updateResult = await updateJobStatus(token, stored.spreadsheetId, company, status, title);
      if (updateResult.ambiguous) {
        newUnresolved.push({ id, threadId: msg.threadId, company, title, subject, status, receivedAt: new Date().toISOString() });
        continue;
      }
      sheetUpdated = updateResult.updated;
      if (sheetUpdated) await updateLocalJobStatus(company, status, title);
    }
    newEvents.push({ id, threadId: msg.threadId, company, title, subject, status, receivedAt: new Date().toISOString(), sheetUpdated });
  }

  await chrome.storage.local.set({ seenThreadStatuses: [...seenThreadStatuses] });
  if (newEvents.length) {
    const { unseenEmailCount = 0 } = await chrome.storage.local.get('unseenEmailCount');
    await chrome.storage.local.set({
      emailEvents: [...newEvents, ...emailEvents].slice(0, 50),
      unseenEmailCount: unseenEmailCount + newEvents.length,
    });
  }
  if (newUnresolved.length) {
    await chrome.storage.local.set({ unresolvedEvents: [...newUnresolved, ...unresolvedEvents].slice(0, 50) });
  }
}

// ── Alarms ────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('checkEmail', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'checkEmail') return;
  try {
    const { gmailEnabled } = await chrome.storage.local.get('gmailEnabled');
    if (!gmailEnabled) return;
    const token = await getToken(false);
    await checkGmail(token);
  } catch {}
});

// ── LinkedIn navigation ───────────────────────────────────────────────────────

chrome.webNavigation.onHistoryStateUpdated.addListener(
  (details) => chrome.tabs.sendMessage(details.tabId, { type: 'SYNC_BUTTON' }).catch(() => {}),
  { url: [{ hostEquals: 'www.linkedin.com' }] }
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'TRACK_JOB') {
    (async () => {
      try {
        const token = await getToken(false);

        const stored = await chrome.storage.local.get('spreadsheetId');
        let { spreadsheetId } = stored;
        if (!spreadsheetId) {
          spreadsheetId = await createSheet(token);
          await chrome.storage.local.set({ spreadsheetId });
        }

        const { jobs = [] } = await chrome.storage.local.get('jobs');
        if (!jobs.find(j => j.link === message.payload.link)) {
          await appendRow(token, spreadsheetId, message.payload);
          jobs.unshift({ ...message.payload, savedAt: message.payload.date_saved, status: 'Saved' });
          await chrome.storage.local.set({ jobs });
        }

        sendResponse({ ok: true });
      } catch (err) {
        const notSignedIn =
          err.message.includes('not granted') ||
          err.message.includes('revoked') ||
          err.message.includes('OAuth') ||
          err.message.includes('interactive');
        sendResponse({ ok: false, error: notSignedIn ? 'not_signed_in' : err.message });
      }
    })();
    return true;
  }

  if (message.type === 'ASSIGN_EMAIL_EVENT') {
    (async () => {
      try {
        const token = await getToken(false);
        const { spreadsheetId, unresolvedEvents = [], emailEvents = [] } =
          await chrome.storage.local.get(['spreadsheetId', 'unresolvedEvents', 'emailEvents']);
        if (!spreadsheetId) { sendResponse({ ok: false }); return; }

        const { event, jobTitle, jobCompany } = message.payload;
        const result = await updateJobStatus(token, spreadsheetId, jobCompany, event.status, jobTitle);
        if (result.updated) await updateLocalJobStatus(jobCompany, event.status, jobTitle);

        await chrome.storage.local.set({
          unresolvedEvents: unresolvedEvents.filter(e => e.id !== event.id),
          emailEvents: [{ ...event, sheetUpdated: result.updated }, ...emailEvents].slice(0, 50),
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
});
