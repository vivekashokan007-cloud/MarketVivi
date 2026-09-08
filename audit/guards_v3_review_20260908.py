"""Reproduce the v3 review against a separately patched Marketapp checkout.

Usage: python audit/guards_v3_review_20260908.py /path/to/patched/Marketapp
Requires Java 17 and downloads pinned JVM dependencies from Maven Central.
Compiles the exact file-scope Kotlin source, not the Android Service adapter.
The only stub supplies the Service's version constant to the supplied JUnit test.
All generated files stay in --cache; no application source is modified.
"""
import argparse
import ast
import json
import re
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('repo', type=Path)
    parser.add_argument('--cache', type=Path, default=Path(tempfile.gettempdir()) / 'kotlin-guards-review')
    args = parser.parse_args()
    repo, out = args.repo.resolve(), args.cache.resolve()
    out.mkdir(parents=True, exist_ok=True)
    artifacts = [
        ('org/jetbrains/kotlin', 'kotlin-compiler-embeddable', '1.9.22'),
        ('org/jetbrains/kotlin', 'kotlin-stdlib', '1.9.22'),
        ('org/jetbrains/kotlin', 'kotlin-script-runtime', '1.9.22'),
        ('org/jetbrains/kotlin', 'kotlin-reflect', '1.6.10'),
        ('org/jetbrains/kotlin', 'kotlin-daemon-embeddable', '1.9.22'),
        ('org/jetbrains/intellij/deps', 'trove4j', '1.0.20200330'),
        ('org/jetbrains', 'annotations', '13.0'),
        ('junit', 'junit', '4.13.2'),
        ('org/hamcrest', 'hamcrest-core', '1.3'),
        ('org/json', 'json', '20240303'),
    ]
    jars = []
    for group, name, version in artifacts:
        path = out / f'{name}-{version}.jar'
        if not path.exists():
            url = f'https://repo.maven.apache.org/maven2/{group}/{name}/{version}/{path.name}'
            urllib.request.urlretrieve(url, path)
        jars.append(str(path))
    cp = ':'.join(jars)
    source = (repo / 'app/src/main/java/com/marketradar/app/PositionTickService.kt').read_text()
    marker = re.search(r'internal const val POSITION_TICK_GUARDS_VERSION = "[^"]+"', source).group(0)
    pure = ('package com.marketradar.app\nimport org.json.JSONObject\nimport org.json.JSONArray\n'
            'import java.util.Locale\nimport kotlin.math.max\n'
            'class PositionTickService { companion object { ' + marker + ' } }\n'
            + source[source.index('private fun JSONObject.optStringAny'):])
    test = repo / 'app/src/test/java/com/marketradar/app/PositionTickGuardsTest.kt'
    cases = {
        'baseline': pure,
        'positivity': pure.replace('executableRaw.usable() && !isCrossed', '(executableRaw != null) && !isCrossed'),
        'crossed': pure.replace('val isCrossed = bid != null && ask != null && bid > ask', 'val isCrossed = false'),
        'unsupported': pure.replace('structure.status == STRUCTURE_UNSUPPORTED -> "STRUCTURE_UNCHECKED"', 'false -> "STRUCTURE_UNCHECKED"'),
    }
    for name, code in cases.items():
        assert name == 'baseline' or code != pure, f'Mutation did not match: {name}'
        path, classes = out / f'review_{name}.kt', out / f'review_{name}_classes'
        path.write_text(code)
        subprocess.run(['java', '-cp', cp, 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
                        '-no-stdlib', '-no-reflect', '-classpath', cp, '-d', str(classes),
                        str(path), str(test)], check=True, capture_output=True, text=True)
        result = subprocess.run(['java', '-cp', str(classes) + ':' + cp, 'org.junit.runner.JUnitCore',
                                 'com.marketradar.app.PositionTickGuardsTest'], capture_output=True, text=True)
        (out / f'review_{name}.log').write_text(result.stdout + result.stderr)
        print(name, result.stdout, flush=True)
        assert (result.returncode == 0) == (name == 'baseline'), 'Unexpected mutation/baseline result'

    # unittest does not collect these plain functions. Execute each module in a
    # separate process so its imports and globals do not contaminate other modules.
    runner = '''import runpy,sys,ast,json
from pathlib import Path
p=sys.argv[1];sys.path.insert(0,str(Path(p).parent.parent))
ns=runpy.run_path(p,run_name='audit_standalone');passed=0;failures=[]
for f in ast.parse(Path(p).read_text()).body:
 if isinstance(f,ast.FunctionDef) and f.name.startswith('test_'):
  try:ns[f.name]();passed+=1
  except Exception as e:failures.append({'name':f.name,'error':str(e)})
print('AUDIT_RESULT '+json.dumps({'file':Path(p).name,'passed':passed,'failures':failures}))
'''
    results = []
    for path in sorted((repo / 'app/src/main/python/tests').glob('test_*.py')):
        if not any(isinstance(n, ast.FunctionDef) and n.name.startswith('test_')
                   for n in ast.parse(path.read_text()).body):
            continue
        result = subprocess.run([sys.executable, '-c', runner, str(path)], capture_output=True, text=True, check=True)
        row = json.loads(next(line[13:] for line in result.stdout.splitlines() if line.startswith('AUDIT_RESULT ')))
        results.append(row)
        print(json.dumps(row), flush=True)
    (out / 'review_standalone.json').write_text(json.dumps(results, indent=2))
    failures = sum(len(row['failures']) for row in results)
    print('Standalone total:', sum(row['passed'] for row in results), 'passed;', failures, 'failed')
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
