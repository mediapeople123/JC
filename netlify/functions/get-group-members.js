/**
 * GET /api/get-group-members?personId=recXXXXXX
 *
 * Returns the group name, group record ID, and all active members
 * for the group the given person belongs to.
 */
import { getRecord, findRecords } from './_airtable.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { personId } = event.queryStringParameters || {};
  if (!personId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'personId required' }) };
  }

  try {
    // 1. Get the person's record to find their group link
    const person = await getRecord('People', personId);
    const groupLinkIds = person.fields['Group'];

    if (!Array.isArray(groupLinkIds) || groupLinkIds.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName: 'My Group', groupRecordId: '', groupId: '', members: [] }),
      };
    }

    const groupRecordId = groupLinkIds[0];

    // 2. Get group details (primary field name may vary — try common names)
    const group = await getRecord('Groups', groupRecordId);
    const groupName =
      group.fields['Group Name'] ||
      group.fields['Name'] ||
      Object.values(group.fields)[0] ||
      'My Group';
    const groupId = group.fields['Group ID'] || '';

    // 3. Fetch all active people, filter by this group in JS
    // (ARRAYJOIN in Airtable formulas returns display names, not record IDs)
    const { records: allPeople = [] } = await findRecords(
      'People',
      `{Active}`,
      ['Name', 'First Name', 'Group'],
      500
    );

    const members = allPeople
      .filter(r => Array.isArray(r.fields['Group']) && r.fields['Group'].includes(groupRecordId))
      .map(r => ({
        id: r.id,
        name: r.fields['Name'] || '',
        firstName: r.fields['First Name'] || (r.fields['Name'] || '').split(' ')[0] || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName, groupRecordId, groupId, members }),
    };
  } catch (err) {
    console.error('[get-group-members]', err.message);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
