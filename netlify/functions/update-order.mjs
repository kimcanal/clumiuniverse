// Staff-only order management — mark an order complete/incomplete, or delete it.
// Protected by the same shared passphrase as list-orders.mjs (ORDERS_VIEW_KEY).

import { getStore } from '@netlify/blobs';

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async (request) => {
  const expectedKey = process.env.ORDERS_VIEW_KEY;
  const providedKey = request.headers.get('x-orders-key') || '';
  if (!expectedKey || providedKey !== expectedKey) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized.' });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' });
  }

  const { key, action } = body || {};
  if (!key || typeof key !== 'string') {
    return jsonResponse(400, { ok: false, error: 'Missing order key.' });
  }

  const store = getStore('orders');

  try {
    if (action === 'delete') {
      await store.delete(key);
      return jsonResponse(200, { ok: true });
    }

    if (action === 'complete' || action === 'incomplete') {
      const existing = await store.get(key, { type: 'json' });
      if (!existing) {
        return jsonResponse(404, { ok: false, error: 'Order not found.' });
      }
      await store.setJSON(key, { ...existing, completed: action === 'complete' });
      return jsonResponse(200, { ok: true });
    }

    return jsonResponse(400, { ok: false, error: 'Unknown action.' });
  } catch (error) {
    console.error('[update-order] failed:', error);
    return jsonResponse(500, { ok: false, error: 'Could not update order.' });
  }
};
