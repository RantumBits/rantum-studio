#!/usr/bin/env node
/**
 * Self-test for scripts/site-links-check.js.
 *
 * A check that finds nothing may be broken, so every rule gets a positive
 * control: a fixture that is complete must pass, and removing a page from any
 * one surface must fail naming that page and that surface. Zero dependencies,
 * drives the real CLI as a subprocess so the exit codes are what is tested.
 *
 * Run: npm run test:links
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECK = path.resolve(__dirname, 'site-links-check.js');
const URL = (rel) => `https://rantum.xyz/${rel}`;
const sitemap = (rels) => `<?xml version="1.0"?>\n<urlset>\n${rels.map((r) => `  <url><loc>${URL(r)}</loc></url>`).join('\n')}\n</urlset>\n`;

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-links-test-'));
  fs.mkdirSync(path.join(dir, 'case-studies'));
  fs.mkdirSync(path.join(dir, 'research'));
  fs.writeFileSync(path.join(dir, 'case-studies/alpha.html'), '<html></html>\n');
  fs.writeFileSync(path.join(dir, 'research/beta.html'), '<html></html>\n');
  fs.writeFileSync(path.join(dir, 'case-studies/index.html'), '<a href="alpha.html">Alpha</a>\n');
  fs.writeFileSync(path.join(dir, 'sitemap.xml'), sitemap(['case-studies/alpha.html', 'research/beta.html']));
  fs.writeFileSync(path.join(dir, 'sitemap-2026.xml'), sitemap(['case-studies/alpha.html', 'research/beta.html']));
  fs.writeFileSync(path.join(dir, 'llms.txt'), '- Alpha — /case-studies/alpha.html\n- Beta — https://rantum.xyz/research/beta.html\n');
  return dir;
}

function run(dir) {
  const r = spawnSync(process.execPath, [CHECK, '--root', dir], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

let failures = 0;
function expect(name, cond, detail) {
  if (cond) { console.log(`ok   ${name}`); return; }
  failures++; console.log(`FAIL ${name}\n${detail}`);
}

// Positive control: a complete fixture passes.
{
  const d = fixture(); const r = run(d);
  expect('complete fixture passes', r.code === 0 && /2 page\(s\)/.test(r.out), r.out);
}
// Each surface, removed one at a time, must fail naming page and surface.
const cases = [
  ['index card', (d) => fs.writeFileSync(path.join(d, 'case-studies/index.html'), '\n'), /alpha\.html: no card in case-studies\/index\.html/],
  ['sitemap.xml', (d) => fs.writeFileSync(path.join(d, 'sitemap.xml'), sitemap(['research/beta.html'])), /alpha\.html: not in sitemap\.xml/],
  ['sitemap-2026.xml', (d) => fs.writeFileSync(path.join(d, 'sitemap-2026.xml'), sitemap(['research/beta.html'])), /alpha\.html: not in sitemap-2026\.xml/],
  ['llms.txt', (d) => fs.writeFileSync(path.join(d, 'llms.txt'), '- Alpha — /case-studies/alpha.html\n'), /research\/beta\.html: not in llms\.txt/],
];
for (const [name, mutate, re] of cases) {
  const d = fixture(); mutate(d); const r = run(d);
  expect(`missing from ${name} fails`, r.code === 1 && re.test(r.out), r.out);
}
// Sitemaps out of sync is reported from both sides.
{
  const d = fixture();
  fs.writeFileSync(path.join(d, 'sitemap-2026.xml'), sitemap(['research/beta.html']));
  const r = run(d);
  expect('sitemaps out of sync fails', r.code === 1 && /sitemap-2026\.xml: missing .*alpha\.html \(present in sitemap\.xml\)/.test(r.out), r.out);
}
// A stale <loc> for a page that no longer exists fails.
{
  const d = fixture();
  const both = sitemap(['case-studies/alpha.html', 'research/beta.html', 'case-studies/gone.html']);
  fs.writeFileSync(path.join(d, 'sitemap.xml'), both); fs.writeFileSync(path.join(d, 'sitemap-2026.xml'), both);
  const r = run(d);
  expect('stale sitemap entry fails', r.code === 1 && /lists case-studies\/gone\.html, which does not exist/.test(r.out), r.out);
}
// index.html itself is never a page to be linked.
{
  const d = fixture(); fs.writeFileSync(path.join(d, 'research/index.html'), '\n'); const r = run(d);
  expect('index.html is excluded', r.code === 0, r.out);
}
if (failures) { console.log(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nall site-links-check self-tests passed');
