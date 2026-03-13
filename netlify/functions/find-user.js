/**
 * GET /api/find-user?email=... or ?name=...
 *
 * Searches the Airtable "People" table and returns matching active members.
 * Never returns sensitive fields — only what the UI needs.
 */
import { findRecords, sanitize } from './_airtable.js';

const PEOPLE_TABLE = 'People';
const RETURN_FIELDS = ['Name', 'First Name', 'Email', 'Group', 'Is Leader', 'Active'];

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { email, name } = event.queryStringParameters || {};

  if (!email && !name) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Provide an email or name to search.' }),
    };
  }

  try {
    let formula;

    if (email) {
      // Exact email match (case-insensitive)
      formula = `LOWER({Email}) = LOWER("${sanitize(email)}")`;
    } else {
      // Partial name match against Name and First Name fields
      const q = sanitize(name);
      formula = `OR(
        SEARCH(LOWER("${q}"), LOWER({Name})),
        SEARCH(LOWER("${q}"), LOWER({First Name}))
      )`;
    }

    const { records = [] } = await findRecords(PEOPLE_TABLE, formula, RETURN_FIELDS, 20);

    // Only return active members; strip internal Airtable structure
    const users = records
      .filter(r => r.fields['Active'] !== false)
      .map(r => ({
        id: r.id,
        name: r.fields['Name'] || '',
        firstName: r.fields['First Name'] || '',
        email: r.fields['Email'] || '',
        // Group is a linked record field — Airtable returns array of record IDs
        groupIds: Array.isArray(r.fields['Group']) ? r.fields['Group'] : [],
        isLeader: Boolean(r.fields['Is Leader']),
      }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users }),
    };
  } catch (err) {
    console.error('[find-user]', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }), // temporary: expose real error for debugging
    };
  }
};
