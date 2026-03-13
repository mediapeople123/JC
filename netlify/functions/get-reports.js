/**
 * GET /api/get-reports?groupRecordId=recXXXXXX
 *
 * Returns recent reports for a group, sorted newest first.
 */
import { findRecords } from './_airtable.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { groupRecordId } = event.queryStringParameters || {};
  if (!groupRecordId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'groupRecordId required' }) };
  }

  try {
    // Fetch recent reports — filter by group in JS (ARRAYJOIN linked-field issue)
    const { records = [] } = await findRecords(
      'Reports',
      `NOT({Date} = "")`,
      ['Date', 'Present Count', 'First Timer Count', 'First Timers', 'Comments', 'Group'],
      200
    );

    const groupReports = records
      .filter(r => Array.isArray(r.fields['Group']) && r.fields['Group'].includes(groupRecordId))
      .map(r => ({
        id: r.id,
        date: r.fields['Date'] || '',
        presentCount: r.fields['Present Count'] || 0,
        firstTimerCount: r.fields['First Timer Count'] || 0,
        firstTimers: (() => {
          try { return JSON.parse(r.fields['First Timers'] || '[]'); } catch { return []; }
        })(),
        comments: r.fields['Comments'] || '',
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 16);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reports: groupReports }),
    };
  } catch (err) {
    console.error('[get-reports]', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
