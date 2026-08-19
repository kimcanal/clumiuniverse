#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = 'https://api-public.tossplace.com';
const STORE_BASE = 'https://store.tossplace.com/order';
const DEFAULT_OUTPUT_DIR = 'data/tossplace-menu';
const DEFAULT_MERCHANT_INPUT = '238090';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {
    merchantInput: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    images: true,
    concurrency: 6,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') {
      args.outputDir = argv[++index];
    } else if (arg === '--no-images') {
      args.images = false;
    } else if (arg === '--concurrency') {
      args.concurrency = Number(argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else if (!args.merchantInput) {
      args.merchantInput = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.merchantInput ??= DEFAULT_MERCHANT_INPUT;

  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error('--concurrency must be a positive integer.');
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/fetch-toss-menu.mjs [merchant-id-or-url] [--out data/tossplace-menu] [--no-images] [--concurrency 6]

Examples:
  node scripts/fetch-toss-menu.mjs
  node scripts/fetch-toss-menu.mjs 238090
  node scripts/fetch-toss-menu.mjs https://store.tossplace.com/order/238090 --concurrency 4

Default:
  merchant-id-or-url defaults to ${STORE_BASE}/${DEFAULT_MERCHANT_INPUT}`);
}

function parseMerchantId(input) {
  const match = String(input).match(/(?:order\/)?(\d+)(?:[/?#].*)?$/);
  if (!match) {
    throw new Error(`Could not parse merchant id from: ${input}`);
  }
  return match[1];
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeText(filePath, value) {
  await writeFile(filePath, value, 'utf8');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSuccess(pathname, merchantId, maxRetries = 3) {
  const headers = {
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    origin: 'https://store.tossplace.com',
    referer: `${STORE_BASE}/${merchantId}`,
    'toss-merchant-id': merchantId,
  };

  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${pathname}`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      const body = await response.text();

      let json;
      try {
        json = JSON.parse(body);
      } catch {
        throw new Error(`Non-JSON response from ${pathname}: HTTP ${response.status}`);
      }

      if (!response.ok || json.resultType !== 'SUCCESS') {
        const message = json.error?.reason ?? json.error?.title ?? response.statusText;
        throw new Error(`Toss API failed for ${pathname}: ${message}`);
      }

      return json.success;
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        console.warn(`[재시도 ${attempt}/${maxRetries}] ${pathname} 호출 실패 (${error.message}). 2초 후 재시도합니다...`);
        await sleep(2000 * attempt);
      }
    }
  }

  throw lastError;
}

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function comparableMenuData(value) {
  if (!value) {
    return null;
  }

  const {
    fetchedAt: _fetchedAt,
    summary: _summary,
    imageSummary: _imageSummary,
    merchantStatus: _merchantStatus,
    ...stableFields
  } = value;

  return {
    ...stableFields,
    items: (stableFields.items ?? []).map(({ imageStatus: _imageStatus, ...item }) => item),
  };
}

