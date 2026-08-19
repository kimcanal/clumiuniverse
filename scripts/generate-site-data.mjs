#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const MENU_PATH = path.join(ROOT, 'data/tossplace-menu/238090/menu.json');
const FEATURED_PATH = path.join(ROOT, 'data/featured.json');
const HIDDEN_PATH = path.join(ROOT, 'data/hidden-menu-items.json');
const OUTPUT_PATH = path.join(ROOT, 'data/site-menu.json');
const MENU_IMAGE_WIDTH = 720;
const MENU_IMAGE_QUALITY = 74;
const runFile = promisify(execFile);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function getConfiguredIds(entries) {
  return entries
    .map(entry => Number(typeof entry === 'object' ? entry.id : entry))
    .filter(Number.isFinite);
}

function getOptimizedImagePath(localPath) {
  if (!localPath) return '';
  return localPath.replace(/\.[^.\/]+$/, '.webp');
}

async function ensureOptimizedImage(localPath, { force = false } = {}) {
  const optimizedPath = getOptimizedImagePath(localPath);
  if (!optimizedPath || optimizedPath === localPath) return optimizedPath;

  const sourcePath = path.join(ROOT, localPath);
  const outputPath = path.join(ROOT, optimizedPath);
  const [sourceStats, outputStats] = await Promise.all([
    stat(sourcePath),
    stat(outputPath).catch(() => null),
  ]);
  if (!force && outputStats && outputStats.mtimeMs >= sourceStats.mtimeMs) return optimizedPath;

  try {
    await runFile('cwebp', [
      '-quiet',
      '-q', String(MENU_IMAGE_QUALITY),
      '-m', '6',
      '-resize', String(MENU_IMAGE_WIDTH), '0',
      sourcePath,
      '-o', outputPath,
    ]);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error('메뉴 이미지 최적화에 cwebp가 필요합니다. macOS는 `brew install webp`로 설치하세요.');
    }
    throw error;
  }
  return optimizedPath;
}

function projectMenuItem(item, imageLocalPath) {
  return {
    id: item.id,
    categoryTitle: item.categoryTitle || '',
    categoryTitleEn: item.categoryTitleEn || '',
    title: item.title || '',
    description: item.description || '',
    state: item.state || '',
    labels: Array.isArray(item.labels) ? item.labels : [],
    imageLocalPath,
  };
}

export async function buildSiteMenu({ optimizeImages = false, forceImages = false } = {}) {
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

  let validFeaturedIds = featuredIds;
  const missingFeatured = featuredIds.filter(id => !itemIds.has(id));
  if (missingFeatured.length) {
    console.warn(`[경고] 추천 메뉴 ID가 최신 메뉴에 없습니다. 해당 ID를 자동 제외합니다: ${missingFeatured.join(', ')}`);
    validFeaturedIds = featuredIds.filter(id => itemIds.has(id));
    await writeFile(FEATURED_PATH, JSON.stringify(validFeaturedIds, null, 2) + '\n', 'utf8');
  }

  const hiddenFeatured = featuredIds.filter(id => hiddenIds.has(id));
  if (hiddenFeatured.length) {
    throw new Error(`추천 메뉴가 숨김 목록에도 있습니다: ${hiddenFeatured.join(', ')}`);
  }

  const visibleItems = items.filter(item => !hiddenIds.has(Number(item.id)));
  const optimizedPaths = new Map();
  for (const item of visibleItems) {
    if (!item.title?.trim()) throw new Error(`메뉴 ${item.id}의 이름이 비어 있습니다.`);
    if (item.imageLocalPath) {
      await access(path.join(ROOT, item.imageLocalPath));
      const optimizedPath = optimizeImages
        ? await ensureOptimizedImage(item.imageLocalPath, { force: forceImages })
        : getOptimizedImagePath(item.imageLocalPath);
      try {
        await access(path.join(ROOT, optimizedPath));
      } catch {
        throw new Error(`최적화된 메뉴 이미지가 없습니다: ${optimizedPath}`);
      }
      optimizedPaths.set(Number(item.id), optimizedPath);
    }
  }

  return {
    generatedAt: menu.fetchedAt || null,
    merchantId: menu.merchantId || '238090',
    items: visibleItems.map(item => projectMenuItem(item, optimizedPaths.get(Number(item.id)) || '')),
  };
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  const forceImages = process.argv.includes('--force-images');
  const output = `${JSON.stringify(await buildSiteMenu({
    optimizeImages: !checkOnly,
    forceImages: !checkOnly && forceImages,
  }), null, 2)}\n`;

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
