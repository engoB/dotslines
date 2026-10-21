// Renders the PNG app icons from SVG with Playwright's Chromium.
// Usage: node scripts/generate-icons.mjs   (needs `playwright` available)
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const caveat = readFileSync('node_modules/@fontsource/caveat/files/caveat-latin-700-normal.woff2').toString('base64');
const fontFace = `<style>@font-face{font-family:Caveat;font-weight:700;src:url(data:font/woff2;base64,${caveat}) format('woff2')}</style>`;

const art = (inset) => {
  const a = inset;
  const b = 100 - inset;
  return `
  <rect x="${a}" y="${a}" width="${b - a}" height="${b - a}" fill="#2f6fdb" opacity="0.12"/>
  <path d="M${a} ${a} L${b} ${a + 0.6} M${a + 0.4} ${a} L${a - 0.3} ${b}" stroke="#2f6fdb" stroke-width="7" stroke-linecap="round" fill="none"/>
  <path d="M${b} ${a} L${b + 0.4} ${b} M${a} ${b} L${b} ${b - 0.5}" stroke="#e2574c" stroke-width="7" stroke-linecap="round" fill="none"/>
  <text x="50" y="${50 + (b - a) * 0.17}" font-family="Caveat, cursive" font-weight="700" font-size="${(b - a) * 0.62}" text-anchor="middle" fill="#2f6fdb">J1</text>
  ${[[a, a], [b, a], [a, b], [b, b]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6.5" fill="#1f2a44"/>`).join('')}`;
};

const icon = ({ rounded, inset }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
  <rect width="100" height="100" ${rounded ? 'rx="20"' : ''} fill="#f6f2e9"/>
  <g stroke="rgba(70,110,170,0.28)" stroke-width="0.6">
    ${Array.from({ length: 9 }, (_, i) => `<line x1="${(i + 1) * 10}" y1="0" x2="${(i + 1) * 10}" y2="100"/><line x1="0" y1="${(i + 1) * 10}" x2="100" y2="${(i + 1) * 10}"/>`).join('')}
  </g>
  ${art(inset)}
</svg>`;

const targets = [
  { file: 'public/pwa-192.png', size: 192, rounded: true, inset: 22 },
  { file: 'public/pwa-512.png', size: 512, rounded: true, inset: 22 },
  { file: 'public/maskable-512.png', size: 512, rounded: false, inset: 30 },
  { file: 'public/apple-touch-icon.png', size: 180, rounded: false, inset: 24 }
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
await browser.close();
