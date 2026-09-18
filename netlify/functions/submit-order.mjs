// Foreign-visitor pre-order intake.
//
// Stage 1 (current): the store's dedicated Kakao account/OAuth tokens don't exist yet,
// so this function never calls Kakao. It validates the order and returns the exact
// request parameters that WOULD be sent to Kakao's "Message to Me" API, so the flow
// can be verified end-to-end before wiring up real credentials.
//
// Stage 2 (later): once KAKAO_REST_API_KEY / KAKAO_CLIENT_SECRET / KAKAO_REFRESH_TOKEN
// are set as Netlify environment variables, this same function will actually call
// Kakao instead of returning a dry-run payload — see the branch below.
//
// Every order is also persisted to Netlify Blobs (the "orders" store) regardless of
// Kakao delivery status, so staff have a durable log even before/without Kakao —
// see netlify/functions/list-orders.mjs and order/orders.html.

import { getStore } from '@netlify/blobs';

const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_SEND_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

function formatWon(value) {
  return `₩${Number(value || 0).toLocaleString('en-US')}`;
}

// Staff (this function's Kakao message + order log) read Korean menu names first,
// since staff work off the Korean menu board/POS — with the English name the
// customer actually picked shown alongside for cross-reference.
function bilingualName(kr, en) {
  if (kr && en && kr !== en) return `${kr} (${en})`;
  return kr || en || '';
}

function formatItemLine(item) {
  const selections = Array.isArray(item.selections) && item.selections.length
    ? ` (${item.selections.map(s => bilingualName(s.choiceTitleKr, s.choiceTitle)).join(', ')})`
    : '';
  const name = bilingualName(item.title, item.titleEn);
  return `- ${item.qty} x ${name}${selections} — ${formatWon(item.unitPrice * item.qty)}`;
}

function buildMessageText(order) {
  const lines = [
    `🐰 New pre-order #${order.orderCode || 'N/A'}`,
    '',
    `Name: ${order.name}`,
    `Contact: ${order.contact}`,
    `Pickup: ${order.pickupTime}`,
    order.notes ? `Notes: ${order.notes}` : null,
    '',
    'Items:',
    ...order.items.map(formatItemLine),
    '',
    `Estimated total: ${formatWon(order.estimatedTotal)}`,
    '(Customer pays at the counter — confirm final amount there.)',
  ].filter(Boolean);
  return lines.join('\n');
}

function validateOrder(body) {
  if (!body || typeof body !== 'object') return 'Invalid request body.';
  if (body.website) return 'Rejected.'; // honeypot field was filled in — likely a bot
  if (!body.name || !String(body.name).trim()) return 'Name is required.';
  if (!body.contact || !String(body.contact).trim()) return 'Contact is required.';
  if (!Array.isArray(body.items) || body.items.length === 0) return 'Order has no items.';
  return null;
}

async function saveOrderRecord(order, extra) {
  try {
    const store = getStore('orders');
    const key = `${Date.now()}-${order.orderCode || 'unknown'}`;
    await store.setJSON(key, {
      ...order,
      receivedAt: new Date().toISOString(),
      ...extra,
    });
  } catch (error) {
    // The order log is a convenience, not a requirement — never let a storage
    // hiccup block the customer's order from going through.
    console.error('[submit-order] failed to persist order log:', error);
  }
}

export default async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed.' });
  }

  let order;
  try {
    order = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: 'Invalid JSON body.' });
  }

  const validationError = validateOrder(order);
  if (validationError) {
    return jsonResponse(400, { ok: false, error: validationError });
  }

  const messageText = buildMessageText(order);

  const tokenRequest = {
    url: KAKAO_TOKEN_URL,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: {
      grant_type: 'refresh_token',
      client_id: '${KAKAO_REST_API_KEY}',
      client_secret: '${KAKAO_CLIENT_SECRET}',
      refresh_token: '${KAKAO_REFRESH_TOKEN}',
    },
  };

  const messageRequest = {
    url: KAKAO_SEND_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Bearer ${access_token from tokenRequest response}',
    },
    body: {
      template_object: JSON.stringify({
        object_type: 'text',
        text: messageText,
        link: { web_url: 'https://clumiuniverse.netlify.app/order', mobile_web_url: 'https://clumiuniverse.netlify.app/order' },
      }),
    },
  };

  const kakaoConfigured = process.env.KAKAO_REST_API_KEY
    && process.env.KAKAO_CLIENT_SECRET
    && process.env.KAKAO_REFRESH_TOKEN;

  if (!kakaoConfigured) {
    console.log('[submit-order] dry run — order:', JSON.stringify(order));
    console.log('[submit-order] would send to Kakao:', JSON.stringify({ tokenRequest, messageRequest }, null, 2));
    await saveOrderRecord(order, { delivered: null });
    return jsonResponse(200, {
      ok: true,
      dryRun: true,
      message: 'Kakao is not configured yet — this order was validated but not delivered anywhere. See wouldSend for what will be sent once Kakao is wired up.',
      wouldSend: { tokenRequest, messageRequest },
    });
  }

  // Stage 2: real Kakao delivery (runs once the env vars above are set).
  try {
    const tokenRes = await fetch(KAKAO_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.KAKAO_REST_API_KEY,
        client_secret: process.env.KAKAO_CLIENT_SECRET,
        refresh_token: process.env.KAKAO_REFRESH_TOKEN,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(`Kakao token refresh failed: ${JSON.stringify(tokenData)}`);
    }

    const sendRes = await fetch(KAKAO_SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Bearer ${tokenData.access_token}`,
      },
      body: new URLSearchParams({
        template_object: JSON.stringify({
          object_type: 'text',
          text: messageText,
          link: { web_url: 'https://clumiuniverse.netlify.app/order', mobile_web_url: 'https://clumiuniverse.netlify.app/order' },
        }),
      }),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok || sendData.result_code !== 0) {
      throw new Error(`Kakao send failed: ${JSON.stringify(sendData)}`);
    }

    await saveOrderRecord(order, { delivered: true });
    return jsonResponse(200, { ok: true, dryRun: false });
  } catch (error) {
    console.error('[submit-order] Kakao delivery failed:', error);
    await saveOrderRecord(order, { delivered: false, deliveryError: String(error?.message || error) });
    return jsonResponse(502, { ok: false, error: 'Could not deliver the order notification. Please order at the counter instead.' });
  }
};
