// Returns the VAPID public key so the staff orders page can subscribe to push
// notifications. The public key is not sensitive — the browser needs it to
// call pushManager.subscribe(), and it can't be used to send notifications
// (only the private key, kept server-side, can do that).

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async () => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    return jsonResponse(503, { ok: false, error: 'Push notifications are not configured yet.' });
  }
  return jsonResponse(200, { ok: true, publicKey });
};
