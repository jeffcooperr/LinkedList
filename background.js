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

  // Bold + blue header, freeze row, auto-resize columns
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.04, green: 0.40, blue: 0.76 },
                textFormat: {
                  bold: true,
                  foregroundColor: { red: 1, green: 1, blue: 1 },
                  fontSize: 11,
                },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 6 },
          },
        },
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
