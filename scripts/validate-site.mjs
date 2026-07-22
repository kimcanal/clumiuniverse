#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

function fail(message) {
  throw new Error(message);
}

const [html, css, headers, siteMenu] = await Promise.all([
  readFile(path.join(ROOT, 'index.html'), 'utf8'),
  readFile(path.join(ROOT, 'styles.css'), 'utf8'),
  readFile(path.join(ROOT, '_headers'), 'utf8'),
  readFile(path.join(ROOT, 'data/site-menu.json'), 'utf8').then(JSON.parse),
]);

const staticIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
const duplicateStaticIds = staticIds.filter((id, index) => staticIds.indexOf(id) !== index);
if (duplicateStaticIds.length) {
  fail(`HTML ID가 중복되었습니다: ${[...new Set(duplicateStaticIds)].join(', ')}`);
}

const targetBlankLinks = html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || [];
const unsafeBlankLinks = targetBlankLinks.filter(tag => !/rel="[^"]*noopener[^"]*"/.test(tag));
if (unsafeBlankLinks.length) fail('target="_blank" 링크에 rel="noopener"가 없습니다.');

const images = html.match(/<img\b[^>]*>/g) || [];
const imagesWithoutAlt = images.filter(tag => !/\balt="[^"]*"/.test(tag));
if (imagesWithoutAlt.length) fail(`alt 속성이 없는 이미지가 ${imagesWithoutAlt.length}개 있습니다.`);

const hashLinks = [...html.matchAll(/href="#([^"]+)"/g)].map(match => match[1]);
const missingAnchors = [...new Set(hashLinks.filter(id => !staticIds.includes(id)))];
if (missingAnchors.length) fail(`대상 요소가 없는 앵커 링크가 있습니다: ${missingAnchors.join(', ')}`);

const menuIds = new Set((siteMenu.items || []).map(item => Number(item.id)));
const boundMenuImageIds = [...html.matchAll(/data-menu-image-id="(\d+)"/g)].map(match => Number(match[1]));
const missingBoundImages = boundMenuImageIds.filter(id => !menuIds.has(id));
if (missingBoundImages.length) {
  fail(`최신 메뉴에 없는 data-menu-image-id가 있습니다: ${missingBoundImages.join(', ')}`);
}

const preloadImages = [...html.matchAll(/<link\b[^>]*rel="preload"[^>]*as="image"[^>]*>/g)]
  .map(tag => tag[0].match(/href="([^"]+)"/)?.[1])
  .filter(Boolean);
const duplicatePreloads = preloadImages.filter((href, index) => preloadImages.indexOf(href) !== index);
if (duplicatePreloads.length) fail(`중복 이미지 preload가 있습니다: ${[...new Set(duplicatePreloads)].join(', ')}`);

const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!jsonLdMatch) fail('LocalBusiness 구조화 데이터가 없습니다.');
const jsonLd = JSON.parse(jsonLdMatch[1]);
if (jsonLd['@type'] !== 'CafeOrCoffeeShop') fail('구조화 데이터 타입이 CafeOrCoffeeShop이 아닙니다.');
if (!/<link\s+rel="canonical"/.test(html)) fail('canonical 링크가 없습니다.');

const directLocalRefs = [...html.matchAll(/\b(?:src|href)="\.\/([^"?#]+)"/g)].map(match => match[1]);
const srcsetLocalRefs = [...html.matchAll(/\bsrcset="([^"]+)"/g)]
  .flatMap(match => match[1].split(',').map(candidate => candidate.trim().split(/\s+/)[0]))
  .filter(value => value.startsWith('./'))
  .map(value => value.slice(2));
const cssLocalRefs = [...css.matchAll(/url\(['"]?\.\/([^'"?#)]+)['"]?\)/g)].map(match => match[1]);
const localRefs = [...new Set([...directLocalRefs, ...srcsetLocalRefs, ...cssLocalRefs])]
  .filter(ref => !ref.includes('${'));
await Promise.all(localRefs.map(async ref => {
  try {
    await access(path.join(ROOT, ref));
  } catch {
    fail(`로컬 자산을 찾을 수 없습니다: ${ref}`);
  }
}));

for (const policy of ['X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
  if (!headers.includes(policy)) fail(`보안 헤더가 없습니다: ${policy}`);
}

await Promise.all(['robots.txt', 'sitemap.xml'].map(file => access(path.join(ROOT, file))));

console.log(`사이트 검증 통과: 메뉴 ${siteMenu.items.length}개, 이미지 ${images.length}개, 로컬 자산 ${localRefs.length}개`);
