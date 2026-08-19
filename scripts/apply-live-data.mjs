import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processLivePayload } from './process-live-payload.mjs';
import { buildSiteMenu } from './generate-site-data.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const liveRaw = JSON.parse(await readFile(path.join(ROOT, 'data/live-items-temp.json'), 'utf8'));
  const statePath = path.join(ROOT, 'data/tossplace-menu/238090/state.json');
  const state = JSON.parse(await readFile(statePath, 'utf8'));

  console.log('Processing live payload...');
  const menuOutput = await processLivePayload(liveRaw, state);

  // Update featured.json with valid IDs
  const featuredPath = path.join(ROOT, 'data/featured.json');
  let featured = JSON.parse(await readFile(featuredPath, 'utf8'));
  const validItemIds = new Set(menuOutput.items.map(i => i.id));
  
  // Filter out missing featured IDs and replace with valid signature/popular items if needed
  featured = featured.filter(id => validItemIds.has(id));
  
  // Map missing featured items to new equivalents
  // Old 10683603 (피스타치오 초코 반하나 와플) -> New 13137641 ([피스타치오]초코 반하나와플)
  // Old 7735791 (클래식 와플) -> New 16230479 ([시즌한정]무화과&크림치즈 와플)
  // Old 7735937 (블루베리 크림치즈 와플) -> New 10991140 (내맘대로 브런치(Basic waffle))
  // Add new popular items: 15684889 (복숭아 한 컵), 15684885 (애플망고 한 컵), 12936713 ([여름 시그니처] 오렌지 비앙코)
  const newFeaturedCandidates = [13137641, 16230479, 10991140, 15684889, 15684885, 12936713, 11075478, 9142726, 6979310];
  for (const id of newFeaturedCandidates) {
    if (validItemIds.has(id) && !featured.includes(id)) {
      featured.push(id);
    }
  }

  await writeFile(featuredPath, JSON.stringify(featured, null, 2) + '\n', 'utf8');
  console.log('Updated featured.json:', featured);

  // Generate site menu data
  console.log('Generating site menu data...');
  const siteMenuData = await buildSiteMenu({ optimizeImages: false });
  await writeFile(path.join(ROOT, 'data/site-menu.json'), JSON.stringify(siteMenuData, null, 2) + '\n', 'utf8');
  console.log(`Generated site-menu.json with ${siteMenuData.items.length} items!`);
}

main().catch(err => {
  console.error('Error in apply-live-data:', err);
  process.exit(1);
});
