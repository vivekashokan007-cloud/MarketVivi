"""Probe Python-to-Kotlin daily-risk persistence using actual repository source.

Usage: python audit/handoff_compaction_20260909.py /path/to/Marketapp
Requires Java 17. Downloads pinned Maven dependencies into a temporary cache.
Extracts actual compaction/JSON helpers; only logging is stubbed. No Android
preferences, network writes, or application source modifications occur.
Exit 1 means the required daily-risk field was lost during compaction.
"""
import argparse
import json
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('--cache', type=Path, default=Path(tempfile.gettempdir()) / 'handoff-review-20260909')
    args = parser.parse_args()
    repo, out = args.repo.resolve(), args.cache.resolve()
    out.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(repo / 'app/src/main/python'))
    import brain
    fixtures = []
    for name, closed in [('empty', []), ('loss', [{
        'id': 'pending', 'status': 'CLOSED', 'exit_date': '2026-09-08T10:00:00Z', 'net_pnl': -3213.9,
    }])]:
        ctx = {'today_ist': '2026-09-08'}
        state = brain._apply_daily_risk_state(ctx, closed, [])
        result = {'verdict': {}, 'dailyRiskState': state, 'pc2_paper_primary': {
            'deterministic_reference_source': 'preserved_deterministic_rank',
        }}
        snapshot = brain.take_poll_snapshot(result, ctx, [], 'android_compact_v1')
        assert json.loads(snapshot['context_json'])['snapshot_daily_risk_state'] == state
        path = out / f'{name}.json'
        path.write_text(json.dumps(snapshot))
        fixtures.append(str(path))

    artifacts = [
        ('org/jetbrains/kotlin', 'kotlin-compiler-embeddable', '1.9.22'),
        ('org/jetbrains/kotlin', 'kotlin-stdlib', '1.9.22'),
        ('org/jetbrains/kotlin', 'kotlin-script-runtime', '1.9.22'),
        ('org/jetbrains/kotlin', 'kotlin-reflect', '1.6.10'),
        ('org/jetbrains/kotlin', 'kotlin-daemon-embeddable', '1.9.22'),
        ('org/jetbrains/intellij/deps', 'trove4j', '1.0.20200330'),
        ('org/jetbrains', 'annotations', '13.0'),
        ('org/json', 'json', '20240303'),
    ]
    jars = []
    for group, name, version in artifacts:
        path = out / f'{name}-{version}.jar'
        if not path.exists():
            urllib.request.urlretrieve(f'https://repo.maven.apache.org/maven2/{group}/{name}/{version}/{path.name}', path)
        jars.append(str(path))
    cp = ':'.join(jars)
    source = (repo / 'app/src/main/java/com/marketradar/app/EvaluationLocalCache.kt').read_text()
    begin = source.index('    private fun parseJsonObject(')
    end = source.index('    @Synchronized\n    fun releaseMemory()', begin)
    header = '''import org.json.JSONObject
import org.json.JSONArray
import java.io.File
object LogBuffer { fun add(level: Char, tag: String, message: String) {} }
object EvaluationLocalCache {
private const val TAG = "EvaluationLocalCache"
private const val MAX_COMPACT_SNAPSHOT_BYTES = 2L * 1024L * 1024L
'''
    entry = '''
}
fun main(args: Array<String>) {
 for (path in args) {
  val before=JSONObject(File(path).readText())
  val beforeCtx=JSONObject(before.getString("context_json"))
  val after=EvaluationLocalCache.compactBrainSnapshotForPersistence(before)
  val afterCtx=after.getJSONObject("context_json")
  println(JSONObject().put("fixture",File(path).name)
   .put("before_risk",beforeCtx.getJSONObject("snapshot_daily_risk_state"))
   .put("after_has_risk",afterCtx.has("snapshot_daily_risk_state"))
   .put("after_has_comparator",afterCtx.has("snapshot_pc2_paper_primary")))
 }
}
'''
    path = out / 'CompactProbe.kt'
    path.write_text(header + source[begin:end] + entry)
    classes = out / 'classes'
    subprocess.run(['java', '-cp', cp, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
                    '-no-stdlib', '-no-reflect', '-classpath', cp, '-d', str(classes), str(path)],
                   check=True, capture_output=True, text=True)
    result = subprocess.run(['java', '-cp', str(classes) + ':' + cp, 'CompactProbeKt', *fixtures],
                            check=True, capture_output=True, text=True)
    print(result.stdout)
    rows = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    assert len(rows) == 2 and all(row['after_has_comparator'] for row in rows)
    return 0 if all(row['after_has_risk'] for row in rows) else 1


if __name__ == '__main__':
    raise SystemExit(main())
