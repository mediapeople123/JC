# DG Jesus Church — Push Notification System

A lightweight web app that lets church members register their devices for targeted push notifications, with Airtable as the database and Netlify as the hosting and backend platform.

---

## 1. Architecture Overview

```
Browser (HTML/CSS/JS)
    │ 1. User enters name or email
    │ 2. App calls /api/find-user → matches person in Airtable
    │ 3. User taps "Enable Notifications"
    │ 4. Browser asks for permission → creates PushSubscription
    │ 5. App calls /api/subscribe-user → saved in Airtable
    ▼
Netlify Functions (Node 18, ES Modules)
    ├── config.js           → Returns VAPID public key to the frontend
    ├── find-user.js        → Searches People table
    ├── subscribe-user.js   → Saves/updates Subscriptions table
    └── send-notification.js → Receives Airtable webhook, sends push

Airtable (database)
    ├── People              → Church members
    ├── Groups              → DG groups with assigned leader
    ├── Subscriptions       → Device push subscriptions
    └── Notifications       → Audit log of every push sent

Airtable Automations
    └── Trigger (e.g. record update) → Webhook → send-notification.js
```

---

## 2. Airtable Schema

Create these four tables in the base named **DG Jesus Church**.

### People

| Field name   | Type            | Notes                                |
|--------------|-----------------|--------------------------------------|
| Name         | Single line text | **Title field**                     |
| First Name   | Single line text |                                      |
| Email        | Email           | Used for login lookup                |
| Group        | Link to Groups  | Multiple groups allowed              |
| Is Leader    | Checkbox        | ✓ if this person leads a DG          |
| Active       | Checkbox        | Uncheck to deactivate without deleting |

### Groups

| Field name   | Type            | Notes                                |
|--------------|-----------------|--------------------------------------|
| Group ID     | Single line text | **Title field** — internal slug, e.g. `grp_west_01` |
| Group Name   | Single line text | Display label, e.g. "West Side English" |
| Language     | Single select   | e.g. English, Mandarin, Bahasa       |
| Address      | Single line text |                                      |
| Postal Code  | Single line text |                                      |
| Age Group    | Single select   | e.g. Young Adults, Families          |
| Leader       | Link to People  | The one person who receives notifications |
| Active       | Checkbox        |                                      |

### Subscriptions

| Field name   | Type            | Notes                                |
|--------------|-----------------|--------------------------------------|
| Subscription ID | Auto number  | **Title field** (auto)              |
| Person       | Link to People  |                                      |
| Group        | Link to Groups  | Primary group (optional)             |
| Endpoint     | URL             | Push endpoint from browser           |
| P256DH       | Long text       | Encryption key                       |
| Auth         | Single line text | Auth secret                         |
| Device Name  | Single line text | e.g. "iPhone", "Windows PC"         |
| User Agent   | Long text       | Full browser UA string               |
| Active       | Checkbox        | Unchecked automatically when expired |
| Last Seen At | Date (+ time)   |                                      |

### Notifications

| Field name   | Type            | Notes                                |
|--------------|-----------------|--------------------------------------|
| Notification ID | Auto number  | **Title field** (auto)              |
| Title        | Single line text |                                      |
| Body         | Long text       |                                      |
| Target Type  | Single select   | group / person / multiple_groups     |
| Target Value | Single line text | Group ID, email, or comma-separated list |
| URL          | URL             | Opens when notification tapped       |
| Status       | Single select   | Sent / Failed / Partial              |
| Sent At      | Date (+ time)   |                                      |
| Sent Count   | Number          |                                      |
| Error Log    | Long text       | First 5 errors (if any)             |

---

## 3. Folder Structure

```
dg-jesus-church/
├── public/
│   ├── index.html          ← Registration page
│   ├── styles.css          ← All styles
│   ├── app.js              ← Registration flow JS
│   └── service-worker.js   ← Push receiver & cache
├── netlify/
│   └── functions/
│       ├── _airtable.js    ← Shared Airtable REST helper (not a function)
│       ├── config.js       ← GET  /api/config
│       ├── find-user.js    ← GET  /api/find-user
│       ├── subscribe-user.js ← POST /api/subscribe-user
│       └── send-notification.js ← POST /api/send-notification
├── package.json
├── netlify.toml
└── README.md
```

---

## 4. Environment Variables

Set these in **Netlify → Site → Environment variables**:

