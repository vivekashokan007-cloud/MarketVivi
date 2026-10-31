// b507: the PWA labels must move together with the APK (2.6.76 / versionCode 507) and bust the app.js cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('b507 version labels and cache key are in sync', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(index, /<title>Market Radar v2\.6\.85<\/title>/);
  assert.match(index, /<span class="version">v2\.6\.85 · b516<\/span>/);
  assert.match(index, /app\.js\?v=1380"/);
  assert.doesNotMatch(index, /2\.6\.75|b506|v=1369|2\.6\.80|b511|v=1375|2\.6\.81|b512|v=1376|2\.6\.82|b513|v=1377|2\.6\.83|b514|v=1378|2\.6\.84|b515|v=1379/);
  assert.match(app, /matching APK \(2\.6\.76 \/ b507\)/);
  assert.match(app, /const B507_REQUIRED_APK = '2\.6\.76 \(b507\)'/);
  assert.doesNotMatch(app, /2\.6\.75 \/ b506|predates/);
  // Stage 2: the identity the PWA sends into the research export matches the labels above
  assert.match(app, /const M0_PWA_IDENTITY = \{ version: '2\.6\.85', build: 516, app_js_v: 1380 \}/);
});
