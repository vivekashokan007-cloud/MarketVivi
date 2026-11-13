// RELEASE INVARIANT: one version across both repositories and the brain.
//
// Standing rule (Vivek, 13 November 2026): at every public release the two repositories and the
// brain carry the SAME version.  Marketapp enforces its half — B515CandidatePwaTest reads the
// real web bytes and compares them to its version pair, and a Python test compares BRAIN_VERSION
// to the gradle versionName with no literal.  Nothing on this side checked it at all, so a PWA
// bump could land here while Marketapp stayed behind, and only the paired repository's CI would
// have a chance of noticing.
//
// This is the mirror.  It reads the paired Marketapp checkout that CI already provides and
// compares what THIS repository says to the Android version pair.  Nothing is typed: both sides
// are read.
//
// It needs app/build.gradle.kts and app/src/main/python/brain.py in the paired checkout.  When
// they are absent the test SAYS it skipped and why, rather than passing silently — the
// difference matters, because a silent pass here would look exactly like a verified pair.
//
// Note on pairing: the workflow resolves the paired Marketapp ref by BRANCH NAME, falling back
// to Marketapp main when no branch of this name exists there.  Only the first case is a real
// pair, so the workflow reports which happened in MARKETAPP_PAIR_RESOLVED and this test ENFORCES
// the invariant when it says `paired` and skips when it says `fallback`.  On main both sides
// resolve to main, so a public release is always the enforced case — which is the moment the
// rule exists for.  An earlier draft skipped on any mismatch unless an environment variable
// opted in; that made the failure mode of the guard a silent skip, which is the defect it is
// meant to catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const APP = process.env.MARKETAPP_DIR;

function androidIdentity() {
  if (!APP) return { skip: 'MARKETAPP_DIR not set' };
  const gradle = join(APP, 'app', 'build.gradle.kts');
  const brainPath = join(APP, 'app', 'src', 'main', 'python', 'brain.py');
  if (!existsSync(gradle)) return { skip: `no app/build.gradle.kts in ${APP} (sparse checkout?)` };
  const g = readFileSync(gradle, 'utf8');
  const name = /versionName\s*=\s*"([^"]+)"/.exec(g);
  const code = /versionCode\s*=\s*(\d+)/.exec(g);
  if (!name || !code) return { skip: 'build.gradle.kts carries no version pair' };
  let brain = null;
  if (existsSync(brainPath)) {
    const m = /^BRAIN_VERSION\s*=\s*"([^"]+)"/m.exec(readFileSync(brainPath, 'utf8'));
    brain = m ? m[1] : null;
  }
  return { name: name[1], code: Number(code[1]), brain };
}

function webIdentity() {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const title = /<title>Market Radar v([0-9]+\.[0-9]+\.[0-9]+)<\/title>/.exec(index);
  const header = /<span class="version">v([0-9]+\.[0-9]+\.[0-9]+) · b(\d+)<\/span>/.exec(index);
  const id = /const M0_PWA_IDENTITY = \{ version: '([^']+)', build: (\d+), app_js_v: (\d+) \}/
    .exec(app);
  const script = /app\.js\?v=(\d+)"/.exec(index);
  return { title, header, id, script };
}

test('this repository is internally consistent about its own version', () => {
  const w = webIdentity();
  assert.ok(w.title, 'index.html has no "Market Radar vX.Y.Z" title');
  assert.ok(w.header, 'index.html has no version/build header');
  assert.ok(w.id, 'app.js has no M0_PWA_IDENTITY');
  assert.ok(w.script, 'index.html does not load app.js with a cache-bust revision');
  assert.equal(w.title[1], w.header[1], 'title and header disagree about the version');
  assert.equal(w.id[1], w.header[1], 'M0_PWA_IDENTITY and the header disagree about the version');
  assert.equal(Number(w.id[2]), Number(w.header[2]),
    'M0_PWA_IDENTITY and the header disagree about the build');
  assert.equal(Number(w.id[3]), Number(w.script[1]),
    'M0_PWA_IDENTITY app_js_v is not the revision index.html loads');
});

test('the web runtime, the Android pair and the brain carry one version', (t) => {
  const a = androidIdentity();
  if (a.skip) return t.skip(`paired Marketapp identity unavailable: ${a.skip}`);
  const w = webIdentity();
  const web = { version: w.id[1], build: Number(w.id[2]) };

  // Only a same-name resolution is a real pair; a fallback to Marketapp main legitimately lags
  // a review branch and is reported as a skip, with both identities printed so the pairing is
  // visible either way. Unknown is treated as paired: a missing signal must not disable the
  // guard.
  const resolved = process.env.MARKETAPP_PAIR_RESOLVED || 'paired';
  if (resolved === 'fallback') {
    return t.skip(`not a pair: this branch has no Marketapp counterpart, so the comparison ` +
      `would be against Marketapp main. web ${web.version}/b${web.build} vs main ` +
      `${a.name}/b${a.code}.`);
  }
  assert.equal(web.version, a.name,
    `web ${web.version} != Android versionName ${a.name}`);
  assert.equal(web.build, a.code,
    `web build ${web.build} != Android versionCode ${a.code}`);
  if (a.brain !== null) {
    assert.equal(a.brain, a.name,
      `BRAIN_VERSION ${a.brain} != Android versionName ${a.name}`);
    assert.equal(a.brain, web.version,
      `BRAIN_VERSION ${a.brain} != web version ${web.version}`);
  }
  console.log(`one version across both repositories${a.brain ? ' and the brain' : ''}: ` +
    `${web.version} / b${web.build} (app.js?v=${w.id[3]})`);
});
