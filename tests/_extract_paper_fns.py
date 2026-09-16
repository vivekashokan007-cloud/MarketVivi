from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
src = (ROOT / 'app.js').read_text()

def find_body_start(sig_start):
    """Find '{' that opens the function body (after parameter list)."""
    # find opening '(' of params
    p = src.find('(', sig_start)
    depth = 0
    mode = 'code'
    j = p
    while j < len(src):
        ch = src[j]
        nxt = src[j + 1] if j + 1 < len(src) else ''
        if mode == 'code':
            if ch == "'":
                mode = 'sq'
            elif ch == '"':
                mode = 'dq'
            elif ch == '`':
                mode = 'tmpl'
            elif ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth == 0:
                    # next non-ws should be {
                    k = j + 1
                    while k < len(src) and src[k] in ' \t\r\n':
                        k += 1
                    if k < len(src) and src[k] == '{':
                        return k
                    raise SystemExit('no body after params')
            elif ch == '/' and nxt == '/':
                while j < len(src) and src[j] != '\n':
                    j += 1
            elif ch == '/' and nxt == '*':
                j += 2
                while j + 1 < len(src) and not (src[j] == '*' and src[j + 1] == '/'):
                    j += 1
                j += 1
        elif mode == 'sq':
            if ch == '\\':
                j += 2
                continue
            if ch == "'":
                mode = 'code'
        elif mode == 'dq':
            if ch == '\\':
                j += 2
                continue
            if ch == '"':
                mode = 'code'
        elif mode == 'tmpl':
            if ch == '\\':
                j += 2
                continue
            if ch == '`':
                mode = 'code'
        j += 1
    raise SystemExit('unterminated params')


def extract(name):
    needle = f'function {name}('
    start = src.find(needle)
    if start < 0:
        raise SystemExit(f'missing {name}')
    body = find_body_start(start)
    depth = 0
    mode = 'code'
    tmpl_expr = 0
    j = body
    while j < len(src):
        ch = src[j]
        nxt = src[j + 1] if j + 1 < len(src) else ''
        if mode == 'code':
            if ch == "'":
                mode = 'sq'
            elif ch == '"':
                mode = 'dq'
            elif ch == '`':
                mode = 'tmpl'
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return src[start:j + 1]
            elif ch == '/' and nxt == '/':
                while j < len(src) and src[j] != '\n':
                    j += 1
                continue
            elif ch == '/' and nxt == '*':
                j += 2
                while j + 1 < len(src) and not (src[j] == '*' and src[j + 1] == '/'):
                    j += 1
                j += 2
                continue
        elif mode == 'sq':
            if ch == '\\':
                j += 2
                continue
            if ch == "'":
                mode = 'code'
        elif mode == 'dq':
            if ch == '\\':
                j += 2
                continue
            if ch == '"':
                mode = 'code'
        elif mode == 'tmpl':
            if ch == '\\':
                j += 2
                continue
            if ch == '`':
                mode = 'code'
            elif ch == '$' and nxt == '{':
                mode = 'tmpl_expr'
                tmpl_expr = 1
                j += 2
                continue
        elif mode == 'tmpl_expr':
            if ch == "'":
                mode = 'tmpl_expr_sq'
            elif ch == '"':
                mode = 'tmpl_expr_dq'
            elif ch == '`':
                mode = 'tmpl_nested'
            elif ch == '{':
                tmpl_expr += 1
            elif ch == '}':
                tmpl_expr -= 1
                if tmpl_expr == 0:
                    mode = 'tmpl'
        elif mode == 'tmpl_expr_sq':
            if ch == '\\':
                j += 2
                continue
            if ch == "'":
                mode = 'tmpl_expr'
        elif mode == 'tmpl_expr_dq':
            if ch == '\\':
                j += 2
                continue
            if ch == '"':
                mode = 'tmpl_expr'
        elif mode == 'tmpl_nested':
            if ch == '\\':
                j += 2
                continue
            if ch == '`':
                mode = 'tmpl_expr'
        j += 1
    raise SystemExit(f'unterm {name}')


names = [
    'normalizePaperIndexKey',
    'parsePositiveIntegralLotJs',
    'paperContractIdentityGate',
    'paperTradeAuthorization',
    'paperObservationAuthorization',
    'paperAnalysisAuthorization',
    'paperTestVetoes',
    'confirmPaperTest',
    'experimentalKellyAdvisoryReadout',
    'sanitizeTradeForInsert',
    'renderCandidateCard',
]
out = [extract(n) for n in names]
import os
out_path = Path(os.environ.get('PAPER_EXTRACT_OUT', str(ROOT / 'tests' / '_extracted_paper_fns.js')))
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text('\n\n'.join(out) + '\n')
for n, b in zip(names, out):
    print(n, len(b))
print('wrote', out_path)
