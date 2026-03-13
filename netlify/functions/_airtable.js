/**
 * Shared Airtable REST API helper.
 * All secrets are read from environment variables at call time.
 * This file is intentionally prefixed with _ so Netlify does NOT
 * treat it as a function endpoint.
 */

function baseUrl() {
  return `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}`;
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

/** Strip characters that could break Airtable formula strings */
export function sanitize(value) {
  return String(value ?? '').replace(/["\\]/g, '');
}

/**
 * Low-level HTTP call to Airtable.
 * @param {string} path  — e.g. "People" or "People/recXXX"
 * @param {object} opts  — { method, qs, body }
 */
async function airtableRequest(path, opts = {}) {
  const url = `${baseUrl()}/${path}${opts.qs ? '?' + opts.qs : ''}`;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: headers(),
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable ${res.status} on ${path}: ${text}`);
  }
  return res.json();
}

/**
 * Search records with a filter formula.
 * @param {string}   table         — Airtable table name
 * @param {string}   filterFormula — Airtable formula string
 * @param {string[]} fields        — field names to return (empty = all)
 * @param {number}   maxRecords
 */
export async function findRecords(table, filterFormula, fields = [], maxRecords = 50) {
  let qs = `filterByFormula=${encodeURIComponent(filterFormula)}&maxRecords=${maxRecords}`;
  fields.forEach(f => { qs += `&fields[]=${encodeURIComponent(f)}`; });
  return airtableRequest(encodeURIComponent(table), { qs });
}

/**
 * Create a single record.
 */
export async function createRecord(table, fields) {
  return airtableRequest(encodeURIComponent(table), {
    method: 'POST',
    body: { fields },
  });
}

/**
 * Get a single record by its Airtable record ID.
 */
export async function getRecord(table, recordId) {
  return airtableRequest(`${encodeURIComponent(table)}/${recordId}`);
}

/**
 * Partially update a single record (PATCH).
 */
export async function updateRecord(table, recordId, fields) {
  return airtableRequest(`${encodeURIComponent(table)}/${recordId}`, {
    method: 'PATCH',
    body: { fields },
  });
}
