#!/usr/bin/env node
/**
 * Publish gate for rantum.xyz.
 *
 * Blocks a publish-excluded venue from being named in prose on this site.
 *
 * Why this exists. ClearTrace has excluded 0x from every published output since
 * 2026-07-02, pending an unsigned separation agreement, and enforces that with
 * `leaderboard.PUBLISH_EXCLUDE` plus `scripts/newsletter_gate.py` check (A).
 * Those gates cover cleartracedata.com only. rantum.xyz is a published surface
 * too, and nothing checked it: the fee-recipient case study shipped naming the
 * venue in prose and was caught by hand afterwards (#21, corrected in #23).
 * This is check (A), ported.
 *
 * On matching. The venue's name is also the universal hex prefix, which is the
 * exact collision the fee-recipient case study is about, so a naive substring
 * test reproduces the bug it describes. A bare "0x" here is far more often a
 * multiplier ("2.0x lift"), a truncated placeholder ("Unknown Proxy (0x…)") or a
 * SQL pattern ("GLOB '0x[0-9a-fA-F]*'") than the venue. Those three shapes are
 * excluded structurally; without that the gate fires 16 times on content that is
 * fine, and a gate that cries wolf gets switched off.
 *
 * Usage:
 *   node scripts/publish-gate.js          # every published page
 *   node scripts/publish-gate.js FILE...  # just these
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Mirrors `leaderboard.PUBLISH_EXCLUDE` in the cleartrace repo. It is not read
// live because cleartrace is private and this repo is public, so a cross-repo
// fetch would mean putting a credential in public CI to track a five-string list
// that changes exactly once. Clearing this array is the same one-line flip as the
// restore step there, and it clears every alias below with it.
const FROZEN_VENUES = ['0x API'];

// Prose and on-chain spellings of the above, kept as aliases OF the "0x API"
// entry so emptying FROZEN_VENUES clears them all at once.
const ZEROX_ALIASES = ['0x', '0x api', '0x-api', '0x protocol', '0x labs', 'matcha'];
const ZEROX_PREFIXES = [
  'zeroex', 'zero_ex', '0x settler', 'mainnetsettler', 'basesettler',
  'arbitrumsettler', 'optimismsettler',
];

// Full-length addresses are addresses, never the venue name. Scrub before matching.
const HEX_ADDR = /\b0x[0-9a-fA-F]{6,}\b/g;

// Occurrences already on the site when this gate was added. Each one is a real
// naming, NOT a false positive, and is listed so the gate can block NEW ones
// without silently blessing these. They are matched by surrounding context
// rather than line number, so editing the sentence re-opens the check.
// Removing an entry after scrubbing the page is what re-arms the gate there, which
// is how the two case-study namings were retired in #25. The entries that remain
// are decided keeps, not a backlog.
const ALLOWLIST = [
  {
    file: 'index.html',
    context: 'ex-0x, Uniswap, Art Blocks',
    reason: "Andrew's own employment history in the studio bio and og:description. " +
            'A personal credential, not venue data. DECIDED 2026-08-20: keep. The ' +
            'employment credential stays on rantum.xyz even though the 2026-07-02 ' +
            'scrub removed "ex-0x Labs" from ClearTrace\'s about.html — the two ' +
            'properties differ deliberately, so do not re-raise this as a gap.',
  },
  {
    file: 'index.html',
    context: '0x Labs',
    reason: 'Same bio credential, in the prose and the client-logo row. DECIDED: keep.',
  },
];

function frozenTerms() {
  if (FROZEN_VENUES.length === 0) return [];
  const terms = new Set(FROZEN_VENUES.map((v) => v.toLowerCase()));
  if (FROZEN_VENUES.includes('0x API')) {
    ZEROX_ALIASES.forEach((t) => terms.add(t));
    ZEROX_PREFIXES.forEach((t) => terms.add(t));
  }
  return [...terms].filter(Boolean).sort((a, b) => b.length - a.length);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patternFor(term) {
  if (term === '0x') {
    // Not after a digit or dot ("2.0x"), and not before an ellipsis, bracket or
    // further hex ("(0x…)", "0x[0-9a-fA-F]"). Leaves "0x's", "ex-0x", "0x Labs".
    return /(?<![a-z0-9.])0x(?![a-z0-9…[])/gi;
  }
  return new RegExp(`(?<![a-z0-9])${escapeRe(term)}(?![a-z0-9])`, 'gi');
}

function htmlFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.html')) out.push(path.relative(root, p));
    }
  })(root);
  return out.sort();
}

function scanFile(root, rel) {
  // Scans the raw markup, not just visible text, so og:description and other meta
  // content are covered. They are published too.
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const text = raw.replace(HEX_ADDR, ' ');
  const byOffset = new Map();
  for (const term of frozenTerms()) {
    for (const m of text.matchAll(patternFor(term))) {
      // Longest term wins at a given offset, so "0x labs" reports once, not twice.
      if (!byOffset.has(m.index)) {
        byOffset.set(m.index, {
          term,
          window: text.slice(Math.max(0, m.index - 90), m.index + 90),
        });
      }
    }
  }
  return [...byOffset.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([offset, h]) => ({ file: rel, offset, ...h }));
}

function allowFor(hit) {
  return ALLOWLIST.find(
    (a) => a.file === hit.file && hit.window.includes(a.context)
  );
}

function main() {
  const root = path.resolve(__dirname, '..');
  const argv = process.argv.slice(2);
  const files = argv.length ? argv.map((f) => path.relative(root, path.resolve(f))) : htmlFiles(root);

  if (frozenTerms().length === 0) {
    console.log('publish-gate: FROZEN_VENUES is empty, nothing to enforce.');
    return 0;
  }
  if (files.length === 0) {
    console.error('publish-gate: no HTML files found. Failing closed.');
    return 1;
  }

  const blocking = [];
  const allowed = [];
  for (const rel of files) {
    for (const hit of scanFile(root, rel)) {
      (allowFor(hit) ? allowed : blocking).push(hit);
    }
  }

  if (allowed.length) {
    console.log(`publish-gate: ${allowed.length} known occurrence(s), allowlisted:`);
    const seen = new Set();
    for (const h of allowed) {
      const a = allowFor(h);
      const key = `${a.file}::${a.context}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  - ${a.file}: ${a.context}\n      ${a.reason}`);
    }
    console.log('');
  }

  if (blocking.length) {
    console.error(`publish-gate: FAILED. ${blocking.length} new naming(s) of a publish-excluded venue:\n`);
    for (const h of blocking) {
      console.error(`  ${h.file}  matched ${JSON.stringify(h.term)}`);
      console.error(`    ...${h.window.replace(/\s+/g, ' ').trim()}...\n`);
    }
    console.error('PUBLISH_EXCLUDE is a legal constraint (the unsigned 0x separation');
    console.error('agreement), not a display preference. Genericize the mention, or add');
    console.error('a reasoned ALLOWLIST entry in scripts/publish-gate.js if it must stay.');
    return 1;
  }

  console.log(`publish-gate: OK. ${files.length} page(s) checked, no new namings.`);
  return 0;
}

process.exit(main());