| Variable           | Description                                          |
|--------------------|------------------------------------------------------|
| `AIRTABLE_TOKEN`   | Your Airtable Personal Access Token                  |
| `AIRTABLE_BASE_ID` | Base ID starting with `app…` (from base URL)         |
| `VAPID_PUBLIC_KEY` | VAPID public key (base64url)                         |
| `VAPID_PRIVATE_KEY`| VAPID private key (base64url) — keep secret          |
| `WEBHOOK_SECRET`   | A strong random string you choose (min 32 chars)     |
| `SITE_URL`         | Your Netlify URL, e.g. `https://dg-church.netlify.app` |

---

## 5. Generating VAPID Keys

Run this once locally (requires Node 18+):

```bash
npm install web-push
node -e "
const wp = require('web-push');
const keys = wp.generateVAPIDKeys();
console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
"
```

Copy both values into your Netlify environment variables.

---

## 6. Airtable Automation — Webhook Setup

In Airtable, create an **Automation** for each trigger you want:

**Example: Notify a group leader every Sunday evening**

1. Trigger: **Scheduled time** → Weekly, Sunday 7:00 PM (your timezone)
2. Action: **Run script** (or **Send webhook**)
   - URL: `https://your-site.netlify.app/api/send-notification`
   - Method: `POST`
   - Headers:
     ```
     Content-Type: application/json
     X-Webhook-Secret: <your WEBHOOK_SECRET>
     ```
   - Body:
     ```json
     {
       "title": "DG Weekly Report",
       "body": "Please send your weekly DG report by tonight.",
       "targetType": "group",
       "targetValue": "grp_west_01",
       "url": "https://your-site.netlify.app"
     }
     ```

### Target types

| targetType        | targetValue format                      | Who gets notified              |
|-------------------|-----------------------------------------|--------------------------------|
| `group`           | `"grp_west_01"` (Group ID field value) | Leader of that DG group        |
| `person`          | `"rec…"` (Airtable record ID)          | That specific person           |
| `person`          | `"john@example.com"` (email)           | Person with that email         |
| `multiple_groups` | `["grp_a", "grp_b"]` or `"grp_a,grp_b"` | Leaders of all listed groups |

---

## 7. Deployment Steps

### First time

```bash
# 1. Clone / copy this project folder
cd dg-jesus-church

# 2. Install dependencies
npm install

# 3. Login to Netlify CLI (first time only)
npx netlify login

# 4. Create a new Netlify site
npx netlify init

# 5. Set environment variables (or set via Netlify dashboard)
npx netlify env:set AIRTABLE_TOKEN       "your_token"
npx netlify env:set AIRTABLE_BASE_ID     "appXXXXXXXXXXXXXX"
npx netlify env:set VAPID_PUBLIC_KEY     "your_vapid_public_key"
npx netlify env:set VAPID_PRIVATE_KEY    "your_vapid_private_key"
npx netlify env:set WEBHOOK_SECRET       "your_random_secret_string"
npx netlify env:set SITE_URL             "https://your-site.netlify.app"

# 6. Deploy
npx netlify deploy --prod
```

### Local development

```bash
npm run dev
# Opens at http://localhost:8888
# Functions available at http://localhost:8888/api/*
```

> Push notifications require HTTPS, so they won't fully work on localhost.
> Use `netlify dev --live` to get an HTTPS tunnel for testing.

### Subsequent deploys

Push to your linked Git repository (Netlify auto-deploys on merge to main),
or run `npx netlify deploy --prod` manually.

---

## 8. Optional: Add App Icons

Place these files in `/public/` for a polished experience:

- `icon-192.png` — 192×192 app icon (shown in notification)
- `badge-96.png` — 96×96 monochrome icon (shown in status bar on Android)

---

## 9. Limitations & Future Improvements

**Current limitations:**

- iOS Safari requires iOS 16.4+ AND the site must be saved to the Home Screen for push to work.
- If a user's browser clears its push subscription (some browsers do this after ~60 days of inactivity), they need to re-register on this page.
- The `pushsubscriptionchange` service worker event is not yet handled — re-subscription after key rotation requires the user to visit the page again.
- Only the first group linked to a person is saved in Subscriptions (multi-group linking is a future improvement).
- No admin panel — notifications are triggered entirely through Airtable Automations.

**Potential improvements:**

- Add a `/admin` page (password-protected) to send ad-hoc notifications without needing Airtable.
- Store `personId` in service worker `pushsubscriptionchange` so re-subscription can be done silently.
- Add a `GET /api/check-subscription` endpoint so returning users see their status without re-registering.
- Support multiple groups per subscription record.
- Add notification delivery receipts via Airtable field updates.
- Rate limit the `send-notification` endpoint.
- Use Netlify's scheduled functions instead of Airtable Automations for timed sends.
