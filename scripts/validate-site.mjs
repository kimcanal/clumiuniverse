#!/usr/bin/env node

import { access, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');

function fail(message) {
  throw new Error(message);
}

const [html, css, headers, siteMenu, instagramData] = await Promise.all([
  readFile(path.join(ROOT, 'index.html'), 'utf8'),
  readFile(path.join(ROOT, 'styles.css'), 'utf8'),
  readFile(path.join(ROOT, '_headers'), 'utf8'),
  readFile(path.join(ROOT, 'data/site-menu.json'), 'utf8').then(JSON.parse),
  readFile(path.join(ROOT, 'data/instagram.json'), 'utf8').then(JSON.parse),
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

const instagramPosts = Array.isArray(instagramData.posts) ? instagramData.posts : [];
if (instagramData.account !== 'clumi.universe') fail('Instagram 계정이 clumi.universe가 아닙니다.');
if (instagramPosts.length !== 4) fail('Instagram 갤러리는 최신 게시물 4개를 포함해야 합니다.');

const instagramIds = instagramPosts.map(post => String(post.id || ''));
if (new Set(instagramIds).size !== instagramIds.length) fail('Instagram 게시물 ID가 중복되었습니다.');
if (instagramIds.some(id => !/^[\w-]+$/.test(id) || id.startsWith('legacy-'))) {
  fail('Instagram 게시물에 실제 shortcode 대신 legacy ID가 남아 있습니다.');
}

const instagramImageStats = await Promise.all(instagramPosts.map(async (post, index) => {
  const date = String(post.publishedAt || '');
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    fail(`Instagram 게시일 형식이 잘못되었습니다: ${post.id || index}`);
  }
  if (!String(post.caption || '').trim() || !String(post.alt || '').trim()) {
    fail(`Instagram 캡션 또는 대체 텍스트가 비어 있습니다: ${post.id || index}`);
  }

  let url;
  try {
    url = new URL(post.permalink);
  } catch {
    fail(`Instagram 링크가 올바르지 않습니다: ${post.id || index}`);
  }
  const [type, id] = url.pathname.split('/').filter(Boolean);
  const expectedType = post.type === 'reel' ? 'reel' : 'p';
  if (!['instagram.com', 'www.instagram.com'].includes(url.hostname)
    || type !== expectedType || id !== post.id) {
    fail(`Instagram 링크와 게시물 ID 또는 유형이 맞지 않습니다: ${post.id || index}`);
  }

  const image = String(post.image || '');
  if (!/^assets\/instagram\/instagram-[\w-]+\.webp$/.test(image) || image.includes('..')) {
    fail(`Instagram 이미지 경로가 올바르지 않습니다: ${post.id || index}`);
  }
  await access(path.join(ROOT, image));
  return stat(path.join(ROOT, image));
}));

if (instagramImageStats.some(imageStats => imageStats.size > 180 * 1024)) {
  fail('180KB를 넘는 Instagram 이미지가 있습니다.');
}
const sortedInstagramDates = instagramPosts.map(post => post.publishedAt).sort().reverse();
if (instagramPosts.some((post, index) => post.publishedAt !== sortedInstagramDates[index])) {
  fail('Instagram 게시물이 게시일 최신순으로 정렬되어 있지 않습니다.');
}

const fallbackInstagramIds = [...html.matchAll(/data-instagram-post-id="([\w-]+)"/g)].map(match => match[1]);
if (fallbackInstagramIds.join(',') !== instagramIds.join(',')) {
  fail('HTML 갤러리 fallback과 data/instagram.json의 게시물 순서가 다릅니다.');
}
if (!html.includes('id="instagramGallery" data-gallery-source="./data/instagram.json"')) {
  fail('클루미의 순간들 갤러리가 Instagram 데이터 소스에 연결되어 있지 않습니다.');
}

const menuIds = new Set((siteMenu.items || []).map(item => Number(item.id)));
const nonWebpMenuImages = (siteMenu.items || [])
  .filter(item => item.imageLocalPath && !item.imageLocalPath.endsWith('.webp'))
  .map(item => item.id);
if (nonWebpMenuImages.length) {
  fail(`WebP가 아닌 메뉴 이미지가 있습니다: ${nonWebpMenuImages.join(', ')}`);
}
const oversizedMenuImages = [];
await Promise.all((siteMenu.items || []).map(async item => {
  if (!item.imageLocalPath) return;
  const imageStats = await stat(path.join(ROOT, item.imageLocalPath));
  if (imageStats.size > 160 * 1024) oversizedMenuImages.push(item.id);
}));
if (oversizedMenuImages.length) {
  fail(`160KB를 넘는 메뉴 이미지가 있습니다: ${oversizedMenuImages.join(', ')}`);
}
const menuItemsWithPrice = (siteMenu.items || []).filter(item => 'priceValue' in item).map(item => item.id);
if (menuItemsWithPrice.length) {
  fail(`화면에서 사용하지 않는 가격 데이터가 남아 있습니다: ${menuItemsWithPrice.join(', ')}`);
}
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
if (!/<meta\s+property="og:image:width"\s+content="1200">/.test(html)
  || !/<meta\s+property="og:image:height"\s+content="630">/.test(html)) {
  fail('공유 이미지 크기 메타데이터가 1200×630이 아닙니다.');
}

const trackingActions = [...html.matchAll(/data-track="([^"]+)"/g)].map(match => match[1]);
const duplicateTrackingActions = trackingActions.filter((action, index) => trackingActions.indexOf(action) !== index);
if (duplicateTrackingActions.length) {
  fail(`중복된 측정 이벤트 이름이 있습니다: ${[...new Set(duplicateTrackingActions)].join(', ')}`);
}
if (trackingActions.length < 8) fail('핵심 외부 링크 측정 이벤트가 충분히 설정되지 않았습니다.');

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

console.log(`사이트 검증 통과: 메뉴 ${siteMenu.items.length}개, Instagram ${instagramPosts.length}개, 이미지 ${images.length}개, 로컬 자산 ${localRefs.length}개`);
