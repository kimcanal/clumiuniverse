#!/usr/bin/env node
/**
 * One-time helper to get a Kakao "나에게 보내기" refresh token.
 * Not deployed — run this locally once per Kakao account you connect.
 *
 * Step 1 — get the login URL:
 *   node scripts/kakao-get-refresh-token.mjs --client-id <REST_API_KEY> --redirect-uri <REDIRECT_URI>
 *   Open the printed URL, log in with the store's dedicated Kakao account, and approve.
 *   You'll be redirected to <REDIRECT_URI>?code=XXXXXXXX — copy the `code` value from the address bar.
 *
 * Step 2 — exchange the code for tokens:
 *   node scripts/kakao-get-refresh-token.mjs --client-id <REST_API_KEY> --redirect-uri <REDIRECT_URI> --code <CODE> [--client-secret <SECRET>]
 *
 * <REDIRECT_URI> must exactly match a Redirect URI registered on the Kakao app
 * (카카오 로그인 > Redirect URI). Any URL you own works, e.g. https://clumiuniverse.netlify.app/ —
 * it doesn't need to "do" anything with the code, you just copy it from the browser's address bar.
 * --client-secret is only needed if "Client Secret" is turned on for the app.
 */

const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const KAKAO_AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  Step 1 (get login URL):
    node scripts/kakao-get-refresh-token.mjs --client-id <REST_API_KEY> --redirect-uri <REDIRECT_URI>

  Step 2 (exchange the code you got back for tokens):
    node scripts/kakao-get-refresh-token.mjs --client-id <REST_API_KEY> --redirect-uri <REDIRECT_URI> --code <CODE> [--client-secret <SECRET>]
`);
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  const args = parseArgs(rawArgs);

  if (!args['client-id'] || !args['redirect-uri']) {
    printHelp();
    process.exit(1);
  }

  const clientId = args['client-id'];
  const redirectUri = args['redirect-uri'];

  if (!args.code) {
    const url = new URL(KAKAO_AUTHORIZE_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'talk_message');

    console.log('\n1) Open this URL in a browser, logged in as the store\'s dedicated Kakao account:\n');
    console.log(`   ${url.toString()}\n`);
    console.log(`2) After approving, you'll land on ${redirectUri}?code=XXXXXXXX — copy the code value.`);
    console.log('3) Re-run this script with --code <that value> to get your refresh token.\n');
    return;
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code: args.code,
  });
  if (args['client-secret']) {
    body.set('client_secret', args['client-secret']);
  }

  const res = await fetch(KAKAO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();

  if (!res.ok || !data.access_token) {
    console.error('Token exchange failed:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('\n✅ Success! Set these as Netlify environment variables:\n');
  console.log(`  KAKAO_REST_API_KEY=${clientId}`);
  if (args['client-secret']) {
    console.log(`  KAKAO_CLIENT_SECRET=${args['client-secret']}`);
  }
  console.log(`  KAKAO_REFRESH_TOKEN=${data.refresh_token}\n`);
  console.log(`(access_token, valid ~${Math.round((data.expires_in || 0) / 3600)}h, not needed — the app refreshes it automatically on each order.)`);
  console.log(`refresh_token expires in ~${Math.round((data.refresh_token_expires_in || 0) / 86400)} days — you may need to redo this flow after that.\n`);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
