/**
 * POST /api/subscribe-user
 *
 * Saves a browser push subscription to the Airtable "Subscriptions" table.
 * Handles deduplication by endpoint — if the same endpoint already exists,
 * updates it (e.g. renewed keys) instead of creating a duplicate.
 *
 * Expected body:
 * {
 *   personId:   string,          // Airtable record ID of the person
 *   groupIds:   string[],        // Airtable record IDs of groups (optional)
 *   subscription: {              // PushSubscription.toJSON()
 *     endpoint: string,
 *     keys: { p256dh: string, auth: string }
 *   },
 *   deviceName: string,          // e.g. "iPhone", "Windows PC"
 *   userAgent:  string
 * }
 */
import { findRecords, createRecord, updateRecord, sanitize } from './_airtable.js';

const SUBSCRIPTIONS_TABLE = 'Subscriptions';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON.' }) };
  }

  const { personId, groupIds = [], subscription, deviceName, userAgent } = body;

  // Validate required fields
  if (!personId || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'personId and a full push subscription object are required.' }),
    };
  }

  const now = new Date().toISOString();
  const safeEndpoint = sanitize(subscription.endpoint);

  try {
    // Check whether we already have this endpoint stored
    const existing = await findRecords(
      SUBSCRIPTIONS_TABLE,
      `{Endpoint} = "${safeEndpoint}"`,
      ['Endpoint']
    );

    if (existing.records?.length > 0) {
      // Update key material and activity timestamp
      await updateRecord(SUBSCRIPTIONS_TABLE, existing.records[0].id, {
        P256DH: subscription.keys.p256dh,
        Auth: subscription.keys.auth,
        'Device Name': deviceName || 'Browser',
        'User Agent': (userAgent || '').substring(0, 255),
        Active: true,
        'Last Seen at': now,
      });

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, action: 'updated' }),
      };
    }

    // Create a new subscription record
    const fields = {
      Person: [personId],
      Endpoint: subscription.endpoint,
      P256DH: subscription.keys.p256dh,
      Auth: subscription.keys.auth,
      'Device Name': deviceName || 'Browser',
      'User Agent': (userAgent || '').substring(0, 255),
      Active: true,
      'Last Seen at': now,
    };

    // Link to first group if available
    if (groupIds.length > 0) {
      fields.Group = [groupIds[0]];
    }

    await createRecord(SUBSCRIPTIONS_TABLE, fields);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, action: 'created' }),
    };
  } catch (err) {
    console.error('[subscribe-user]', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to save subscription. Please try again.' }),
    };
  }
};
