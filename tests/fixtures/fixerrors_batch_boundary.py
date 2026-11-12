"""Disposable batch integration: synthetic model output, genuine native checks and preparation."""
import base64
from contextlib import closing, ExitStack
from collections import deque
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time
import uuid
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import squires_companion as s
import squires_repair as r
import squires_release as release
import run_worker as worker
from worker_checks import CheckServer


def exercise_batch(root, checkout, repo, node, cfg, write, git, base):
    with ExitStack() as cleanup:
        return _exercise_batch(root, checkout, repo, node, cfg, write, git, base, cleanup)


def _exercise_batch(root, checkout, repo, node, cfg, write, git, base, cleanup):
    key = Ed25519PrivateKey.generate()
    device_key = Ed25519PrivateKey.generate()
    cfg.update(workerEligible=True, allowReadOnly=True, allowRelease=False, deviceId=str(uuid.uuid4()),
               enrollmentId=str(uuid.uuid4()), environment=s.ENVIRONMENT,
               devicePublicKeyPem=device_key.public_key().public_bytes(
                   serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode(),
               issuer=dict(keyId='squires-repair-v1', publicKeyPem=key.public_key().public_bytes(
                   serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()))
    ticket = dict(version=1, audience=s.REPAIR_AUD, job='fixerrors', jobId=str(uuid.uuid4()),
                  deviceId=cfg['deviceId'], environment=s.ENVIRONMENT, authority='bounded-repair',
                  issuedAt=int(time.time()), expiresAt=int(time.time()) + 300,
                  head=base['head'], tree=git('rev-parse', 'HEAD^{tree}'), packetSha256='')
    private = root / 'replay'
    private.mkdir()
    with closing(sqlite3.connect(private / 'claims.sqlite3')) as db:
        db.execute('CREATE TABLE enrollment (enrollment_id TEXT, highwater INTEGER)')
        db.execute('INSERT INTO enrollment VALUES (?,0)', (cfg['enrollmentId'],))
        db.execute('CREATE TABLE claims (namespace TEXT, job_id TEXT, ticket_hash TEXT, claimed_at INTEGER, '
                   'PRIMARY KEY(namespace,job_id))')
        db.commit()
    def device_proof(value):
        payload = base64.urlsafe_b64encode(s.encoded(value)).decode().rstrip('=')
        signature = key.sign(('squires-windows-fixerrors-v1\nsquires-repair-v1\n' + payload).encode())
        admission = s.encoded(dict(version=1, keyId='squires-repair-v1', payload=payload,
                                  signature=base64.urlsafe_b64encode(signature).decode().rstrip('='))).decode()
        body = s.encoded(dict(ticket=admission, manifestSha256=value['packetSha256']))
        payload = base64.urlsafe_b64encode(body).decode().rstrip('=')
        signature = device_key.sign(('squires-companion-batch-v1\n' + payload).encode())
        return s.encoded(dict(payload=payload, signature=base64.urlsafe_b64encode(signature).decode().rstrip('=')))
    fingerprint = r.batch_fingerprint(base, base, ticket['tree'])
    snapshot_id = str(uuid.uuid4())
    sources = ['lib/utils/display-label.ts', 'lib/utils/second-label.ts']
    tests = ['tests/unit/display-label.test.ts', 'tests/unit/second-label.test.ts']
    clusters = []
    # One blocked cluster before and after the two independent contributing fixes.
    for index, name in enumerate([sources[0], *sources, sources[1]]):
        clusters.append(dict(id='cluster-' + str(index + 1), rootCauseFamily='synthetic labels',
                             advisoryLane='critical' if index in (0, 3) else 'fast', advisoryAction='fix',
                             query=dict(errorContextId=None, httpStatus=None, route='/dashboard', component='Label',
                                        sourceFile=name, normalizedMessage='Synthetic label ' + str(index),
                                        rootCauseFamily='synthetic labels'),
                             sourceFiles=[name], patterns=[], priorResolutions=[], held=index == 3))
    manifest = dict(schemaVersion=1, snapshotChecksum='a' * 64, retrieval=dict(
        schemaVersion=1, snapshotId=snapshot_id, **fingerprint, archiveMeansResolved=False, clusters=clusters))
    server = subprocess.Popen([str(node), '--import', 'tsx', str(repo / 'tests/fixtures/fixerrors-batch-server.ts')],
                              cwd=repo, env=r.local_env(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE)
    def close_server():
        if server.poll() is None:
            server.kill()
        server.wait(timeout=5)
        for stream in (server.stdin, server.stdout, server.stderr):
            stream.close()
    cleanup.callback(close_server)
    def exchange(value):
        server.stdin.write(s.encoded(value) + b'\n')
        server.stdin.flush()
        response = server.stdout.readline()
        if not response:
            raise AssertionError('Synthetic batch server failed: ' + server.stderr.read().decode())
        return json.loads(response)
    captured = exchange(dict(root=str(checkout), head=base['head'], tree=ticket['tree'],
                             fingerprint=fingerprint['treeFingerprint'], jobId=ticket['jobId'],
                             deviceId=cfg['deviceId'],
                             issuer=key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                      serialization.NoEncryption()).decode(),
                             device=device_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                              serialization.NoEncryption()).decode()))
    raw = captured['manifest'].encode()
    manifest = json.loads(raw)
    clusters = manifest['retrieval']['clusters']
    snapshot_id = manifest['retrieval']['snapshotId']
    assert captured['pages'] >= 2 and captured['rows'] == 281 and captured['bytes'] > 96 * 1024
    assert captured['newRows'] == 280 and captured['heldRows'] == 1 and len(clusters) == 4
    ticket = json.loads(s.unb64(json.loads(captured['ticket'])['payload'], 4096))
    ticket['packetSha256'] = s.sha(raw)
    sequence = 0
    def lease(expected):
        nonlocal sequence
        if expected['runId'] == ticket['jobId']:
            return exchange(dict(op='lease', value=expected))['lease']
        exchange(dict(op='heartbeat'))
        sequence += 1
        now = int(time.time())
        value = dict(version=1, **{k: expected[k] for k in ('runId', 'deviceId', 'manifestSha256', 'checkpointSha256')},
                     leaseId=str(uuid.uuid4()), sequence=sequence,
                     authority='resume' if expected['resume'] else 'continue', issuedAt=now, expiresAt=now + 60)
        payload = base64.urlsafe_b64encode(s.encoded(value)).decode().rstrip('=')
        signature = key.sign(('squires-fixerrors-batch-lease-v1\nsquires-repair-v1\n' + payload).encode())
        return s.encoded(dict(version=1, keyId='squires-repair-v1', payload=payload,
                              signature=base64.urlsafe_b64encode(signature).decode().rstrip('='))).decode()
    counts = dict(analysis=0, repair=0, preparation=0, receipts=0, leaseNegatives=0, resumeNegatives=0,
                  nonRepairRuns=0, revocation=0, cancellation=0, artifactNegatives=0, admissionNegatives=0)
    def operation(config, mode, payload, live, launch):
        live()
        launch()
        if mode == 'prepare':
            counts['preparation'] += 1
            run = Path(payload['run'])
            r.aggregate_checks(config, run, payload['checks'], live)
            counts['receipts'] += 3
            state = dict(changed_files=payload['changedFiles'])
            req = dict(editable_paths=payload['paths'], checks=payload['checks'])
            result = r.prepare(config, payload['ticket'], req, run, state, payload['after'],
                               guard=live, batch=payload['batch'])
            counts['receipts'] += 3
            return result
        req = payload['request']
        before = worker.snapshot(checkout)
        index = int(req['task_id'].split('-')[-2]) - 1
        run = worker.ROOT / 'runs' / req['task_id'] / '1'
        run.mkdir(parents=True)
        if req['mode'] == 'ask':
            counts['analysis'] += 1
            slot = 0 if index < 2 else 1
            evidence = clusters[index]
            decision = dict(id=evidence['id'], lane=evidence['advisoryLane'], action='fix',
                            disposition='outstanding', nextStep='Repair synthetic label',
                            evidencePaths=[sources[slot], tests[slot]], files=[sources[slot], tests[slot]],
                            requiredTestIds=[tests[slot]],
                            forbiddenChanges=['suppress-logging', 'empty-success', 'weaken-authorization'],
                            rationale='Synthetic whitespace regression', priorIncidentIds=[], evidenceEnrichmentAttempted=True)
            outcome = dict(schemaVersion=1, snapshotId=snapshot_id, analyst='MPDEE Worker',
                           **r.batch_fingerprint(before, base, ticket['tree']), clusters=[decision])
            if req['checks']:
                config_path = run / 'check-config.json'
                r.exclusive_json(config_path, dict(workspace=str(checkout), run_dir=str(run), checks=req['checks'],
                                                  candidate_scope='files', candidate_paths=[],
                                                  lock_dir=str(root / 'checks')))
                checks = CheckServer(config_path)
                for name in req['checks']:
                    receipt = checks.call(dict(check_id=name))
                    assert receipt['passed'], 'Synthetic analysis check failed'
                    counts['receipts'] += 1
        else:
            counts['repair'] += 1
            slot = index - 1
            if slot == 0:
                write(sources[slot], 'export function displayLabel(value) { return String(value).trim(); }\n')
                function = 'displayLabel'
            else:
                write(sources[slot], 'export const secondLabel = value => String(value).trim();\n')
                function = 'secondLabel'
            write(tests[slot], 'import {expect,it} from "vitest"; import {' + function + '} from "../../'
                  + sources[slot][:-3] + '"; it("trim label",()=>expect(' + function + '(" label ")).toBe("label"));\n')
            config_path = run / 'check-config.json'
            r.exclusive_json(config_path, dict(workspace=str(checkout), run_dir=str(run), checks=req['checks'],
                                              candidate_scope='files', candidate_paths=req['editable_paths'],
                                              lock_dir=str(root / 'checks')))
            checks = CheckServer(config_path)
            for name in r.CHECK_IDS:
                print('Synthetic batch worker check: ' + name, file=sys.stderr, flush=True)
                receipt = checks.call(dict(check_id=name))
                if not receipt['passed']:
                    raise AssertionError('Synthetic batch check failed: ' + json.dumps(receipt))
                counts['receipts'] += 1
            outcome = dict(schemaVersion=1, clusterId=clusters[index]['id'], status='fixed',
                           changedFiles=sorted(req['editable_paths']), checks=list(r.CHECK_IDS), summary='Synthetic label repaired')
        after = worker.snapshot(checkout)
        changed = sorted(name for name in before['files'].keys() | after['files'].keys()
                         if before['files'].get(name) != after['files'].get(name))
        state = dict(origin=s.ORIGIN, status='review_required', exit_code=0, issues=[], out_of_scope_files=[],
                     head=before['head'], branch='main', candidate_sha256=after['candidate_sha256'], changed_files=changed)
        for name, value in (('request.json', req), ('before.json', before), ('after.json', after), ('state.json', state)):
            r.exclusive_json(run / name, value)
        (run / 'result.md').write_text(json.dumps(outcome), encoding='utf-8')
        return dict(outcome=outcome, changedFiles=changed, runDirectory=str(run))

    with patch.object(r, 'BATCH_ENGINE', str(repo / 'tests/fixtures/fixerrors-batch-engine.ts')), \
            patch.object(s, 'HOME_DIR', private), \
            patch.dict(os.environ, {k: v for k, v in r.local_env().items() if not k.startswith('GIT_')}, clear=True):
        for authority, empty in [('read-only', True), ('bounded-repair', True), ('read-only', False)]:
            selected = {**manifest, 'retrieval': {**manifest['retrieval'], 'clusters': []}} if empty else manifest
            selected_raw = s.encoded(selected)
            selected_ticket = dict(ticket, jobId=str(uuid.uuid4()), authority=authority,
                                   expiresAt=ticket['issuedAt'] + (300 if authority == 'read-only' else 600),
                                   packetSha256=s.sha(selected_raw))
            if counts['nonRepairRuns'] == 0:
                for proof, body in [
                        (device_proof(selected_ticket), selected_raw + b' '),
                        (device_proof(dict(selected_ticket, expiresAt=int(time.time()))), selected_raw),
                        (device_proof(dict(selected_ticket, deviceId=str(uuid.uuid4()))), selected_raw)]:
                    try:
                        r.execute_batch(proof, body, cfg, lease, operation)
                        raise AssertionError('invalid signed batch admission accepted')
                    except s.Denied:
                        counts['admissionNegatives'] += 1
            result = r.execute_batch(device_proof(selected_ticket), selected_raw, cfg, lease, operation)
            assert result['status'] == ('reviewed' if authority == 'read-only' else 'no-change')
            assert counts['repair'] == 0 and counts['preparation'] == 0 and worker.snapshot(checkout) == base
            counts['nonRepairRuns'] += 1
            (checkout / '.git/squires-fixerrors/active-packet.json').unlink()
            (checkout / '.git/squires-fixerrors/batch-manifest.json').unlink()
        session = r.NativeBatchSession(cfg, ticket, raw, lease, operation)
        cfg['allowBoundedRepair'] = False
        try:
            session.live()
            raise AssertionError('revoked repair consent accepted')
        except s.Denied:
            counts['revocation'] += 1
        finally:
            cfg['allowBoundedRepair'] = True
        native_popen = subprocess.Popen
        children = []
        def disposable_child(*args, **kwargs):
            if '--batch-operation' not in args[0]:
                return native_popen(*args, **kwargs)
            assert not children and args[0] == [
                sys.executable, '-I', '-B', str(Path(r.__file__).resolve()), '--batch-operation']
            with patch.dict(os.environ, kwargs['env'], clear=True):
                s.local_runtime(cfg)
            child = native_popen([sys.executable, '-I', '-B', '-c', 'import time; time.sleep(30)'],
                                 **kwargs)
            children.append(child)
            return child
        def lost_lease():
            raise s.Denied('synthetic_lease_revoked')
        try:
            with patch.object(r.subprocess, 'Popen', side_effect=disposable_child):
                try:
                    r.monitored_native_operation(cfg, 'dispatch', dict(request=dict(mode='ask')), lost_lease, lambda: None)
                    raise AssertionError('lost lease did not cancel child')
                except s.Denied:
                    assert len(children) == 1 and children[0].poll() is not None
                    counts['cancellation'] += 1
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                child.wait(timeout=5)
        # Exercise the real signed lease parser without touching installed signing material.
        expected = dict(runId=ticket['jobId'], deviceId=cfg['deviceId'], manifestSha256=ticket['packetSha256'],
                        checkpointSha256=session.checkpoint_sha(), cursor=0, resume=False)
        valid = lease(expected)
        for bad, at in [(valid, int(time.time()) + 60), (valid.replace('squires-repair-v1', 'other-key'), int(time.time()))]:
            try:
                r.batch_lease(bad, cfg, {k: expected[k] for k in r.BATCH_LEASE_FIELDS if k in expected}, at)
                raise AssertionError('invalid lease accepted')
            except s.Denied:
                counts['leaseNegatives'] += 1
        # Disconnect only at a durable boundary, then require a fresh signed resume.
        original = session.call
        def interrupt(method, value):
            try:
                result = original(method, value)
            except s.Denied as error:
                print('Synthetic native denial: ' + method + ': ' + str(error), file=sys.stderr)
                raise
            if method == 'checkpoint' and len(value['clusters']) == 2:
                raise RuntimeError('Synthetic stopped host at completed prefix')
            return result
        with patch.object(session, 'call', side_effect=interrupt):
            try:
                r.run_batch_engine(session)
                raise AssertionError('fixture did not interrupt')
            except RuntimeError:
                pass
        assert session.batch['checkpoint']['cursor'] == 2 and counts['repair'] == 1
        resumed_claim = exchange(dict(op='pause', value=session.checkpoint_sha()))
        ticket = json.loads(s.unb64(json.loads(resumed_claim['ticket'])['payload'], 4096))
        for mutate in ('manifest', 'candidate', 'code', 'inflight', 'receipt', 'analysis-receipt'):
            journal = session.journal.read_bytes()
            if mutate == 'manifest':
                manifest_path = session.directory / 'batch-manifest.json'
                manifest_path.write_bytes(raw + b' ')
            elif mutate == 'candidate':
                write(sources[1], 'export const secondLabel = value => "drift";\n')
            elif mutate in ('receipt', 'analysis-receipt'):
                record = session.batch['records'][0] if mutate == 'analysis-receipt' else session.batch['records'][-1]
                name = next(name for name in record['artifacts']
                            if name.startswith('checks/') and not name.endswith('.state.json'))
                artifact = worker.ROOT / 'runs' / record['taskId'] / '1' / name
                original_artifact = artifact.read_bytes()
                artifact.write_bytes(original_artifact + b' ')
            else:
                value = json.loads(journal)
                value['batch']['codeSha256' if mutate == 'code' else 'phase'] = '0' * 64 if mutate == 'code' else 'inflight'
                session.journal.write_bytes(s.encoded(value))
            try:
                r.NativeBatchSession(cfg, ticket, raw, lease, operation)
                raise AssertionError('changed resume accepted')
            except s.Denied:
                counts['resumeNegatives'] += 1
            session.journal.write_bytes(journal)
            if mutate == 'manifest':
                manifest_path.write_bytes(raw)
            if mutate == 'candidate':
                write(sources[1], 'export const secondLabel = value => String(value);\n')
            if mutate in ('receipt', 'analysis-receipt'):
                artifact.write_bytes(original_artifact)
        frames = deque([s.encoded(dict(proof=resumed_claim['proof'], bytes=len(raw),
                                        chunks=(len(raw) + 49151) // 49152)) + b'\n'])
        for index, start in enumerate(range(0, len(raw), 49152)):
            data = base64.urlsafe_b64encode(raw[start:start + 49152]).decode().rstrip('=')
            frames.append(s.encoded(dict(index=index, data=data)) + b'\n')
        class FramedInput:
            @property
            def buffer(self):
                return self
            def readline(self, limit):
                return frames.popleft() if frames else b''
        terminal = []
        class FramedOutput:
            pending = ''
            def write(self, text):
                self.pending += text
                while '\n' in self.pending:
                    value, self.pending = self.pending.split('\n', 1)
                    frame = json.loads(value)
                    if 'lease' in frame:
                        response = exchange(dict(op='lease', value=frame['lease']))
                        frames.append(s.encoded(response) + b'\n')
                    else:
                        terminal.append(frame)
            def flush(self):
                pass
        with patch.object(sys, 'stdin', FramedInput()), patch.object(sys, 'stdout', FramedOutput()):
            code = r.batch_main(cfg, operation)
        assert code == 0 and len(terminal) == 1 and terminal[0]['jobId'] == ticket['jobId'], terminal
        completion = exchange(dict(op='complete', value=terminal[0]))
        assert completion == dict(state='tested', processed=4, planRows=281)
        server.wait(timeout=10)
        assert server.returncode == 0
        resumed = session
        resumed.value = r.read_json(resumed.journal, 16 * 1024 * 1024)
        result = resumed.batch['result']
        assert result['status'] == 'tested' and counts['analysis'] == 8 and counts['repair'] == 2
        assert counts['preparation'] == 1 and counts['receipts'] == 20
        learned = r.read_json(checkout / 'docs_private/fixerrors-runtime-knowledge.json')
        assert len(learned['incidents']) == counts['analysis'], 'Advisory history count: ' + str(len(learned['incidents']))
        assert {incident['sourceFile'] for incident in learned['incidents']} == set(sources)
        assert any('candidate-bound analysis passed' in test for incident in learned['incidents']
                   for test in incident['tests'])
        assert int(git('rev-list', '--count', base['head'] + '..HEAD')) == 2
        evidence = r.read_json(checkout / '.git/squires-fixerrors/prepared-release.json')['evidence']
        release.candidate(cfg, dict(repairJobId=ticket['jobId']), evidence)
        original_fingerprint = r.batch_code_sha(cfg)
        cfg['allowRelease'] = True
        assert r.batch_code_sha(cfg) == original_fingerprint
        release.candidate(cfg, dict(repairJobId=ticket['jobId']), evidence)
        immutable = cfg['enrollmentId']
        cfg['enrollmentId'] = str(uuid.uuid4())
        try:
            assert r.batch_code_sha(cfg) != original_fingerprint
            release.candidate(cfg, dict(repairJobId=ticket['jobId']), evidence)
            raise AssertionError('immutable enrollment change accepted')
        except s.Denied:
            pass
        finally:
            cfg['enrollmentId'] = immutable
            cfg['allowRelease'] = False
        try:
            r.NativeBatchSession(cfg, ticket, raw, lease, operation)
            raise AssertionError('completed batch replay accepted')
        except s.Denied:
            counts['resumeNegatives'] += 1
        repair_record = next(record for record in resumed.batch['records'] if not record['readonly'])
        repair_run = worker.ROOT / 'runs' / repair_record['taskId'] / '1'
        analysis_record = next(record for record in resumed.batch['records'] if record['readonly'])
        analysis_run = worker.ROOT / 'runs' / analysis_record['taskId'] / '1'
        for artifact in (repair_run / 'result.md',
                         repair_run / next(name for name in repair_record['artifacts']
                                           if name.startswith('checks/') and not name.endswith('.state.json')),
                         analysis_run / next(name for name in analysis_record['artifacts']
                                             if name.startswith('checks/') and not name.endswith('.state.json'))):
            original_artifact = artifact.read_bytes()
            artifact.write_bytes(original_artifact + b' ')
            try:
                release.candidate(cfg, dict(repairJobId=ticket['jobId']), evidence)
                raise AssertionError('tampered aggregate evidence accepted')
            except s.Denied:
                counts['artifactNegatives'] += 1
            finally:
                artifact.write_bytes(original_artifact)
        # Old per-cluster whole-tree identities cannot masquerade as final union evidence.
        proof = r.read_json(resumed.run / 'batch-proof.json', 16 * 1024 * 1024)
        assert proof['after']['candidate_sha256'] != r.read_json(
            worker.ROOT / 'runs' / resumed.batch['records'][2]['taskId'] / '1/after.json',
            8 * 1024 * 1024)['candidate_sha256']
        print(json.dumps(dict(fixtureOnly=True, modelLaunched=False, released=False, preparedCommits=2,
                              measuredTimings=[item['timings'] for item in resumed.batch['checkpoint']['outcome']['clusters']],
                              consentFingerprintVerified=True, connectedCapture=dict(
                                  pages=captured['pages'], rows=captured['rows'], bytes=captured['bytes'],
                                  newRows=captured['newRows'], heldRows=captured['heldRows'],
                                  framed=True, nullCheckoutResume=True, crossLanguageOutcome=True),
                              counts=counts, result=result, evidence=evidence)))
