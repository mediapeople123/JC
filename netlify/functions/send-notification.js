/**
 * POST /api/send-notification
 *
 * Receives a webhook from Airtable Automations, resolves the target
 * (group leader or specific person), fetches their active device
 * subscriptions, and sends the push notification via web-push.
 *
 * Security: validated by X-Webhook-Secret header.
 *
 * Expected body:
 * {
 *   title:       string,
 *   body:        string,
 *   targetType:  "group" | "person" | "multiple_groups",
 *   targetValue: string | string[],   // group ID, person record ID / email, or array of group IDs
 *   url:         string               // optional — URL to open on notification click
 * }
 */
import webpush from 'web-push';
import { findRecords, createRecord, updateRecord, sanitize } from './_airtable.js';

// ── VAPID setup ───────────────────────────────────────────────────────────────
// Done lazily so cold-start errors are surfaced clearly in logs.
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

// ── Airtable helpers ──────────────────────────────────────────────────────────

/**
 * Get ALL member person record IDs for a group (by its Group ID field value).
 *
 * IMPORTANT: ARRAYJOIN({LinkedField}) in Airtable filter formulas returns
 * display names, not record IDs. We therefore fetch active people with their
 * Group field and filter by record ID in JavaScript, where linked fields are
 * correctly returned as arrays of record IDs.
 */
async function getPersonIdsForGroup(groupId) {
  // Step 1: find the group's Airtable record ID by its Group ID text field
  const { records: groupRecords = [] } = await findRecords(
    'Groups',
    `{Group ID} = "${sanitize(groupId)}"`,
    ['Name'],
    1
  );

  if (groupRecords.length === 0) {
    console.warn(`[send-notification] Group not found for Group ID: "${groupId}"`);
    return [];
  }

  const groupRecordId = groupRecords[0].id;
  console.log(`[send-notification] Group "${groupId}" → record ${groupRecordId}`);

  // Step 2: fetch all active people, then filter by group record ID in JS.
  // The 'Group' linked field in the API response returns an array of record IDs.
  const { records: people = [] } = await findRecords(
    'People',
    `{Active}`,
    ['Name', 'Group'],
    500
  );

  const matched = people.filter(r =>
    Array.isArray(r.fields['Group']) && r.fields['Group'].includes(groupRecordId)
  );

  console.log(`[send-notification] Found ${matched.length} members in group "${groupId}"`);
  return matched.map(r => r.id);
}

/**
 * Get all active push subscriptions for a person (by their Airtable record ID).
 *
 * Same linked-field caveat: fetch all active subscriptions and filter by
 * Person record ID in JavaScript rather than in the Airtable formula.
 */
async function getActiveSubscriptions(personRecordId) {
  const { records = [] } = await findRecords(
    'Subscriptions',
    `{Active}`,
    ['Endpoint', 'P256DH', 'Auth', 'Device Name', 'Person'],
    500
  );

  const matched = records.filter(r =>
    Array.isArray(r.fields['Person']) && r.fields['Person'].includes(personRecordId)
  );

  console.log(`[send-notification] Person ${personRecordId} has ${matched.length} active subscription(s)`);
  return matched;
}

/** Send a single push notification; mark subscription inactive if it has expired. */
async function sendPush(subRecord, payload) {
  const pushSub = {
    endpoint: subRecord.fields['Endpoint'],
    keys: {
      p256dh: subRecord.fields['P256DH'],
      auth: subRecord.fields['Auth'],
    },
  };

  try {
    await webpush.sendNotification(pushSub, JSON.stringify(payload), { TTL: 3600 });
    return { success: true };
  } catch (err) {
    // 410 Gone / 404 Not Found → subscription is no longer valid
    if (err.statusCode === 410 || err.statusCode === 404) {
      await updateRecord('Subscriptions', subRecord.id, { Active: false }).catch(() => {});
      return { success: false, expired: true };
    }
    console.error('[send-notification] push error', err.statusCode, err.body);
    return { success: false, error: String(err.message || err.body || 'Unknown push error') };
  }
}

/** Resolve targetType + targetValue to a deduplicated list of person record IDs. */
async function resolvePersonIds(targetType, targetValue) {
  const ids = new Set();

  if (targetType === 'person') {
    if (String(targetValue).startsWith('rec')) {
      // Airtable record ID provided directly
      ids.add(targetValue);
    } else {
      // Treat as email address
      const { records = [] } = await findRecords(
        'People',
        `LOWER({Email}) = LOWER("${sanitize(targetValue)}")`
      );
      records.forEach(r => ids.add(r.id));
    }

  } else if (targetType === 'group') {
    // Notify ALL members of the group (not just the leader)
    const personIds = await getPersonIdsForGroup(String(targetValue));
    personIds.forEach(id => ids.add(id));

  } else if (targetType === 'multiple_groups') {
    // Notify ALL members across all specified groups
    const groups = Array.isArray(targetValue)
      ? targetValue
      : String(targetValue).split(',').map(s => s.trim()).filter(Boolean);

    console.log(`[send-notification] Resolving ${groups.length} group(s):`, groups);

    for (const gId of groups) {
      const personIds = await getPersonIdsForGroup(gId);
      personIds.forEach(id => ids.add(id));
    }
  }

  console.log(`[send-notification] Total unique people to notify: ${ids.size}`);
  return [...ids];
}

// ── Handler ───────────────────────────────────────────────────────────────────
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Validate webhook secret
  const providedSecret = event.headers['x-webhook-secret'] || event.headers['X-Webhook-Secret'];
  if (!providedSecret || providedSecret !== process.env.WEBHOOK_SECRET) {
    console.warn('[send-notification] Rejected — bad webhook secret');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let parsed;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { title, body, targetType, targetValue, url } = parsed;

  if (!title || !targetType || targetValue == null) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'title, targetType, and targetValue are required.' }),
    };
  }

  ensureVapid();

  const payload = {
    title,
    body: body || '',
    url: url || process.env.SITE_URL || '',
  };

  let sentCount = 0;
  let failCount = 0;
  const errors = [];

  try {
    const personIds = await resolvePersonIds(targetType, targetValue);

    if (personIds.length === 0) {
      console.warn('[send-notification] No targets resolved for', targetType, targetValue);
      return {
        statusCode: 200,
        body: JSON.stringify({ sent: 0, failed: 0, message: 'No targets found.' }),
      };
    }

    for (const personId of personIds) {
      const subs = await getActiveSubscriptions(personId);
      for (const sub of subs) {
        const result = await sendPush(sub, payload);
        if (result.success) sentCount++;
        else {
          failCount++;
          if (result.error) errors.push(result.error);
        }
      }
    }

    // Log to Notifications table for audit trail
    await createRecord('Notifications', {
      Title: title,
      Body: body || '',
      'Target Type': targetType,
      'Target Value': Array.isArray(targetValue) ? targetValue.join(', ') : String(targetValue),
      URL: url || process.env.SITE_URL || '',
      Status: failCount === 0 ? 'Sent' : sentCount === 0 ? 'Failed' : 'Partial',
      'Sent At': new Date().toISOString(),
      'Sent Count': sentCount,
      'Error Log': errors.slice(0, 5).join('\n'),
    }).catch(e => console.error('[send-notification] Failed to log:', e.message));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent: sentCount, failed: failCount }),
    };
  } catch (err) {
    console.error('[send-notification] Unexpected error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
