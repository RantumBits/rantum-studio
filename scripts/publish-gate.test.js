#!/usr/bin/env node
/**
 * Self-test for scripts/publish-gate.js.
 *
 * Why this exists. The gate enforces a legal constraint (the unsigned 0x
 * separation agreement), and #43 taught it to skip files. A skip rule is the one
 * kind of change that can make a gate fail *open* — quietly stop checking a page
 * that is actually published — so the skip needs a standing proof that it only
 * ever hides untracked strays. The negative control below ("a tracked duplicate
 * is still scanned") is the test that matters; the rest guard its edges.
 *
 * Zero dependencies on purpose, same principle as publish-gate.yml: a test that
 * needs an install can fail for reasons that have nothing to do with the gate.
 * It drives the real CLI as a subprocess rather than importing internals, so it
 * also pins the exit codes — which is the thing that has actually been misread
 * before (`node scripts/publish-gate.js | tail` reports tail's status).
 *
 * Run: npm run test:gate
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const GATE = path.resolve(__dirname, 'publish-gate.js');
const NAMES_VENUE = '<html><body><p>Built the fee registry for 0x API on mainnet.</p></body></html>\n';
const CLEAN = '<html><body><p>Execution quality, measured neutrally.</p></body></html>\n';

const tmpdirs = [];

function git(dir, ...args) {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

// A throwaway repo containing only the gate, so the fixtures are the whole world
// the gate sees (root is `path.resolve(__dirname, '..')`).
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-gate-test-'));
  tmpdirs.push(dir);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(GATE, path.join(dir, 'scripts', 'publish-gate.js'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'gate-self-test@example.invalid');
  git(dir, 'config', 'user.name', 'gate self-test');
  return dir;
}

function write(dir, rel, body) {
  const p = path.join(dir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return rel;
}

function commit(dir, ...rels) {
  for (const r of rels) git(dir, 'add', '--', r);
  git(dir, 'commit', '-q', '-m', 'fixture');
}

function runGate(dir, { args = [], pathEnv } = {}) {
  const env = { ...process.env };
  if (pathEnv !== undefined) env.PATH = pathEnv;
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'publish-gate.js'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env,
  });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function check(cond, msg) {
  if (!cond) throw new Error(msg);
}

test('a clean tracked page passes', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', CLEAN));
  const { code, out } = runGate(d);
  check(code === 0, `expected exit 0, got ${code}\n${out}`);
  check(/1 page\(s\) checked/.test(out), `expected a page count\n${out}`);
});

test('a tracked page naming the venue fails', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', NAMES_VENUE));
  const { code, out } = runGate(d);
  check(code === 1, `expected exit 1, got ${code}\n${out}`);
  check(/FAILED/.test(out), `expected FAILED\n${out}`);
});

test('an untracked duplicate is skipped, and the skip is reported', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', CLEAN));
  write(d, 'index 2.html', NAMES_VENUE);
  const { code, out } = runGate(d);
  check(code === 0, `expected exit 0, got ${code}\n${out}`);
  check(/skipped 1 untracked duplicate/.test(out), `skip was silent\n${out}`);
  check(/index 2\.html/.test(out), `skip did not name the file\n${out}`);
});

// THE NEGATIVE CONTROL. A committed duplicate is a published page, so the skip
// must not hide it. If this ever goes green-when-it-should-be-red the gate has
// started failing open, which is the failure the gate exists to prevent.
test('a TRACKED duplicate is still scanned', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', CLEAN));
  write(d, 'index 2.html', NAMES_VENUE);
  commit(d, 'index 2.html');
  const { code, out } = runGate(d);
  check(code === 1, `a tracked duplicate was skipped — the gate is failing OPEN\n${out}`);
  check(/index 2\.html/.test(out), `expected the duplicate to be named\n${out}`);
});

test('an ordinary untracked page is still scanned', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', CLEAN));
  write(d, 'draft.html', NAMES_VENUE);
  const { code, out } = runGate(d);
  check(code === 1, `new work was skipped merely for being uncommitted\n${out}`);
});

test('" 1.html" is not a duplicate shape and is still scanned', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', CLEAN));
  write(d, 'index 1.html', NAMES_VENUE);
  const { code, out } = runGate(d);
  check(code === 1, `" 1.html" was treated as a Finder duplicate\n${out}`);
});

test('an explicit file argument is always scanned', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', CLEAN));
  write(d, 'index 2.html', NAMES_VENUE);
  const { code, out } = runGate(d, { args: ['index 2.html'] });
  check(code === 1, `an explicitly named file was skipped\n${out}`);
});

// If the tracked set cannot be read, "unknown" must mean scan it.
test('fails closed when git is unavailable', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', CLEAN));
  write(d, 'index 2.html', NAMES_VENUE);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-gate-nopath-'));
  tmpdirs.push(empty);
  const { code, out } = runGate(d, { pathEnv: empty });
  check(code === 1, `skipped a file without being able to prove it is untracked\n${out}`);
  check(!/skipped \d+ untracked/.test(out), `claimed a skip with no tracked set\n${out}`);
});

// ---------------------------------------------------------------------------
// Matching logic. These pin behaviour that predates the skip: the 0x collision
// exclusions, and the allowlist's case-sensitive, file-scoped context match.
// ---------------------------------------------------------------------------

// The venue's name is also the universal hex prefix. A naive substring test fires
// 16 times on content that is fine, and a gate that cries wolf gets switched off.
const notAVenue = [
  ['a version multiplier', '<p>Routing gave a 2.0x lift on depth.</p>'],
  // The literal U+2026, which is how the site actually writes it (there is no
  // &hellip; anywhere in the tracked HTML). The entity form is deliberately not
  // pinned here: the gate scans raw markup, so "0x&hellip;" would fire — a false
  // positive, but one that fails closed and would be caught in review.
  ['a truncated placeholder', '<p>Unknown Proxy (0x\u2026) stayed unattributed.</p>'],
  ['a SQL pattern', "<p>Filtered with GLOB '0x[0-9a-fA-F]*' before joining.</p>"],
  // Honest note: this case is already excluded by the 0x lookahead, because an
  // address always continues with a hex character. Deleting the HEX_ADDR scrub
  // leaves all of these green, so a passing suite is NOT evidence that the scrub
  // is load-bearing — it is belt-and-braces. Verified by mutation, 2026-09-08.
  ['a full-length address', '<p>Settled at 0xdef1c0ded9bec7f1a1670819833240f027b25eff on mainnet.</p>'],
];
for (const [label, body] of notAVenue) {
  test(`${label} is not a naming`, () => {
    const d = fixture();
    commit(d, write(d, 'page.html', `<html><body>${body}</body></html>\n`));
    const { code, out } = runGate(d);
    check(code === 0, `false positive on ${label}\n${out}`);
  });
}

const isAVenue = [
  ['the frozen entry itself', '<p>Quotes came from 0x API.</p>'],
  ['a prose alias', '<p>Compared against 0x protocol routing.</p>'],
  ['the consumer-facing alias', '<p>Matcha was the cheapest at $1k.</p>'],
  ['an on-chain prefix', '<p>Settled through mainnetsettler.</p>'],
];
for (const [label, body] of isAVenue) {
  test(`${label} is blocked`, () => {
    const d = fixture();
    commit(d, write(d, 'page.html', `<html><body>${body}</body></html>\n`));
    const { code, out } = runGate(d);
    check(code === 1, `missed a naming via ${label}\n${out}`);
  });
}

test('markup outside visible text is scanned too', () => {
  const d = fixture();
  const body = '<html><head><meta property="og:description" content="Built on 0x API."></head><body><p>Hi.</p></body></html>\n';
  commit(d, write(d, 'page.html', body));
  const { code, out } = runGate(d);
  check(code === 1, `og:description was not scanned, but it is published\n${out}`);
});

test('an allowlisted context passes and is reported as allowlisted', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', '<html><body><p>Led by Andrew Maury, ex-0x, Uniswap, Art Blocks.</p></body></html>\n'));
  const { code, out } = runGate(d);
  check(code === 0, `the allowlisted credential was blocked\n${out}`);
  check(/allowlisted/.test(out), `allowlisted hit was not reported\n${out}`);
});

// THE CASING TRAP, hit for real on 2026-08-25. allowFor() compares the context
// with a case-sensitive String.includes, so an em-dash cleanup that ended the
// previous clause with a period capitalised "ex-0x" to "Ex-0x", the allowlist
// stopped matching, and the gate read a decided keep as a new naming.
test('the allowlist is case-sensitive: "Ex-0x" is NOT allowlisted', () => {
  const d = fixture();
  commit(d, write(d, 'index.html', '<html><body><p>Led by Andrew Maury. Ex-0x, Uniswap, Art Blocks.</p></body></html>\n'));
  const { code, out } = runGate(d);
  check(code === 1, `capitalised "Ex-0x" was allowlisted; the 2026-08-25 trap is gone\n${out}`);
});

test('the allowlist is file-scoped: the same context elsewhere is blocked', () => {
  const d = fixture();
  commit(d, write(d, 'about.html', '<html><body><p>Led by Andrew Maury, ex-0x, Uniswap, Art Blocks.</p></body></html>\n'));
  const { code, out } = runGate(d);
  check(code === 1, `an index.html allowlist entry leaked to about.html\n${out}`);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}\n        ${err.message.split('\n').join('\n        ')}`);
  }
}
for (const d of tmpdirs) fs.rmSync(d, { recursive: true, force: true });

if (failed) {
  console.error(`\npublish-gate self-test: ${failed} of ${tests.length} failed.`);
  process.exit(1);
}
console.log(`\npublish-gate self-test: ${tests.length} passed.`);
