/**
 * POST /api/ask-leader
 *
 * Saves a question / support request from a DG leader to the "Leader Questions"
 * table in Airtable and sends a push notification to the configured overseer.
 *
 * Security: uses the same webhook-secret header as send-notification.
 *
 * Expected body:
 * {
 *   personId:      string,   // Airtable record ID of the person asking
 *   personName:    string,   // Display name (for the notification)
 *   groupName:     string,   // Group name (for context)
 *   groupRecordId: string,   // Airtable record ID of the group
 *   message:       string    // The question / support request text
 * }
 *
 * Env vars needed:
 *   OVERSEER_PERSON_ID  — Airtable record ID of the pastor / overseer to notify
 *                         (or comma-separated list of IDs)
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SITE_URL (standard push env vars)
 */
import webpush from 'web-push';
import { createRecord, findRecords } from './_airtable.js';

let vapidReady = false;
function ensureVapid() {
  if (vapidReady) return;
  const siteUrl = process.env.SITE_URL || 'https://example.netlify.app';
  webpush.setVapidDetails(
    `mailto:admin@${new URL(siteUrl).hostname}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  vapidReady = true;
}

async function getActiveSubscriptions(personRecordId) {
  const { records = [] } = await findRecords(
    'Subscriptions',
    `{Active}`,
    ['Endpoint', 'P256DH', 'Auth', 'Device Name', 'Person'],
    500
  );
  return records.filter(r =>
    Array.isArray(r.fields['Person']) && r.fields['Person'].includes(personRecordId)
  );
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { personId, personName, groupName, groupRecordId, message } = body;

  if (!message || !message.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'message is required.' }) };
  }

  try {
    // 1. Save to Airtable "Leader Questions" table
    const questionFields = {
      'Message': message.trim(),
      'Status': 'New',
      'Submitted At': new Date().toISOString(),
    };
    if (personId)      questionFields['Person']  = [personId];
    if (groupRecordId) questionFields['Group']   = [groupRecordId];
    if (personName)    questionFields['From']    = personName;
    if (groupName)     questionFields['Group Name'] = groupName;

    await createRecord('Leader Questions', questionFields).catch(err => {
      console.warn('[ask-leader] Could not save to Leader Questions table:', err.message);
      // Non-fatal — still try to send the notification
    });

    // 2. Send push notification to the overseer(s)
    const overseerIds = (process.env.OVERSEER_PERSON_ID || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    if (overseerIds.length === 0) {
      console.warn('[ask-leader] OVERSEER_PERSON_ID not configured — skipping push notification.');
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saved: true, notified: 0, warning: 'OVERSEER_PERSON_ID not set' }),
      };
    }

    ensureVapid();

    const notifPayload = JSON.stringify({
      title: `💬 Question from ${personName || 'a leader'}`,
      body: message.trim().substring(0, 120) + (message.trim().length > 120 ? '…' : ''),
      url: process.env.SITE_URL || '/',
    });

    let sentCount = 0;
    for (const overseerPersonId of overseerIds) {
      const subs = await getActiveSubscriptions(overseerPersonId);
      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.fields['Endpoint'],
              keys: { p256dh: sub.fields['P256DH'], auth: sub.fields['Auth'] },
            },
            notifPayload,
            { TTL: 3600 }
          );
          sentCount++;
        } catch (pushErr) {
          console.error('[ask-leader] push error', pushErr.statusCode, pushErr.message);
        }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saved: true, notified: sentCount }),
    };
  } catch (err) {
    console.error('[ask-leader]', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
