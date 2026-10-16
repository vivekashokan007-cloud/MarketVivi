// b507: the PWA labels must move together with the APK (2.6.76 / versionCode 507) and bust the app.js cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('b507 version labels and cache key are in sync', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(index, /<title>Market Radar v2\.6\.77<\/title>/);
  assert.match(index, /<span class="version">v2\.6\.77 · b508<\/span>/);
  assert.match(index, /app\.js\?v=1372"/);
  assert.doesNotMatch(index, /2\.6\.75|b506|v=1369/);
  assert.match(app, /matching APK \(2\.6\.76 \/ b507\)/);
  assert.match(app, /const B507_REQUIRED_APK = '2\.6\.76 \(b507\)'/);
  assert.doesNotMatch(app, /2\.6\.75 \/ b506|predates/);
});