function safeFilePart(value, fallback = 'item') {
  const sanitized = String(value ?? fallback)
    .normalize('NFKC')
    .replace(/[^\w가-힣.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return sanitized || fallback;
}

function extensionFromContentType(contentType) {
  if (!contentType) {
    return '.jpg';
  }

  const normalized = contentType.toLowerCase().split(';')[0].trim();
  if (normalized === 'image/png') {
    return '.png';
  }
  if (normalized === 'image/webp') {
    return '.webp';
  }
  if (normalized === 'image/gif') {
    return '.gif';
  }
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return '.jpg';
  }
  return '.jpg';
}

function firstDefaultPrice(item) {
  return item.prices?.find((price) => price.isDefault) ?? item.prices?.[0] ?? null;
}

function localize(value, fallback, locale = 'en-US') {
  return value?.languages?.[locale] ?? fallback ?? '';
}

function normalizeItem(item, categoryMap) {
  const defaultPrice = firstDefaultPrice(item);
  const category = item.category ?? categoryMap.get(item.categoryId) ?? null;

  return {
    id: item.id,
    categoryId: category?.id ?? null,
    categoryTitle: category?.title ?? '',
    categoryTitleEn: localize(category?.titleI18n, category?.title),
    position: item.position ?? null,
    title: item.title ?? '',
    titleEn: localize(item.titleI18n, item.title),
    description: item.description ?? '',
    descriptionEn: localize(item.descriptionI18n, item.description),
    state: item.state ?? '',
    priceValue: defaultPrice?.priceValue ?? null,
    priceTitle: defaultPrice?.title ?? '',
    imageUrl: item.imageUrl ?? null,
    labels: (item.labels ?? []).map((label) => label.title).filter(Boolean),
    optionSets: (item.optionSets ?? []).map((optionSet) => ({
      id: optionSet.id,
      title: optionSet.title,
      required: Boolean(optionSet.isRequired),
      minChoices: optionSet.minChoices ?? null,
      maxChoices: optionSet.maxChoices ?? null,
      choices: (optionSet.choices ?? []).map((choice) => ({
        id: choice.id,
        title: choice.title,
        priceValue: choice.priceValue ?? 0,
        state: choice.state ?? '',
      })),
    })),
  };
}

function fingerprintItem(item) {
  return stableHash({
    id: item.id,
    categoryId: item.categoryId,
    position: item.position,
    title: item.title,
    description: item.description,
    state: item.state,
    priceValue: item.priceValue,
    imageUrl: item.imageUrl,
    labels: item.labels,
    optionSets: item.optionSets,
  });
}

function toCsvValue(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(items) {
  const headers = [
    'id',
    'category',
    'position',
    'title',
    'description',
    'price',
    'state',
    'labels',
    'image_url',
    'image_local_path',
    'image_hash',
  ];
  const rows = items.map((item) => [
    item.id,
    item.categoryTitle,
    item.position,
    item.title,
    item.description,
    item.priceValue,
    item.state,
    (item.labels ?? []).join('|'),
    item.imageUrl,
    item.imageLocalPath,
    item.imageHash,
  ]);
  return `${[headers, ...rows].map((row) => row.map(toCsvValue).join(',')).join('\n')}\n`;
}

function groupBy(values, getKey) {
  const groups = new Map();
  for (const value of values) {
    const key = getKey(value);
    if (!key) {
      continue;
    }
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function itemSummary(item) {
  return {
    id: item.id,
    categoryTitle: item.categoryTitle,
    title: item.title,
    description: item.description,
    imageLocalPath: item.imageLocalPath,
  };
}

function buildChecks(items) {
  const duplicateImages = [...groupBy(items, (item) => item.imageHash).entries()]
    .filter(([, group]) => group.length > 1)
    .map(([imageHash, group]) => ({
      imageHash,
      imageLocalPath: group[0]?.imageLocalPath ?? null,
      items: group.map(itemSummary),
    }));

  const duplicateTitles = [...groupBy(items, (item) => item.title.trim()).entries()]
    .filter(([, group]) => group.length > 1)
    .map(([title, group]) => ({
      title,
      items: group.map(itemSummary),
    }));

  return {
    missingImages: items.filter((item) => !item.imageUrl || !item.imageLocalPath).map(itemSummary),
    missingDescriptions: items.filter((item) => !item.description?.trim()).map(itemSummary),
    duplicateImages,
    duplicateTitles,
  };
}

async function mapLimit(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function downloadImage(item, imagesDir, state) {
  if (!item.imageUrl) {
    return {
      status: 'missing',
      imageLocalPath: null,
      imageHash: null,
    };
  }

  const existingByUrl = state.imagesByUrl?.[item.imageUrl];
  if (existingByUrl?.localPath && existingByUrl?.hash) {
    return {
      status: 'skipped-existing-url',
      imageLocalPath: existingByUrl.localPath,
      imageHash: existingByUrl.hash,
    };
  }

  let response = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(item.imageUrl, {
        headers: {
          'user-agent': 'Mozilla/5.0',
          referer: `${STORE_BASE}/`,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        response = res;
        break;
      }
    } catch {
      // ignore and retry
    }
    if (attempt < 3) {
      await sleep(1000 * attempt);
    }
  }

  if (!response || !response.ok) {
    return {
      status: `failed-http-${response?.status ?? 'timeout'}`,
      imageLocalPath: null,
      imageHash: null,
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const hash = createHash('sha256').update(buffer).digest('hex');
  const existingByHash = state.imagesByHash?.[hash];

  if (existingByHash?.localPath) {
    state.imagesByUrl[item.imageUrl] = {
      localPath: existingByHash.localPath,
      hash,
      itemId: item.id,
      title: item.title,
      sourceUrl: item.imageUrl,
      updatedAt: new Date().toISOString(),
    };
    return {
      status: 'skipped-existing-hash',
      imageLocalPath: existingByHash.localPath,
      imageHash: hash,
    };
  }

  const ext = extensionFromContentType(response.headers.get('content-type'));
  const fileName = `${item.id}-${safeFilePart(item.title)}-${hash.slice(0, 10)}${ext}`;
  const absolutePath = path.join(imagesDir, fileName);
  const relativePath = path.relative(repoRoot, absolutePath);
  await writeFile(absolutePath, buffer);

  const record = {
    localPath: relativePath,
    hash,
    itemId: item.id,
    title: item.title,
    sourceUrl: item.imageUrl,
    updatedAt: new Date().toISOString(),
  };
  state.imagesByUrl[item.imageUrl] = record;
  state.imagesByHash[hash] = record;

  return {
    status: 'downloaded',
    imageLocalPath: relativePath,
    imageHash: hash,
  };
}

function summarize(previousItemsById, items) {
  let added = 0;
  let changed = 0;
  let unchanged = 0;

  for (const item of items) {
    const previousHash = previousItemsById?.[item.id]?.fingerprint;
    if (!previousHash) {
      added += 1;
    } else if (previousHash !== item.fingerprint) {
      changed += 1;
    } else {
      unchanged += 1;
    }
  }

  const currentIds = new Set(items.map((item) => String(item.id)));
  const removed = Object.keys(previousItemsById ?? {}).filter((id) => !currentIds.has(id)).length;

  return {
    total: items.length,
    added,
    changed,
    unchanged,
    removed,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const merchantId = parseMerchantId(args.merchantInput);
  const outputRoot = path.resolve(repoRoot, args.outputDir, merchantId);
  const imagesDir = path.join(outputRoot, 'images');
  const statePath = path.join(outputRoot, 'state.json');
  const menuPath = path.join(outputRoot, 'menu.json');
  const csvPath = path.join(outputRoot, 'menu.csv');

  await mkdir(imagesDir, { recursive: true });

  const previousMenu = await readJsonIfExists(menuPath, null);

  const state = await readJsonIfExists(statePath, {
    merchantId,
    imagesByUrl: {},
    imagesByHash: {},
    itemsById: {},
    runs: [],
  });
  state.imagesByUrl ??= {};
  state.imagesByHash ??= {};
  state.itemsById ??= {};
  state.runs ??= [];

  console.log(`Fetching Toss menu for merchant ${merchantId}...`);

  const [merchantPayload, statusPayload, categoriesPayload, itemsPayload] = await Promise.all([
    fetchSuccess(`/api-public/mobile-order/v1/merchants?merchantIds=${merchantId}`, merchantId),
    fetchSuccess(`/api-public/mobile-order/v1/merchants/merchant-status?merchantIds=${merchantId}`, merchantId),
    fetchSuccess('/api-public/mobile-order/v1/catalog/categories', merchantId).catch(() => null),
    fetchSuccess(`/api-public/mobile-order/v2/catalog/items?merchantId=${merchantId}`, merchantId),
  ]);

  const merchant = merchantPayload.merchants?.[0] ?? { id: Number(merchantId) };
  const merchantStatus = statusPayload.merchantStatusList?.[0] ?? null;

  let categories = [];
  if (categoriesPayload?.categories) {
    categories = categoriesPayload.categories.map((category) => ({
      id: category.id,
      title: category.title,
      titleEn: localize(category.titleI18n, category.title),
      order: category.order,
      kioskOrder: category.kioskOrder,
      default: Boolean(category.default),
      enabled: category.kioskEnabled !== false,
    }));
  } else {
    const extractedMap = new Map();
    for (const rawItem of itemsPayload?.items ?? []) {
      if (rawItem.category && !extractedMap.has(rawItem.category.id)) {
        extractedMap.set(rawItem.category.id, {
          id: rawItem.category.id,
          title: rawItem.category.title,
          titleEn: localize(rawItem.category.titleI18n, rawItem.category.title),
          order: rawItem.category.order ?? 999,
          kioskOrder: rawItem.category.kioskOrder ?? 999,
          default: Boolean(rawItem.category.default),
          enabled: rawItem.category.kioskEnabled !== false,
        });
      }
    }
    categories = [...extractedMap.values()];
  }
  categories.sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const categoryMap = new Map(categories.map((category) => [category.id, category]));

  const dedupedById = new Map();
  for (const rawItem of itemsPayload.items ?? []) {
    dedupedById.set(rawItem.id, normalizeItem(rawItem, categoryMap));
  }

  const items = [...dedupedById.values()]
    .sort((left, right) => {
      const categoryOrderLeft = categoryMap.get(left.categoryId)?.order ?? 999999;
      const categoryOrderRight = categoryMap.get(right.categoryId)?.order ?? 999999;
      return categoryOrderLeft - categoryOrderRight || (left.position ?? 0) - (right.position ?? 0) || left.id - right.id;
    })
    .map((item) => ({
      ...item,
      fingerprint: fingerprintItem(item),
      imageLocalPath: null,
      imageHash: null,
      imageStatus: item.imageUrl ? 'pending' : 'missing',
    }));

  if (args.images) {
    const imageResults = await mapLimit(items, args.concurrency, (item) => downloadImage(item, imagesDir, state));
    for (let index = 0; index < items.length; index += 1) {
      items[index].imageStatus = imageResults[index].status;
      items[index].imageLocalPath = imageResults[index].imageLocalPath;
      items[index].imageHash = imageResults[index].imageHash;
    }
  } else {
    for (const item of items) {
      const existing = item.imageUrl ? state.imagesByUrl[item.imageUrl] : null;
      item.imageStatus = item.imageUrl ? (existing ? 'skipped-existing-url' : 'not-downloaded') : 'missing';
      item.imageLocalPath = existing?.localPath ?? null;
      item.imageHash = existing?.hash ?? null;
    }
  }

  const summary = summarize(state.itemsById, items);
  const imageSummary = items.reduce((acc, item) => {
    acc[item.imageStatus] = (acc[item.imageStatus] ?? 0) + 1;
    return acc;
  }, {});
  const checks = buildChecks(items);

  const runAt = new Date().toISOString();
  const nextItemsById = Object.fromEntries(
    items.map((item) => {
      const previous = state.itemsById[item.id];
      const hasItemChanged = !previous
        || previous.fingerprint !== item.fingerprint
        || previous.imageLocalPath !== item.imageLocalPath
        || previous.imageHash !== item.imageHash;

      return [
        item.id,
        {
          fingerprint: item.fingerprint,
          title: item.title,
          description: item.description,
          imageUrl: item.imageUrl,
          imageLocalPath: item.imageLocalPath,
          imageHash: item.imageHash,
          firstSeenAt: previous?.firstSeenAt ?? previous?.updatedAt ?? runAt,
          updatedAt: hasItemChanged ? runAt : (previous.updatedAt ?? runAt),
        },
      ];
    }),
  );

  const output = {
    merchantId: Number(merchantId),
    merchantName: merchant.name ?? '',
    merchantStatus: merchantStatus?.status ?? merchant.status ?? '',
    fetchedAt: runAt,
    summary,
    imageSummary,
    checks,
    categories,
    items,
    foodOrigin: itemsPayload.foodOrigin ?? null,
  };

  const contentChanged = stableHash(comparableMenuData(previousMenu)) !== stableHash(comparableMenuData(output));

  if (!contentChanged) {
    console.log(JSON.stringify({
      changed: false,
      merchant: output.merchantName,
      status: output.merchantStatus,
      summary,
      message: 'No menu content changes. Existing files were preserved.',
    }, null, 2));
    return;
  }

  state.itemsById = nextItemsById;
  state.lastRunAt = runAt;
  state.runs.push({
    at: runAt,
    summary,
    imageSummary,
  });
  state.runs = state.runs.slice(-20);

  await writeJson(menuPath, output);
  await writeText(csvPath, toCsv(items));

  const tmpStatePath = `${statePath}.tmp`;
  await writeJson(tmpStatePath, state);
  await rename(tmpStatePath, statePath);

  console.log(JSON.stringify({
    changed: true,
    merchant: output.merchantName,
    status: output.merchantStatus,
    summary,
    imageSummary,
    checks: {
      missingImages: checks.missingImages.length,
      missingDescriptions: checks.missingDescriptions.length,
      duplicateImages: checks.duplicateImages.length,
      duplicateTitles: checks.duplicateTitles.length,
    },
    files: {
      menu: path.relative(repoRoot, menuPath),
      csv: path.relative(repoRoot, csvPath),
      state: path.relative(repoRoot, statePath),
      images: path.relative(repoRoot, imagesDir),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
