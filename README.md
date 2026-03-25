# LinkedList

A Chrome extension that adds a **Track** button to LinkedIn job postings and syncs everything to a pre-formatted Google Sheet.

It also monitors your Gmail for application updates (rejections, interview requests, offers) and updates the sheet and extension popup accordingly.

---

## What it does

**On LinkedIn:**
- Injects a Track button next to the Save button on any job posting
- Pulls the job title, company, location, date posted, and applicant count
- One click writes a row to your Google Sheet and adds the job to the popup

**In the popup:**
- Lists all tracked jobs with their current status
- Stats bar showing how many jobs are in each stage
- Email Activity feed showing recent application updates from Gmail
- "Needs Review" queue for emails that matched a company but couldn't be tied to a specific job

**In Gmail (optional):**
- Polls your inbox every minute for job-related emails
- Uses Gemini to classify them: Applied, Phone Screen, Interviewing, Offer, Rejected
- Automatically updates the matching row in your sheet
- Links each email card in the popup back to the Gmail thread

**The Google Sheet:**
- Auto-created on first track, pre-formatted with column widths, frozen header, alternating rows
- Status column has a dropdown and conditional formatting (color changes per status)
- Position column is a hyperlink back to the LinkedIn posting

---

## Demo

![LinkedList demo](LinkedList%20-%20Gif.gif)

---

## Setup

> **Heads up:** This is a personal project. Running it yourself requires setting up your own Google Cloud credentials and deploying your own proxy. It's not a one-click install but if you're comfortable with that kind of setup, it's straightforward.

### 1. Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a new project
2. Enable the **Google Sheets API** and **Gmail API**
3. Go to **APIs & Services → OAuth consent screen** — set it to Internal (or External with yourself as a test user)
4. Go to **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: **Chrome Extension**
   - Add your extension's ID (see step 3 below for how to get it)
5. Copy the client ID

### 2. Deploy the proxy

The extension uses a small serverless function to call Gemini for email classification (so the API key stays server-side).

```
cd linkedlist-proxy
npm install
vercel --prod
```

You'll need:
- A [Vercel](https://vercel.com) account
- A [Gemini API key](https://aistudio.google.com/app/apikey) set as `GEMINI_KEY` in your Vercel environment

The proxy also has optional rate limiting via [Upstash Redis](https://upstash.com). If you want it, create a Redis instance and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel. If you skip it, remove the rate limit block from `api/classify.js`.

After deploying, update the `CLASSIFY_URL` constant in `background.js` and the host permission in `manifest.json` with your Vercel URL.

### 3. Load the extension

1. Open `manifest.json` and replace the `client_id` with the one from step 1
2. Go to `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select this folder
3. Copy the extension ID that appears (looks like `abcdefghijklmnopqrstuvwxyzabcdef`)
4. Go back to your GCP credentials and add that ID to the OAuth client

Sign in via the popup and you're good to go.

---

## Stack

- Chrome MV3 (service worker + content script)
- Google Sheets API & Gmail API
- Gemini 2.5 Flash via a Vercel serverless proxy
- Upstash Redis for rate limiting
- vanilla JS

---

## Notes

- Gmail polling only runs while Chrome is open (MV3 service worker limitation)
- The proxy source is in `linkedlist-proxy/`
- If you make changes to the proxy, run `vercel --prod` again (reloading the extension won't pick them up)
