#!/usr/bin/env node
/**
 * One-time helper to generate a VAPID key pair for Web Push notifications.
 * Not deployed — run this locally once, then set the printed values as
 * Netlify environment variables.
 *
 * Usage:
 *   node scripts/generate-vapid-keys.mjs
 */

import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('\n✅ Generated a new VAPID key pair. Set these as Netlify environment variables:\n');
console.log(`  VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`  VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`  VAPID_SUBJECT=mailto:you@example.com  (any contact URI Kakao/push services can use to reach you about this integration)\n`);
console.log('The public key is not sensitive (the browser needs to see it to subscribe).');
console.log('The private key must stay secret — never commit it.\n');
