/**
 * POST /api/check-overdue
 *
 * Called by an Airtable automation (or scheduled trigger) every Wednesday morning.
 * Finds all DG groups that have NOT submitted a report since the most recent
 * Tuesday, then sends a follow-up push notification to their leader(s).
 *
 * Security: validated by X-Webhook-Secret header.
 *
 * Body (optional):
 * {
 *   dryRun: boolean   // if true, returns overdue groups but does NOT send notifications
 * }
 *
 * Env vars needed:
 *   WEBHOOK_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SITE_URL, AIRTABLE_BASE_ID, AIRTABLE_TOKEN
 */
import webpush from 'web-push';
import { findRecords, getRecord } from './_airtable.js';

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

/** Returns the ISO date string for the most recent Tuesday (today if today is Tue). */
function lastTuesdayISO(fromDate = new Date()) {
  const d = new Date(fromDate);
  const day = d.getDay(); // 0=Sun, 2=Tue
  const daysBack = (day - 2 + 7) % 7; // 0 if today is Tue
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

async function getActiveSubscriptionsForPerson(personRecordId) {
  const { records = [] } = await findRecords(
    'Subscriptions',
    `{Active}`,
    ['Endpoint', 'P256DH', 'Auth', 'Person'],
    500
  );
  return records.filter(r =>
    Array.isArray(r.fields['Person']) && r.fields['Person'].includes(personRecordId)
  );
}

async function sendPushToSubs(subs, payload) {
  let sent = 0;
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.fields['Endpoint'],
          keys: { p256dh: sub.fields['P256DH'], auth: sub.fields['Auth'] },
        },
        JSON.stringify(payload),
        { TTL: 86400 } // 24h TTL for follow-up
      );
      sent++;
    } catch (err) {
      console.error('[check-overdue] push error', err.statusCode, err.message);
    }
  }
  return sent;
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Validate webhook secret
  const secret = event.headers['x-webhook-secret'] || event.headers['X-Webhook-Secret'];
  if (!secret || secret !== process.env.WEBHOOK_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let parsed = {};
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch { /* empty body is fine */ }

  const dryRun = Boolean(parsed.dryRun);
  const cutoff = lastTuesdayISO(); // e.g. "2026-03-10"

  console.log(`[check-overdue] Checking for reports since ${cutoff}. dryRun=${dryRun}`);

  try {
    // 1. Get all groups
    const { records: groups = [] } = await findRecords(
      'Groups',
      `NOT({Group Name} = "")`,
      ['Group Name', 'Group ID'],
      200
    );

    // 2. Fetch all reports from this week (date >= cutoff)
    const { records: recentReports = [] } = await findRecords(
      'Reports',
      `IS_AFTER({Date}, "${cutoff}")`,
      ['Date', 'Group'],
      500
    );

    // Build a set of group record IDs that already have a report this week
    const reportedGroupIds = new Set();
    for (const r of recentReports) {
      const groupLinks = r.fields['Group'] || [];
      groupLinks.forEach(id => reportedGroupIds.add(id));
    }

    // Also include cutoff date itself
    const { records: cutoffReports = [] } = await findRecords(
      'Reports',
      `{Date} = "${cutoff}"`,
      ['Date', 'Group'],
      200
    );
    cutoffReports.forEach(r => {
      (r.fields['Group'] || []).forEach(id => reportedGroupIds.add(id));
    });

    // 3. Find overdue groups
    const overdueGroups = groups.filter(g => !reportedGroupIds.has(g.id));
    console.log(`[check-overdue] ${overdueGroups.length} overdue group(s) out of ${groups.length}`);

    if (dryRun || overdueGroups.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dryRun,
          cutoff,
          totalGroups: groups.length,
          overdueCount: overdueGroups.length,
          overdueGroups: overdueGroups.map(g => ({
            id: g.id,
            name: g.fields['Group Name'],
          })),
        }),
      };
    }

    ensureVapid();

    // 4. For each overdue group, find the leader and send a follow-up notification
    let totalNotified = 0;
    const results = [];

    for (const group of overdueGroups) {
      const groupName = group.fields['Group Name'] || 'your group';

      // Find active leaders in this group (Is Leader = true)
      const { records: leaders = [] } = await findRecords(
        'People',
        `AND({Active}, {Is Leader})`,
        ['Name', 'Group', 'Is Leader'],
        200
      );

      const groupLeaders = leaders.filter(p =>
        Array.isArray(p.fields['Group']) && p.fields['Group'].includes(group.id)
      );

      if (groupLeaders.length === 0) {
        console.warn(`[check-overdue] No leaders found for group "${groupName}" (${group.id})`);
        results.push({ group: groupName, notified: 0, reason: 'no leaders found' });
        continue;
      }

      let groupSent = 0;
      for (const leader of groupLeaders) {
        const subs = await getActiveSubscriptionsForPerson(leader.id);
        const payload = {
          title: '⏰ Report reminder',
          body: `Hey ${leader.fields['Name'].split(' ')[0]}! Your DG report for ${groupName} hasn't been submitted yet. Please send it in when you can 🙏`,
          url: (process.env.SITE_URL || '') + '/report?new=1',
        };
        const sent = await sendPushToSubs(subs, payload);
        groupSent += sent;
      }

      totalNotified += groupSent;
      results.push({ group: groupName, notified: groupSent });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cutoff,
        totalGroups: groups.length,
        overdueCount: overdueGroups.length,
        totalNotified,
        results,
      }),
    };
  } catch (err) {
    console.error('[check-overdue]', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
