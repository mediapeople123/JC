/**
 * GET /api/config
 *
 * Returns public configuration needed by the frontend.
 * The VAPID public key is intentionally public — it is safe to expose.
 */
export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'VAPID_PUBLIC_KEY is not configured.' }),
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
    body: JSON.stringify({ vapidPublicKey }),
  };
};
