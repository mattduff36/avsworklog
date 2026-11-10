"""Synthetic worker artifacts ONLY; real temporary Git preparation and check subprocesses."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

installed, repo, node = map(Path, sys.argv[1:])
sys.path.insert(0, str(installed))
sys.path.insert(0, str(repo / 'scripts/automation'))
import squires_companion as s
import squires_repair as r
import squires_release as release
import run_worker as worker
from worker_checks import CheckServer

with tempfile.TemporaryDirectory(prefix='SquiresRepairFixture-') as temporary:
    root = Path(temporary).resolve()
    checkout = root / 'checkout'
    checkout.mkdir()
    def write(name, text):
        p = checkout / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding='utf-8')
    def git(*args):
        return subprocess.check_output(['C:\\Program Files\\Git\\cmd\\git.exe', '-C', str(checkout), *args],
                                       stderr=subprocess.DEVNULL).decode().strip()
    # The junction is dependency-only, ignored by Git, and removed without following it below.
    junction = checkout / 'node_modules'
    subprocess.run(['C:\\Windows\\System32\\cmd.exe', '/c', 'mklink', '/J', str(junction), str(repo / 'node_modules')],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        write('.gitignore', 'node_modules/\n')
        write('package.json', '{"type":"module"}')
        write('tsconfig.json', '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","skipLibCheck":true},"include":["lib/utils/*.ts","tests/unit/*.ts"]}')
        write('eslint.config.mjs', 'export default [{files:["**/*.ts"], rules:{"no-debugger":"error"}}];')
        source, test = 'lib/utils/display-label.ts', 'tests/unit/display-label.test.ts'
        write(source, 'export function displayLabel(value) { return String(value); }\n')
        write(test, 'import {expect,it} from "vitest"; import {displayLabel} from "../../lib/utils/display-label"; it("synthetic label",()=>expect(displayLabel(" label ")).toBe(" label "));\n')
        for name in (r.CHECK_SCRIPT, 'scripts/bump-release-version.ts', 'scripts/finalise-summary.ts',
                     'lib/config/release-version-logic.ts', 'lib/config/release-module-descriptors.ts', 'types/roles.ts'):
            write(name, (repo / name).read_text(encoding='utf-8'))
        write('lib/config/release-version.json', '{"mmyy":"1126","major":1,"minor":0,"lastProcessedSha":""}')
        write('lib/config/release-history.json', '[]')
        write('docs_private/release-log.md', '# Synthetic fixture only\n')
        git('init', '-b', 'main')
        git('config', 'user.name', 'Synthetic fixture')
        git('config', 'user.email', 'fixture@localhost')
        git('add', '--all')
        git('commit', '-m', 'test: synthetic baseline')
        cfg = dict(allowBoundedRepair=True, gitExe='C:\\Program Files\\Git\\cmd\\git.exe',
                   releaseAdapter=dict(nodeExe=str(node)))
        cfg['checks'] = {key: dict(argv=[str(node), r.CHECK_SCRIPT, key],
                                  timeout_seconds=120, description='Synthetic fixture ' + key) for key in r.CHECK_IDS}
        with patch.object(s, 'WORKSPACE', checkout), patch.object(s, 'config', return_value=cfg), \
                patch.object(worker, 'ROOT', root / 'runner'):
            (checkout / '.git/squires-fixerrors').mkdir()
            base = worker.snapshot(checkout)
            write(source, 'export function displayLabel(value) { return String(value).trim(); }\n')
            write(test, 'import {expect,it} from "vitest"; import {displayLabel} from "../../lib/utils/display-label"; it("synthetic label",()=>expect(displayLabel(" label ")).toBe("label"));\n')
            checks = r.scoped_checks(cfg, [test], [source, test])
            run = root / 'runner/runs/synthetic/1'
            run.mkdir(parents=True)
            decision = dict(clusters=[dict(files=[source, test], requiredTestIds=[test])])
            req = dict(origin=s.ORIGIN, mode='implement', task_id='synthetic', checks=checks,
                       editable_paths=[source, test], squires_job=dict(decisionSha256=s.sha(s.encoded(decision))))
            after = worker.snapshot(checkout)
            state = dict(origin=s.ORIGIN, status='review_required', exit_code=0, issues=[], out_of_scope_files=[],
                         head=base['head'], branch='main', candidate_sha256=after['candidate_sha256'],
                         changed_files=sorted([source, test]))
            for name, value in (('request.json', req), ('after.json', after), ('state.json', state),
                                ('validated-decision.json', decision)):
                r.exclusive_json(run / name, value)
            config = dict(workspace=str(checkout), run_dir=str(run), checks=checks, candidate_scope='files',
                          candidate_paths=[source, test], lock_dir=str(root / 'checks'))
            r.exclusive_json(run / 'check-config.json', config)
            server = CheckServer(run / 'check-config.json')
            for key in r.CHECK_IDS:
                assert server.call({'check_id': key})['passed']
            r.successful_run(run, req, base)
            ticket = dict(jobId='ffe9f7f4-3134-47d4-a09e-0081360d8bc3',
                          issuedAt=int(time.time()), expiresAt=int(time.time()) + 300)
            try:
                tested = r.prepare(cfg, ticket, req, run, state, after)
            except Exception:
                if (run / 'metadata-output.txt').exists():
                    print((run / 'metadata-output.txt').read_text(encoding='utf-8'), file=sys.stderr)
                print('Synthetic fixture status: ' + git('status', '--porcelain=v1'), file=sys.stderr)
                print('Synthetic fixture diff: ' + repr(r.commit(cfg, ['diff', '--name-only', '--no-renames'])),
                      file=sys.stderr)
                raise
            assert tested['status'] == 'tested'
            assert int(git('rev-list', '--count', base['head'] + '..HEAD')) == 2
            actual = worker.snapshot(checkout)
            prepared = release.prepared_candidate(run, req, after, actual, cfg)
            evidence = json.loads((checkout / '.git/squires-fixerrors/prepared-release.json').read_text())['evidence']
            release.verify_prepared_checks(prepared, evidence['preparedChecks'], actual)
            negatives = 0
            proof = evidence['preparedChecks']
            receipt = prepared.receipts / (proof['lint']['receiptId'] + '.json')
            original = receipt.read_bytes()
            receipt.write_bytes(original + b' ')
            try:
                release.verify_prepared_checks(prepared, proof, actual)
                raise AssertionError('tampered receipt accepted')
            except s.Denied:
                negatives += 1
            receipt.write_bytes(original)
            try:
                release.verify_prepared_checks(prepared, proof, dict(candidate_sha256='0' * 64))
                raise AssertionError('candidate drift accepted')
            except s.Denied:
                negatives += 1
            try:
                r.prepare(cfg, ticket, req, run, state, after)
                raise AssertionError('reused prepared state accepted')
            except s.Denied:
                negatives += 1
            try:
                r.scoped_checks({**cfg, 'checks': {**cfg['checks'], 'lint': {
                    **cfg['checks']['lint'], 'argv': [str(node), '-e', 'process.exit(0)']}}}, [test], [source])
                raise AssertionError('substitute check accepted')
            except s.Denied:
                negatives += 1
            print(json.dumps(dict(fixtureOnly=True, modelLaunched=False, released=False,
                                  preparedCommits=2, realPreparedReceipts=3, negativeChecks=negatives,
                                  result=tested, evidence=evidence)))
    finally:
        os.rmdir(junction)
