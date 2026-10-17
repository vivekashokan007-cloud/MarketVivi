import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = source.indexOf('function mlIdentityCoverageState(');
const end = source.indexOf('\n}\n', start) + 2;
const context = vm.createContext({});
vm.runInContext(source.slice(start, end), context);

test('database timeout reports unverified identities without claiming saved rows are missing', () => {
    const state = context.mlIdentityCoverageState({ evaluationPhase: 'FAILED_IDENTITY_COVERAGE',
        missingIdentityCount: 19320, missingIdentityPreview: '7299,7301',
        identityReadbackError: 'recommendation_readback:incomplete_error code=57014 statement timeout' });
    assert.equal(state.readbackFailed, true);
    assert.match(state.description, /19320 identities unverified/);
    assert.doesNotMatch(state.description, /missing|7299/);
    assert.match(state.error, /57014/);
    assert.equal(state.preview, '');
});

test('successful readback with genuinely absent identities retains missing count and preview', () => {
    const state = context.mlIdentityCoverageState({ evaluationPhase: 'INCOMPLETE_IDENTITY',
        missingIdentityCount: 2, missingIdentityPreview: 'primary:7299|chosen|primary' });
    assert.equal(state.readbackFailed, false);
    assert.match(state.description, /2 missing/);
    assert.match(state.description, /7299/);
    assert.equal(state.error, '');
});

test('readback failure uses the native diagnostic when a dedicated error has not arrived', () => {
    const state = context.mlIdentityCoverageState({ evaluationPhase: 'FAILED_IDENTITY_COVERAGE',
        evaluationLastError: 'IDENTITY_READBACK_FAILED: 57014' });
    assert.match(state.error, /57014/);
    assert.doesNotMatch(state.description, /0 missing/);
});
