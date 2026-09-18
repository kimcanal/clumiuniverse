// Staff-only order log — returns recent orders saved by submit-order.mjs.
//
// Protected by a single shared passphrase (ORDERS_VIEW_KEY env var), not a full
// login system: the order log contains customer names/phone numbers, so access
// defaults to denied until that env var is explicitly set.

import { getStore } from '@netlify/blobs';

const MAX_ORDERS = 200;

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

  try {
    const store = getStore('orders');
    const { blobs } = await store.list();

    // Keys are `${Date.now()}-${orderCode}` — same-length numeric prefix, so a
    // plain lexicographic sort already sorts by time.
    const recentKeys = blobs
      .map(blob => blob.key)
      .sort()
      .reverse()
      .slice(0, MAX_ORDERS);

    const orders = await Promise.all(recentKeys.map(key => store.get(key, { type: 'json' })));

    return jsonResponse(200, { ok: true, orders: orders.filter(Boolean) });
  } catch (error) {
    console.error('[list-orders] failed to read orders:', error);
    return jsonResponse(500, { ok: false, error: 'Could not load orders.' });
  }
};
