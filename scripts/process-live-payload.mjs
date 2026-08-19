import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function stableHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeFilePart(value, fallback = 'item') {
  const sanitized = String(value ?? fallback)
    .normalize('NFKC')
    .replace(/[^\w가-힣.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return sanitized || fallback;
}

function localize(value, fallback, locale = 'en-US') {
  return value?.languages?.[locale] ?? fallback ?? '';
}

function firstDefaultPrice(item) {
  return item.prices?.find((price) => price.isDefault) ?? item.prices?.[0] ?? null;
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

function itemSummary(item) {
  return {
    id: item.id,
    categoryTitle: item.categoryTitle,
    title: item.title,
    description: item.description,
    imageLocalPath: item.imageLocalPath,
  };
}

function groupBy(values, getKey) {
  const groups = new Map();
  for (const value of values) {
    const key = getKey(value);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
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

export async function processLivePayload(liveRawPayload, state) {
  const merchantId = '238090';
  const outputRoot = path.join(ROOT, 'data/tossplace-menu', merchantId);
  const imagesDir = path.join(outputRoot, 'images');
  const menuPath = path.join(outputRoot, 'menu.json');
  const csvPath = path.join(outputRoot, 'menu.csv');
  const statePath = path.join(outputRoot, 'state.json');

  const rawItems = liveRawPayload.success.items;

  // Extract categories
  const categoryMap = new Map();
  for (const rawItem of rawItems) {
    if (rawItem.category && !categoryMap.has(rawItem.category.id)) {
      categoryMap.set(rawItem.category.id, {
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
  const categories = [...categoryMap.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const dedupedById = new Map();
  for (const rawItem of rawItems) {
    dedupedById.set(rawItem.id, normalizeItem(rawItem, categoryMap));
  }

  const items = [...dedupedById.values()]
    .sort((left, right) => {
      const categoryOrderLeft = categoryMap.get(left.categoryId)?.order ?? 999999;
      const categoryOrderRight = categoryMap.get(right.categoryId)?.order ?? 999999;
      return categoryOrderLeft - categoryOrderRight || (left.position ?? 0) - (right.position ?? 0) || left.id - right.id;
    })
    .map((item) => {
      const existingByUrl = item.imageUrl ? state.imagesByUrl?.[item.imageUrl] : null;
      return {
        ...item,
        fingerprint: fingerprintItem(item),
        imageLocalPath: existingByUrl?.localPath ?? null,
        imageHash: existingByUrl?.hash ?? null,
        imageStatus: item.imageUrl ? (existingByUrl ? 'skipped-existing-url' : 'not-downloaded') : 'missing',
      };
    });

  const summary = {
    total: items.length,
    added: items.filter(i => !state.itemsById[i.id]).length,
    changed: items.filter(i => state.itemsById[i.id] && state.itemsById[i.id].fingerprint !== i.fingerprint).length,
    unchanged: items.filter(i => state.itemsById[i.id] && state.itemsById[i.id].fingerprint === i.fingerprint).length,
    removed: Object.keys(state.itemsById).filter(id => !dedupedById.has(Number(id))).length,
  };

  const imageSummary = items.reduce((acc, item) => {
    acc[item.imageStatus] = (acc[item.imageStatus] ?? 0) + 1;
    return acc;
  }, {});

  const checks = buildChecks(items);
  const runAt = new Date().toISOString();

  const output = {
    merchantId: 238090,
    merchantName: "클루미 유니버스",
    merchantStatus: "OPEN",
    fetchedAt: runAt,
    summary,
    imageSummary,
    checks,
    categories,
    items,
    foodOrigin: liveRawPayload.success.foodOrigin ?? null,
  };

  // Update state
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

  state.itemsById = nextItemsById;
  state.lastRunAt = runAt;
  state.runs.push({ at: runAt, summary, imageSummary });
  state.runs = state.runs.slice(-20);

  await writeFile(menuPath, JSON.stringify(output, null, 2) + '\n', 'utf8');
  await writeFile(csvPath, toCsv(items), 'utf8');
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf8');

  console.log(`Updated menu.json with ${items.length} items.`);
  return output;
}
