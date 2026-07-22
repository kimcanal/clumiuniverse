#!/usr/bin/env node

import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const MENU_PATH = path.join(ROOT, 'data/tossplace-menu/238090/menu.json');
const FEATURED_PATH = path.join(ROOT, 'data/featured.json');
const HIDDEN_PATH = path.join(ROOT, 'data/hidden-menu-items.json');
const OUTPUT_PATH = path.join(ROOT, 'data/site-menu.json');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function getConfiguredIds(entries) {
  return entries
    .map(entry => Number(typeof entry === 'object' ? entry.id : entry))
    .filter(Number.isFinite);
}

function projectMenuItem(item) {
  return {
    id: item.id,
    categoryTitle: item.categoryTitle || '',
    categoryTitleEn: item.categoryTitleEn || '',
    title: item.title || '',
    description: item.description || '',
    state: item.state || '',
    priceValue: Number(item.priceValue) || 0,
    labels: Array.isArray(item.labels) ? item.labels : [],
    imageLocalPath: item.imageLocalPath || '',
  };
}

export async function buildSiteMenu() {
  const [menu, featured, hidden] = await Promise.all([
    readJson(MENU_PATH),
    readJson(FEATURED_PATH),
    readJson(HIDDEN_PATH),
  ]);

  const items = Array.isArray(menu.items) ? menu.items : [];
  const itemIds = new Set(items.map(item => Number(item.id)));
  const hiddenIds = new Set(getConfiguredIds(Array.isArray(hidden) ? hidden : []));
  const featuredIds = getConfiguredIds(Array.isArray(featured) ? featured : []);

  const duplicateIds = items
    .map(item => Number(item.id))
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length) {
    throw new Error(`메뉴 ID가 중복되었습니다: ${[...new Set(duplicateIds)].join(', ')}`);
  }

  const missingFeatured = featuredIds.filter(id => !itemIds.has(id));
  if (missingFeatured.length) {
    throw new Error(`추천 메뉴 ID가 최신 메뉴에 없습니다: ${missingFeatured.join(', ')}`);
  }

  const hiddenFeatured = featuredIds.filter(id => hiddenIds.has(id));
  if (hiddenFeatured.length) {
    throw new Error(`추천 메뉴가 숨김 목록에도 있습니다: ${hiddenFeatured.join(', ')}`);
  }

  const visibleItems = items.filter(item => !hiddenIds.has(Number(item.id)));
  for (const item of visibleItems) {
    if (!item.title?.trim()) throw new Error(`메뉴 ${item.id}의 이름이 비어 있습니다.`);
    if (item.imageLocalPath) {
      await access(path.join(ROOT, item.imageLocalPath));
    }
  }

  return {
    generatedAt: menu.fetchedAt || null,
    merchantId: menu.merchantId || '238090',
    items: visibleItems.map(projectMenuItem),
  };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const output = `${JSON.stringify(await buildSiteMenu(), null, 2)}\n`;

  if (checkOnly) {
    const current = await readFile(OUTPUT_PATH, 'utf8').catch(() => '');
    if (current !== output) {
      throw new Error('data/site-menu.json이 최신 메뉴와 일치하지 않습니다. generate-site-data.mjs를 실행하세요.');
    }
    console.log('사이트 메뉴 데이터가 최신 상태입니다.');
    return;
  }

  await writeFile(OUTPUT_PATH, output);
  console.log(`사이트 메뉴 데이터 생성 완료: ${path.relative(ROOT, OUTPUT_PATH)}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
  });
}
