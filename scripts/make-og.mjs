#!/usr/bin/env node
/**
 * The picture on a shared link.
 *
 * The site had none. index.html declared `twitter:card = summary_large_image`
 * and then named no image, so X asked for a picture, found nothing, and drew
 * the bare grey link box -- while rotabo.app, which has an og:image, shows a
 * card. The company and gift pages carried no social tags at all, which is
 * worse: those are the pages a CEO would actually post.
 *
 * The card is drawn here rather than made by hand so it cannot drift from the
 * site: the same ink, the same gold, the same wordmark with the dot in the
 * accent, the same tagline. Nothing in it goes stale -- no price, no count of
 * seats, no list of companies. The price belongs in the description text,
 * which is one edit away, not in a picture that has to be redrawn.
 *
 * Needs sharp, which is not kept in the repository: this runs when the mark
 * changes, which is rarely.
 *
 *   npm i --no-save sharp
 *   node scripts/make-og.mjs          writes og-image.png
 *   node scripts/make-og.mjs --check  fails if it is missing or the wrong
 *                                     size; needs no sharp
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'og-image.png');

/* assets/style.css, the dark theme -- which is the one a card should wear:
   it is shown on somebody else's timeline, not on our page, and the dark
   card is the one that reads as ours rather than as a blank. */
const INK = '#1c1b19';   /* --bg, dark theme, and the favicon's square */
const PAPER = '#faf9f7'; /* --bg, light theme: the text on the dark card */
const GOLD = '#d9a63c';  /* --accent, dark theme */
const DIM = '#a09b93';   /* --dim, dark theme */

/* The stacks the site sets itself in, resolved by whatever is installed
   where this runs. Liberation Sans and Liberation Serif are metric matches
   for the Helvetica and Georgia the browser picks. */
const SANS = 'Liberation Sans, Helvetica, Arial, DejaVu Sans, sans-serif';
const SERIF = 'Liberation Serif, Georgia, DejaVu Serif, serif';

/* 1200 x 630, in the order the front page says it: the name, what the site
   is for, and who it is for. Set above the middle rather than on it: the
   block reads as centred when its own mass is centred, and the mass of
   this one is the wordmark at the top. */
function card() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <rect width="1200" height="630" fill="${INK}"/>
  <rect width="1200" height="8" fill="${GOLD}"/>
  <text x="600" y="268" text-anchor="middle" font-family="${SANS}"
        font-size="132" font-weight="800" letter-spacing="-5" fill="${PAPER}">gift<tspan fill="${GOLD}">.</tspan>ceo</text>
  <text x="600" y="366" text-anchor="middle" font-family="${SERIF}"
        font-size="54" font-weight="400" letter-spacing="-.5" fill="${PAPER}">Only CEOs give here.</text>
  <text x="600" y="436" text-anchor="middle" font-family="${SANS}"
        font-size="30" font-weight="400" fill="${DIM}">A public list of gifts given personally by CEOs,</text>
  <text x="600" y="478" text-anchor="middle" font-family="${SANS}"
        font-size="30" font-weight="400" fill="${DIM}">under their own name and their company's name.</text>
</svg>
`;
}

/* Width and height out of a PNG's first chunk, so --check needs no library. */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

if (process.argv.includes('--check')) {
  const am = existsSync(OUT) ? pngSize(readFileSync(OUT)) : null;
  if (!am || am[0] !== 1200 || am[1] !== 630) {
    console.error(`make-og: og-image.png is ${am ? am.join('x') : 'missing'}, expected 1200x630`);
    console.error('make-og: run npm i --no-save sharp && node scripts/make-og.mjs');
    process.exit(1);
  }
  console.log('make-og: og-image.png present and 1200x630.');
  process.exit(0);
}

let sharp;
try { sharp = (await import('sharp')).default; }
catch {
  console.error('make-og: needs sharp to draw the card. Run: npm i --no-save sharp');
  process.exit(2);
}

/* Drawn at twice the size and scaled down, so the type is smooth rather than
   stepped where the strokes are thin. */
await sharp(Buffer.from(card()), { density: 144 })
  .resize(1200, 630)
  .png({ compressionLevel: 9 })
  .toFile(OUT);
console.log('make-og: og-image.png  (1200 x 630)');
