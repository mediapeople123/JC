/**
 * POST /api/submit-report
 *
 * Saves a DG attendance report to the Reports table in Airtable.
 * Also creates People records for any first-time guests and links them to the group.
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
import { createRecord, findRecords } from './_airtable.js';

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

    // ── Create People records for first-time guests ─────────────────────────
    // For each named first-timer, add them to the People table and link to the group.
    const newPeopleIds = [];
    if (Array.isArray(firstTimers) && firstTimers.length > 0) {
      for (const guest of firstTimers) {
        const firstName = (guest.name || '').trim();
        if (!firstName) continue; // skip nameless entries

        const fullName = guest.surname
          ? `${firstName} ${guest.surname.trim()}`
          : firstName;

        try {
          const personFields = {
            'Name': fullName,
            'Active': true,
            'New Guest': true,
          };

          if (groupRecordId) {
            personFields['Group'] = [groupRecordId];
          }

          if (guest.gender && ['Male', 'Female', 'Other'].includes(guest.gender)) {
            personFields['Gender'] = guest.gender;
          }

          const newPerson = await createRecord('People', personFields);
          newPeopleIds.push(newPerson.id);
          console.log(`[submit-report] Created People record for "${fullName}" → ${newPerson.id}`);
        } catch (personErr) {
          // Don't fail the whole submission if People creation fails
          console.error(`[submit-report] Could not create People record for "${fullName}":`, personErr.message);
        }
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: record.id, newPeopleIds }),
    };
  } catch (err) {
    console.error('[submit-report]', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
