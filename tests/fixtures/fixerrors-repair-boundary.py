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

batch_mode = sys.argv[-1] == '--batch'
installed, repo, node = map(Path, sys.argv[1:4])
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
                                       stderr=subprocess.DEVNULL, env=r.local_env()).decode().strip()
    # The junction is dependency-only, ignored by Git, and removed without following it below.
    junction = checkout / 'node_modules'
    subprocess.run(['C:\\Windows\\System32\\cmd.exe', '/c', 'mklink', '/J', str(junction), str(repo / 'node_modules')],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        cache_root = root / 'cache'
        cache_root.mkdir()
        subprocess.run(['C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
                        '-NoProfile', '-NonInteractive', '-Command',
                        '& { $ErrorActionPreference="Stop"; '
                        '$id=[Security.Principal.WindowsIdentity]::GetCurrent().User; '
                        '$acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetOwner($id); '
                        '$acl.SetAccessRuleProtection($true,$false); '
                        '$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new('
                        '$id,"FullControl","ContainerInherit,ObjectInherit","None","Allow")); '
                        'Set-Acl -LiteralPath $args[0] -AclObject $acl }', str(cache_root)],
                       check=True, stdout=subprocess.DEVNULL, env=r.local_env())
        write('.gitignore', 'node_modules/\ndocs_private/fixerrors-runtime-knowledge.json*\n')
        write('package.json', '{"type":"module"}')
        write('tsconfig.json', '{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","skipLibCheck":true},"include":["lib/utils/*.ts","tests/unit/*.ts"]}')
        write('eslint.config.mjs', 'export default [{files:["**/*.ts"], rules:{"no-debugger":"error"}}];')
        source, test = 'lib/utils/display-label.ts', 'tests/unit/display-label.test.ts'
        write(source, 'export function displayLabel(value) { return String(value); }\n')
        write(test, 'import {expect,it} from "vitest"; import {displayLabel} from "../../lib/utils/display-label"; it("synthetic label",()=>expect(displayLabel(" label ")).toBe(" label "));\n')
        if batch_mode:
            write('lib/utils/second-label.ts', 'export const secondLabel = value => String(value);\n')
            write('tests/unit/second-label.test.ts', 'import {expect,it} from "vitest"; import {secondLabel} from "../../lib/utils/second-label"; it("second label",()=>expect(secondLabel(" label ")).toBe(" label "));\n')
        for name in (r.CHECK_SCRIPT, r.CACHE_SCRIPT, r.ANALYSIS_CATALOGUE, r.EFFORT_POLICY, 'lib/fixerrors/triage.ts',
                     'scripts/bump-release-version.ts', 'scripts/finalise-summary.ts',
                     'lib/config/release-version-logic.ts', 'lib/config/release-module-descriptors.ts', 'types/roles.ts'):
            write(name, (repo / name).read_text(encoding='utf-8'))
        if batch_mode:
            for name in ('scripts/fixerrors-auto.ts', 'scripts/fixerrors-decision.ts',
                         'scripts/fixerrors-knowledge.ts', 'scripts/fixerrors-safety.ts'):
                write(name, (repo / name).read_text(encoding='utf-8'))
            write(r.ANALYSIS_CATALOGUE, json.dumps([
                dict(source='lib/utils/display-label.ts', tests=['tests/unit/display-label.test.ts']),
                dict(source='lib/utils/second-label.ts', tests=['tests/unit/second-label.test.ts'])]))
        # Pin this copied fixture helper to disposable paths, never the production checkout/cache.
        helper = (checkout / r.CACHE_SCRIPT).read_text(encoding='utf-8')
        helper = helper.replace('export const WORKSPACE = String.raw`D:\\Websites\\avsworklog`;',
                                'export const WORKSPACE = ' + json.dumps(str(checkout)) + ';')
        helper = helper.replace("export const CACHE_ROOT = path.join(userInfo().homedir, '.codex', 'cursor-worker', 'squires-typecheck-cache');",
                                'export const CACHE_ROOT = ' + json.dumps(str(cache_root)) + ';')
        write(r.CACHE_SCRIPT, helper)
        write('lib/config/release-version.json', '{"mmyy":"1126","major":1,"minor":0,"lastProcessedSha":""}')
        write('lib/config/release-history.json', '[]')
        write('docs_private/release-log.md', '# Synthetic fixture only\n')
        git('init', '-b', 'main')
        # Match the isolated native Git environment, not this owner's global EOL policy.
        git('config', 'core.autocrlf', 'false')
        git('config', 'user.name', 'Synthetic fixture')
        git('config', 'user.email', 'fixture@localhost')
        git('add', '--all')
        git('commit', '-m', 'test: synthetic baseline')
        subprocess.run([str(node), r.CACHE_SCRIPT, 'warmup'], cwd=checkout, env=r.local_env(),
                       check=True, stdout=subprocess.DEVNULL)
        print('Synthetic fixture cache warmed', file=sys.stderr, flush=True)
        cfg = dict(allowBoundedRepair=True, gitExe='C:\\Program Files\\Git\\cmd\\git.exe',
                   releaseAdapter=dict(nodeExe=str(node)))
        cfg['checks'] = {key: dict(argv=[str(node), r.CHECK_SCRIPT, key],
                                  timeout_seconds=120, description='Synthetic fixture ' + key) for key in r.CHECK_IDS}
        with patch.object(s, 'WORKSPACE', checkout), patch.object(s, 'config', return_value=cfg), \
                patch.object(worker, 'ROOT', root / 'runner'):
            (checkout / '.git/squires-fixerrors').mkdir()
            base = worker.snapshot(checkout)
            if batch_mode:
                sys.path.insert(0, str(repo / 'tests/fixtures'))
                from fixerrors_batch_boundary import exercise_batch
                exercise_batch(root, checkout, repo, node, cfg, write, git, base)
                raise SystemExit(0)
            # Synthetic review receipts test reuse mechanics only, never model execution.
            review_job = 'edb867ce-734d-4d32-a658-830ba167b2f9'
            review_ticket = dict(jobId=review_job, packetSha256='a' * 64)
            review_packet = dict(synthetic=True)
            review_run = worker.ROOT / 'runs' / ('squires-fixerrors-' + review_job + '-analysis') / '1'
            review_run.mkdir(parents=True)
            review_request = dict(origin=s.ORIGIN, mode='ask', editable_paths=[], checks={},
                                  task_id='squires-fixerrors-' + review_job + '-analysis', attempt=1,
                                  workspace=str(checkout), squires_packet=review_packet,
                                  squires_job=dict(jobId=review_job, packetSha256='a' * 64))
            review_state = dict(origin=s.ORIGIN, status='review_required', exit_code=0, issues=[],
                                out_of_scope_files=[], head=base['head'], branch='main',
                                candidate_sha256=base['candidate_sha256'], changed_files=[])
            review_decision = dict(synthetic=True, candidate=base['candidate_sha256'])
            review_artifacts = {'request.json': review_request, 'before.json': base, 'after.json': base,
                                'state.json': review_state, 'validated-decision.json': review_decision}
            for name, value in review_artifacts.items():
                r.exclusive_json(review_run / name, value)
            assert r.reuse_review(review_ticket, review_packet) is None
            r.remember_review(review_ticket, review_run, review_packet)
            assert r.reuse_review(review_ticket, review_packet) == review_decision
            review_negatives = 0
            for name in r.REVIEW_ARTIFACTS:
                artifact = review_run / name
                original = artifact.read_bytes()
                artifact.write_bytes(original + b' ')
                try:
                    r.reuse_review(review_ticket, review_packet)
                    raise AssertionError('tampered review artifact accepted')
                except s.Denied:
                    review_negatives += 1
                artifact.write_bytes(original)
            try:
                r.reuse_review(review_ticket, dict(synthetic='different packet'))
                raise AssertionError('different reviewed packet accepted')
            except s.Denied:
                review_negatives += 1
            write(source, 'export function displayLabel(value) { return String(value).trim(); }\n')
            try:
                r.reuse_review(review_ticket, review_packet)
                raise AssertionError('changed review candidate accepted')
            except s.Denied:
                review_negatives += 1
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
                print('Synthetic fixture worker check: ' + key, file=sys.stderr, flush=True)
                assert server.call({'check_id': key})['passed']
            r.successful_run(run, req, base)
            ticket = dict(jobId='ffe9f7f4-3134-47d4-a09e-0081360d8bc3',
                          issuedAt=int(time.time()), expiresAt=int(time.time()) + 300)
            try:
                print('Synthetic fixture preparation start', file=sys.stderr, flush=True)
                tested = r.prepare(cfg, ticket, req, run, state, after)
                print('Synthetic fixture preparation finished', file=sys.stderr, flush=True)
            except Exception:
                prep_config = run / 'prepared/check-config.json'
                if prep_config.exists():
                    prep_server = CheckServer(prep_config)
                    for receipt_path in prep_server.receipts.glob('*.json'):
                        value = json.loads(receipt_path.read_text(encoding='utf-8'))
                        if value.get('passed') is False:
                            print('Synthetic failed receipt: ' + json.dumps(value)[:12000],
                                  file=sys.stderr, flush=True)
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
                                  reviewReuseNegativeChecks=review_negatives,
                                  result=tested, evidence=evidence)))
    finally:
        os.rmdir(junction)
