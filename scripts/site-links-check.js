#!/usr/bin/env node
/**
 * Site links check for rantum.xyz: every published page is reachable from
 * every surface that lists pages, and the two sitemaps agree.
 *
 * Why this exists. Adding a case study means touching four files by hand —
 * the card in case-studies/index.html, sitemap.xml, sitemap-2026.xml (the one
 * robots.txt declares, so the only one Google reads) and llms.txt — and that
 * routine has failed on four of the last six new pages: a8d52c9 (four pages
 * missing from the sitemap, three orphaned from the index), b5b2b86 ("add the
 * two new case studies to the file Google actually reads"), #49 (resync after
 * #47 landed in sitemap.xml only), #50 (link the orphaned revert-rate study),
 * and #56 (sitemap.xml only, again, caught in review). Each miss cost a
 * follow-up PR and days of a live page Google could not attribute to a
 * sitemap. The first run of this check also surfaced a page in neither
 * sitemap and llms.txt four pages behind.
 *
 * What it checks, per page under case-studies/ and research/ (index.html
 * excluded):
 *   - case studies: an href in case-studies/index.html
 *   - every page: a <loc> in sitemap.xml AND in sitemap-2026.xml
 *   - every page: a mention in llms.txt (relative path or full URL)
 * And two invariants across files:
 *   - every case-studies/ or research/ <loc> in either sitemap exists on disk
 *   - the two sitemaps carry the same set of <loc>s (the #49 "resync" rule)
 *
 * Zero dependencies on purpose, same principle as publish-gate.js: a check
 * that needs an install can fail for reasons that have nothing to do with
 * links, and a failing install would let it fail open.
 *
 * Usage:
 *   node scripts/site-links-check.js            # the repo
 *   node scripts/site-links-check.js --root DIR # a fixture (used by the test)
 * Exit 1 with one line per problem; exit 0 with a count when clean.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://rantum.xyz';
const SECTIONS = ['case-studies', 'research'];

function parseArgs(argv) {
  const i = argv.indexOf('--root');
  return { root: i >= 0 ? path.resolve(argv[i + 1]) : path.resolve(__dirname, '..') };
}

function read(root, rel) {
  const p = path.join(root, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function pages(root) {
  const out = [];
  for (const section of SECTIONS) {
    const dir = path.join(root, section);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (!name.endsWith('.html') || name === 'index.html') continue;
      out.push({ section, name, rel: `${section}/${name}` });
    }
  }
  return out;
}

function locs(xml) {
  const set = new Set();
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let m;
  while ((m = re.exec(xml))) set.add(m[1]);
  return set;
}

function check(root) {
  const problems = [];
  const index = read(root, 'case-studies/index.html');
  const llms = read(root, 'llms.txt');
  const maps = {};
  for (const f of ['sitemap.xml', 'sitemap-2026.xml']) {
    const xml = read(root, f);
    if (xml === null) { problems.push(`${f}: missing`); continue; }
    maps[f] = locs(xml);
  }
  if (index === null) problems.push('case-studies/index.html: missing');
  if (llms === null) problems.push('llms.txt: missing');

  const all = pages(root);
  for (const p of all) {
    const url = `${ORIGIN}/${p.rel}`;
    if (p.section === 'case-studies' && index !== null && !index.includes(`href="${p.name}"`)) {
      problems.push(`${p.rel}: no card in case-studies/index.html`);
    }
    for (const f of Object.keys(maps)) {
      if (!maps[f].has(url)) problems.push(`${p.rel}: not in ${f}`);
    }
    if (llms !== null && !llms.includes(`/${p.rel}`)) {
      problems.push(`${p.rel}: not in llms.txt`);
    }
  }

  // Stale entries: a listed page that no longer exists.
  for (const f of Object.keys(maps)) {
    for (const url of maps[f]) {
      const rel = url.startsWith(ORIGIN + '/') ? url.slice(ORIGIN.length + 1) : null;
      if (!rel || !SECTIONS.some((s) => rel.startsWith(s + '/'))) continue;
      if (!fs.existsSync(path.join(root, rel))) problems.push(`${f}: lists ${rel}, which does not exist`);
    }
  }

  // The two sitemaps must agree (#49).
  if (maps['sitemap.xml'] && maps['sitemap-2026.xml']) {
    for (const url of maps['sitemap.xml']) {
      if (!maps['sitemap-2026.xml'].has(url)) problems.push(`sitemap-2026.xml: missing ${url} (present in sitemap.xml)`);
    }
    for (const url of maps['sitemap-2026.xml']) {
      if (!maps['sitemap.xml'].has(url)) problems.push(`sitemap.xml: missing ${url} (present in sitemap-2026.xml)`);
    }
  }
  return { pages: all.length, problems };
}

function main() {
  const { root } = parseArgs(process.argv.slice(2));
  const { pages: n, problems } = check(root);
  if (problems.length) {
    console.error(`site-links-check: ${problems.length} problem(s) across ${n} page(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('A new page must be added to case-studies/index.html, sitemap.xml, sitemap-2026.xml and llms.txt in the same commit.');
    process.exit(1);
  }
  console.log(`site-links-check: OK. ${n} page(s) linked from every surface; sitemaps in sync.`);
}

if (require.main === module) main();
module.exports = { check };
