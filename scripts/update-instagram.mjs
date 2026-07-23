#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data/instagram.json');
const IMAGE_DIR = path.join(ROOT, 'assets/instagram');
const runFile = promisify(execFile);
const ARGUMENT_KEYS = new Set(['url', 'image', 'caption', 'alt', 'date']);

function usage() {
  return '사용법: node scripts/update-instagram.mjs --url <게시물 URL> --image <이미지 경로> --caption <설명> --date <YYYY-MM-DD> [--alt <대체 텍스트>]';
}

function parseArgs(argv) {
  if (!argv.length || argv.length % 2 !== 0) throw new Error(usage());
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!ARGUMENT_KEYS.has(key) || !value) throw new Error(usage());
    if (key in values) throw new Error(`--${key} 옵션이 중복되었습니다.`);
    values[key] = value;
  }
  if (!values.url || !values.image || !values.caption || !values.date) {
    throw new Error('--url, --image, --caption, --date가 모두 필요합니다.');
  }
  const url = new URL(values.url);
  if (url.hostname !== 'www.instagram.com' && url.hostname !== 'instagram.com') throw new Error('Instagram 게시물 URL만 사용할 수 있습니다.');
  const pathParts = url.pathname.split('/').filter(Boolean);
  const typeIndex = pathParts[0] === 'clumi.universe' ? 1 : 0;
  const type = pathParts[typeIndex];
  const id = pathParts[typeIndex + 1];
  if (!['p', 'reel'].includes(type) || !/^[\w-]+$/.test(id || '')) throw new Error('Instagram 게시물 또는 릴스 URL 형식이 아닙니다.');
  const caption = values.caption.trim();
  if (!caption) throw new Error('비어 있지 않은 캡션이 필요합니다.');
  const alt = String(values.alt || caption).trim();
  if (!alt) throw new Error('비어 있지 않은 대체 텍스트가 필요합니다.');
  const publishedDate = /^\d{4}-\d{2}-\d{2}$/.test(values.date)
    ? new Date(`${values.date}T00:00:00Z`)
    : null;
  if (!publishedDate || Number.isNaN(publishedDate.getTime())
    || publishedDate.toISOString().slice(0, 10) !== values.date) {
    throw new Error('--date는 YYYY-MM-DD 형식의 실제 날짜여야 합니다.');
  }
  return {
    ...values,
    id,
    type: type === 'reel' ? 'reel' : 'post',
    caption,
    alt,
    permalink: `https://www.instagram.com/${type}/${id}/`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = path.resolve(args.image);
  const extension = path.extname(source).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new Error('JPG, PNG, WEBP 이미지만 사용할 수 있습니다.');

  const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  const filename = `instagram-${args.id}.webp`;
  const outputPath = path.join(IMAGE_DIR, filename);
  if (extension === '.webp') {
    await copyFile(source, outputPath);
  } else {
    try {
      await runFile('cwebp', ['-quiet', '-q', '80', '-m', '6', source, '-o', outputPath]);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error('Instagram 이미지 최적화에 cwebp가 필요합니다. macOS는 `brew install webp`로 설치하세요.');
      }
      throw error;
    }
  }

  const post = {
    id: args.id,
    type: args.type,
    permalink: args.permalink,
    image: `assets/instagram/${filename}`,
    caption: args.caption.slice(0, 140),
    alt: args.alt.slice(0, 180),
    publishedAt: args.date,
    imagePosition: '50% 50%',
  };
  data.updatedAt = new Date().toISOString().slice(0, 10);
  data.posts = [post, ...(data.posts || []).filter(item => item.id !== args.id)]
    .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .slice(0, 4);
  await writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Instagram 게시물 추가 완료: ${args.id}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
