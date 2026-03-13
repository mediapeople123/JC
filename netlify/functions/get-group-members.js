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

    // 3. Fetch ALL people (no formula filter — avoids {Active} checkbox pitfalls),
    //    then filter by group record ID and active status in JavaScript.
    //    Only request Name + Group to avoid 422 on optional fields like 'First Name'.
    const { records: allPeople = [] } = await findRecords(
      'People',
      `NOT({Name} = "")`,
      ['Name', 'Group', 'Active'],
      500
    );

    const members = allPeople
      .filter(r =>
        r.fields['Active'] !== false &&
        Array.isArray(r.fields['Group']) &&
        r.fields['Group'].includes(groupRecordId)
      )
      .map(r => {
        const name = r.fields['Name'] || '';
        return {
          id: r.id,
          name,
          firstName: name.split(' ')[0] || name,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    console.log(`[get-group-members] Found ${members.length} members for group ${groupRecordId}`);

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
