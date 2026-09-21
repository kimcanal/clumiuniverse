// Registers (or removes) a staff browser's push subscription, protected by
// the same shared passphrase as the rest of the staff order tools.

import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

function subscriptionKey(endpoint) {
  return createHash('sha256').update(endpoint).digest('hex');
}

export default async (request) => {
  const expectedKey = process.env.ORDERS_VIEW_KEY;
  const providedKey = request.headers.get('x-orders-key') || '';
  if (!expectedKey || providedKey !== expectedKey) {
    return jsonResponse(401, { ok: false, error: 'Unauthorized.' });
  }

  const store = getStore('push-subscriptions');

  if (request.method === 'DELETE') {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' });
    }
    if (!body?.endpoint) {
      return jsonResponse(400, { ok: false, error: 'Missing endpoint.' });
    }
    await store.delete(subscriptionKey(body.endpoint));
    return jsonResponse(200, { ok: true });
  }

  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }

  let subscription;
  try {
    subscription = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' });
  }

  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return jsonResponse(400, { ok: false, error: 'Invalid push subscription.' });
  }

  try {
    await store.setJSON(subscriptionKey(subscription.endpoint), subscription);
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('[subscribe-push] failed to save subscription:', error);
    return jsonResponse(500, { ok: false, error: 'Could not save subscription.' });
  }
};
