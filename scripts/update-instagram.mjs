#!/usr/bin/env node

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = path.join(ROOT, 'data/instagram.json');
const IMAGE_DIR = path.join(ROOT, 'assets/instagram');

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!['url', 'image', 'caption'].includes(key) || !value) {
      throw new Error('사용법: node scripts/update-instagram.mjs --url <게시물 URL> --image <이미지 경로> --caption <설명>');
    }
    values[key] = value;
  }
  if (!values.url || !values.image || !values.caption) throw new Error('--url, --image, --caption이 모두 필요합니다.');
  const url = new URL(values.url);
  if (url.hostname !== 'www.instagram.com' && url.hostname !== 'instagram.com') throw new Error('Instagram 게시물 URL만 사용할 수 있습니다.');
  const [type, id] = url.pathname.split('/').filter(Boolean);
  if (!['p', 'reel'].includes(type) || !/^[\w-]+$/.test(id || '')) throw new Error('Instagram 게시물 또는 릴스 URL 형식이 아닙니다.');
  const caption = values.caption.trim();
  if (!caption) throw new Error('비어 있지 않은 캡션이 필요합니다.');
  return { ...values, id, caption };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = path.resolve(args.image);
  const extension = path.extname(source).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) throw new Error('JPG, PNG, WEBP 이미지만 사용할 수 있습니다.');

  const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  const filename = `instagram-${args.id}${extension}`;
  await copyFile(source, path.join(IMAGE_DIR, filename));

  const post = {
    id: args.id,
    permalink: args.url,
    image: `assets/instagram/${filename}`,
    caption: args.caption.slice(0, 140),
    timestamp: new Date().toISOString(),
  };
  data.posts = [post, ...(data.posts || []).filter(item => item.id !== args.id)].slice(0, 4);
  await writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`Instagram 게시물 추가 완료: ${args.id}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
