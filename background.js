const SHEET_TITLE = 'LinkedList';
const SHEET_HEADERS = ['Title', 'Company', 'Location', 'Link', 'Date Saved', 'Status'];

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

  const colWidths = [280, 180, 150, 280, 130, 130]; // Title, Company, Location, Link, Date Saved, Status

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
        // Freeze header row
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
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
            range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 5, endColumnIndex: 6 },
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
              ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6 }],
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
      ],
    }),
  });

  return spreadsheetId;
}

async function appendRow(token, spreadsheetId, job) {
  const row = [
    job.title,
    job.company,
    job.location || '',
    job.link,
    job.date_saved || '',
    'Saved',
  ];
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
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
    console.log('[classify] subject:', subject, '| gemini raw:', JSON.stringify(text));
    if (!text || text === 'null') return null;
    const [status, ...rest] = text.split('|');
    const company = rest.join('|').trim();
    return VALID_STATUSES.includes(status.trim()) ? { status: status.trim(), company } : null;
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

async function updateJobStatus(token, spreadsheetId, company, status) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A:F`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return false;
  const { values = [] } = await res.json();

  const needle = company.toLowerCase();
  let matchRow = -1;
  for (let i = values.length - 1; i >= 1; i--) {
    if ((values[i][1] || '').toLowerCase() === needle) { matchRow = i + 1; break; }
  }
  if (matchRow === -1) return false;

  const upd = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!F${matchRow}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[status]] }),
    }
  );
  return upd.ok;
}

async function checkGmail(token) {
  const stored = await chrome.storage.local.get(['gmailHistoryId', 'seenEmailIds', 'emailEvents', 'spreadsheetId']);
  const seenEmailIds = stored.seenEmailIds || [];
  const emailEvents  = stored.emailEvents  || [];

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

  const newEvents = [];
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
    const result = await classifyEmail(subject, msg.snippet || '');
    if (!result) continue;
    const { status, company: aiCompany } = result;
    const company = aiCompany || extractCompany(subject, from);
    let sheetUpdated = false;
    if (stored.spreadsheetId) {
      sheetUpdated = await updateJobStatus(token, stored.spreadsheetId, company, status);
    }
    newEvents.push({ id, company, subject, status, receivedAt: new Date().toISOString(), sheetUpdated });
  }

  await chrome.storage.local.set({
    emailEvents:  [...newEvents, ...emailEvents].slice(0, 50),
    seenEmailIds: [...seenEmailIds, ...newIds].slice(-500),
  });
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
  if (message.type !== 'TRACK_JOB') return;

  (async () => {
    try {
      const token = await getToken(false);

      const stored = await chrome.storage.local.get('spreadsheetId');
      let { spreadsheetId } = stored;
      if (!spreadsheetId) {
        spreadsheetId = await createSheet(token);
        await chrome.storage.local.set({ spreadsheetId });
      }

      await appendRow(token, spreadsheetId, message.payload);

      const { jobs = [] } = await chrome.storage.local.get('jobs');
      if (!jobs.find(j => j.link === message.payload.link)) {
        jobs.unshift({ ...message.payload, savedAt: message.payload.date_saved });
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

  return true; // keep channel open for async response
});
