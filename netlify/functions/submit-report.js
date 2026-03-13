/**
 * POST /api/submit-report
 *
 * Saves a DG attendance report to the Reports table in Airtable.
 *
 * Expected body:
 * {
 *   personId:       string,   // Airtable record ID of the leader
 *   groupRecordId:  string,   // Airtable record ID of the group
 *   date:           string,   // ISO date e.g. "2026-03-11"
 *   presentCount:   number,
 *   firstTimerCount: number,
 *   firstTimers:    [{name, surname, gender}],
 *   comments:       string
 * }
 */
import { createRecord } from './_airtable.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }

  const { personId, groupRecordId, date, presentCount, firstTimerCount, firstTimers, comments } = data;

  if (!personId || !date) {
    return { statusCode: 400, body: JSON.stringify({ error: 'personId and date are required.' }) };
  }

  try {
    const fields = {
      'Date': date,
      'Leader': [personId],
      'Present Count': Number(presentCount) || 0,
      'First Timer Count': Number(firstTimerCount) || 0,
      'First Timers': Array.isArray(firstTimers) && firstTimers.length > 0
        ? JSON.stringify(firstTimers)
        : '',
      'Comments': comments || '',
    };

    // Only link Group if we have a record ID
    if (groupRecordId) {
      fields['Group'] = [groupRecordId];
    }

    const record = await createRecord('Reports', fields);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: record.id }),
    };
  } catch (err) {
    console.error('[submit-report]', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
