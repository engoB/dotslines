// Renders the PNG app icons from SVG with Playwright's Chromium.
// Usage: node scripts/generate-icons.mjs   (needs `playwright` available)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const font = readFileSync('node_modules/@fontsource/m-plus-rounded-1c/files/m-plus-rounded-1c-latin-800-normal.woff2').toString('base64');
const fontFace = `<style>@font-face{font-family:Rounded;font-weight:800;src:url(data:font/woff2;base64,${font}) format('woff2')}</style>`;

const BLUE = '#1d9bf0';
const RED = '#ff4b55';
const INK = '#2f3542';

/** A 2×2 corner of the board: one blue tile, blue and red lines, round pegs. */
const art = (inset) => {
  const a = inset;
  const b = 100 - inset;
  const m = (a + b) / 2;
  const w = (b - a) * 0.11;
  const pad = (m - a) * 0.12;
  const peg = (x, y) => `<circle cx="${x}" cy="${y}" r="${w * 0.8}" fill="${INK}"/><circle cx="${x - w * 0.25}" cy="${y - w * 0.27}" r="${w * 0.28}" fill="#fff" opacity="0.4"/>`;
  const line = (x1, y1, x2, y2, c) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`;
  return `
  <rect x="${m + pad}" y="${a + pad}" width="${m - a - 2 * pad}" height="${m - a - 2 * pad}" rx="${(m - a) * 0.16}" fill="#f2f4f8"/>
  <rect x="${a + pad}" y="${m + pad}" width="${m - a - 2 * pad}" height="${m - a - 2 * pad}" rx="${(m - a) * 0.16}" fill="#f2f4f8"/>
  <rect x="${m + pad}" y="${m + pad}" width="${m - a - 2 * pad}" height="${m - a - 2 * pad}" rx="${(m - a) * 0.16}" fill="#f2f4f8"/>
  <rect x="${a + pad}" y="${a + pad}" width="${m - a - 2 * pad}" height="${m - a - 2 * pad}" rx="${(m - a) * 0.2}" fill="${BLUE}"/>
  <text x="${(a + m) / 2}" y="${(a + m) / 2 + (m - a) * 0.15}" font-family="Rounded" font-weight="800" font-size="${(m - a) * 0.42}" text-anchor="middle" fill="#fff">J1</text>
  ${line(a, a, m, a, BLUE)}${line(a, a, a, m, BLUE)}${line(m, a, m, m, BLUE)}${line(a, m, m, m, BLUE)}
  ${line(m, a, b, a, RED)}${line(b, a, b, m, RED)}${line(a, m, a, b, RED)}${line(m, m, b, m, BLUE)}
  ${[a, m, b].flatMap((y) => [a, m, b].map((x) => peg(x, y))).join('')}`;
};

const icon = ({ rounded, inset }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <rect width="100" height="100" ${rounded ? 'rx="22"' : ''} fill="#ffffff"/>
  ${art(inset)}
</svg>`;

const targets = [
  { file: 'public/pwa-192.png', size: 192, rounded: true, inset: 20 },
  { file: 'public/pwa-512.png', size: 512, rounded: true, inset: 20 },
  { file: 'public/maskable-512.png', size: 512, rounded: false, inset: 27 },
  { file: 'public/apple-touch-icon.png', size: 180, rounded: false, inset: 20 }
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><head>${fontFace}</head><body style="margin:0;background:transparent">${icon(t)}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(t.file, await page.screenshot({ omitBackground: true }));
  console.log('wrote', t.file);
}
// The favicon is the same artwork as a plain SVG (without the embedded font).
writeFileSync('public/favicon.svg', icon({ rounded: true, inset: 18 }).replace(/<text[^>]*>J1<\/text>/, '').replace(' width="100%" height="100%"', '') + '\n');
console.log('wrote public/favicon.svg');
await browser.close();
