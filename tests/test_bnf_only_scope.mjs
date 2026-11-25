import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const names = ['bnfNewEntryAllowed', 'bnfAnalysisView', 'getIndexSelector', 'admitSingleLeg'];
function load() {
    const code = names.map(name => {
        const start = source.indexOf('function ' + name + '(');
        assert.ok(start >= 0, name);
        return source.slice(start, source.indexOf('\n}\n', start) + 3);
    }).join('\n');
    const context = vm.createContext({ window: { NativeBridge: {
        singleLegAdmitDisplayed() { throw Error('retired entry reached native'); },
    } } });
    vm.runInContext(code, context);
    return context;
}

test('old mixed-index snapshots expose only BNF entries and keep legacy positions', () => {
    const ctx = load();
    const legacy = { id: 'old-nf', index: 'NF', exit_contract: { action: 'CLOSE' } };
    const mixed = {
        index_selector: 'NF', nfSpot: 25300,
        by_index: { NF: {}, BNF: {} },
        watchlist: [{ index: 'NF' }, { index: 'BNF' }],
        single_leg_by_index: { NF: {}, BNF: {} },
        positions: { 'old-nf': legacy },
    };
    const result = ctx.bnfAnalysisView(mixed);
    assert.equal(ctx.getIndexSelector(), 'BNF');
    assert.equal(result.index_selector, 'BNF');
    assert.deepEqual(Object.keys(result.by_index), ['BNF']);
    assert.deepEqual(Object.keys(result.single_leg_by_index), ['BNF']);
    assert.deepEqual(result.watchlist.map(x => x.index), ['BNF']);
    assert.equal(result.positions['old-nf'], legacy);
    assert.ok(!Object.hasOwn(result, 'nfSpot'));
    assert.equal(mixed.watchlist.length, 2);
});

test('a previously rendered NF Paper button is refused before crossing the bridge', () => {
    const result = load().admitSingleLeg('NF', 'old-decision', 'old-contract');
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reason, 'INDEX_RETIRED_BNF_ONLY');
});
