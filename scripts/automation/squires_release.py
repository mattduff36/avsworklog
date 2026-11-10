"""Staged exact-candidate release verifier; preparation never authorizes release."""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import squires_companion as s

RELEASE_METADATA = frozenset(('lib/config/release-version.json',
                              'lib/config/release-history.json', 'docs_private/release-log.md'))


def prepared_candidate(run, request, after, actual, cfg):
    from run_worker import git
    from worker_checks import CheckServer
    from squires_repair import scoped_checks, read_json

    def parent(head):
        chain = git(s.WORKSPACE, 'rev-list', '--parents', '-n', '1', head).decode().split()
        s.require(len(chain) == 2 and chain[0] == head, 'prepared_candidate_not_linear')
        return chain[1]

    s.require(actual['branch'] == 'main' and not actual['status'], 'prepared_candidate_not_clean')
    repair_commit = parent(actual['head'])
    s.require(parent(repair_commit) == after['head'], 'prepared_candidate_base_changed')
    changed = set(git(s.WORKSPACE, 'diff', '--name-only', '--no-renames', '-z',
                      repair_commit, actual['head']).decode().split('\0')) - {''}
    s.require(changed and changed <= RELEASE_METADATA, 'prepared_candidate_has_unapproved_changes')
    s.require(all(s.identifier(actual['files'].get(k), re.compile(r'[0-9a-f]{64}:\d+')) for k in changed),
              'prepared_metadata_not_regular_files')
    s.require({k: v for k, v in after['files'].items() if k not in RELEASE_METADATA} ==
              {k: v for k, v in actual['files'].items() if k not in RELEASE_METADATA},
              'prepared_candidate_changes_worker_result')
    decision = read_json(run / 'validated-decision.json')
    s.require(s.sha(s.encoded(decision)) == request['squires_job']['decisionSha256']
              and len(decision['clusters']) == 1
              and decision['clusters'][0]['files'] == request['editable_paths'],
              'prepared_decision_changed')
    expected_checks = scoped_checks(cfg, decision['clusters'][0]['requiredTestIds'], request['editable_paths'])
    prep = run / 'prepared'
    path = prep / 'check-config.json'
    config = read_json(path)
    checks = request['checks']
    s.require(config.get('candidate_scope') == 'worktree' and Path(config['workspace']) == s.WORKSPACE
              and Path(config['run_dir']) == prep and config.get('checks') == checks == expected_checks,
              'prepared_check_config_changed')
    return CheckServer(path)


def verify_prepared_checks(server, selected, actual):
    s.fields(selected, server.checks)
    for check_id, proof in selected.items():
        s.fields(proof, ('receiptId', 'sha256'))
        s.require(s.identifier(proof['receiptId'], re.compile(r'[0-9a-f]{32}'))
                  and s.identifier(proof['sha256'], s.HEX), 'invalid_prepared_receipt_reference')
        raw = (server.receipts / (proof['receiptId'] + '.json')).read_bytes()
        s.require(len(raw) <= 1024 * 1024 and s.sha(raw) == proof['sha256'], 'prepared_receipt_changed')
        receipt = s.decode_json(raw)
        check = server.checks[check_id]
        s.require(receipt.get('receipt_id') == proof['receiptId'] and receipt.get('check_id') == check_id
                  and receipt.get('config_sha256') == server.config_hash
                  and receipt.get('argv') == check['argv'] and receipt.get('cwd') == check['cwd']
                  and receipt.get('passed') is True and receipt.get('exit_code') == 0
                  and receipt.get('timed_out') is False and receipt.get('termination_confirmed') is True
                  and receipt.get('candidate_stable') is True
                  and receipt.get('candidate_sha256') == actual['candidate_sha256'],
                  'prepared_receipt_not_bound_to_candidate')


def candidate(cfg, ticket, review):
    from run_worker import ROOT, snapshot
    from squires_repair import read_json
    s.require(s.config() == cfg, 'enrollment_changed')
    head, tree = s.inspect(cfg, False)
    run = ROOT / 'runs' / ('squires-fixerrors-' + ticket['repairJobId']) / '1'
    raw = (run / 'state.json').read_bytes()
    s.require(len(raw) <= 1024 * 1024 and s.sha(raw) == review['workerResultSha256'], 'worker_result_changed')
    state = s.decode_json(raw)
    request = read_json(run / 'request.json')
    after = read_json(run / 'after.json', 8 * 1024 * 1024)
    actual = snapshot(s.WORKSPACE)
    s.require(request.get('origin') == s.ORIGIN and request.get('mode') == 'implement'
              and request.get('squires_job', {}).get('jobId') == ticket['repairJobId']
              and tuple(request.get('checks', {})) == ('targeted-tests', 'typecheck', 'lint')
              and state.get('origin') == s.ORIGIN and state.get('status') == 'review_required'
              and state.get('exit_code') == 0 and state.get('issues') == [] and state.get('changed_files')
              and state.get('out_of_scope_files') == []
              and state.get('candidate_sha256') == after.get('candidate_sha256')
              and state.get('head') == after.get('head') and state.get('branch') == after.get('branch') == 'main'
              and 'preparedChecks' in review, 'candidate_not_a_tested_worker_result')
    checks = prepared_candidate(run, request, after, actual, cfg)
    verify_prepared_checks(checks, review['preparedChecks'], actual)
    s.require((head, tree, actual['candidate_sha256']) ==
              (review['head'], review['tree'], review['candidateSha256']), 'prepared_candidate_drift')
    return head, tree, actual['candidate_sha256']


@contextmanager
def release_lock():
    from run_worker import ROOT, digest, save
    p = ROOT / 'locks' / (digest(str(s.WORKSPACE).casefold().encode())[:24] + '.json')
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    except FileExistsError:
        raise s.Denied('checkout_busy') from None
    os.close(fd)
    retain = False
    try:
        save(p, {'runner_pid': os.getpid(), 'workspace': str(s.WORKSPACE), 'phase': 'squires-prepared-candidate'})
        yield
    except BaseException:
        retain = True
        raise
    finally:
        if not retain:
            p.unlink()


def fixed_adapter(cfg):
    adapter = s.fields(cfg['releaseAdapter'], ('nodeExe', 'script', 'sha256'))
    node, path = Path(adapter['nodeExe']), Path(adapter['script'])
    s.require(node.is_absolute() and node.name.lower() == 'node.exe' and node.is_file()
              and path.is_absolute() and path.name == 'squires-fap-adapter.mjs'
              and path.is_file() and not path.is_symlink() and path.resolve() == path
              and not path.is_relative_to(s.WORKSPACE) and path.stat().st_size <= 1024 * 1024
              and s.sha(path.read_bytes()) == adapter['sha256'], 'release_adapter_not_pinned')
    return [str(node), str(path)]


def execute(cfg, ticket):
    command = fixed_adapter(cfg)
    from squires_repair import local_env
    env = local_env()
    # Git overrides are intentionally not forwarded to finalise; its own guarded path owns Git.
    env = {k: v for k, v in env.items() if not k.startswith('GIT_')}
    with tempfile.TemporaryFile() as out:
        result = subprocess.run(command, cwd=s.WORKSPACE, input=s.encoded(ticket), stdout=out,
                                stderr=subprocess.DEVNULL, env=env, timeout=1800,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        out.seek(0)
        body = s.fields(s.decode_json(out.read(4097)), ('status', 'deploymentId'))
    s.require(body['status'] in ('released', 'blocked', 'failed', 'unknown')
              and (body['deploymentId'] is None or s.identifier(body['deploymentId'], re.compile(r'dpl_[A-Za-z0-9]{1,120}')))
              and (body['status'] != 'released' or (result.returncode == 0 and body['deploymentId'])),
              'unknown_release_result')
    if body['status'] == 'unknown':
        raise RuntimeError('release_result_unknown')
    return {'approvalId': ticket['approvalId'], 'repairJobId': ticket['repairJobId'], **body}


def main():
    try:
        cfg = s.config()
        s.local_runtime(cfg)
        fixed_adapter(cfg)
        raw = sys.stdin.buffer.read(s.MAX_INPUT + 1)
        invoked = False
        admission = None

        def invoke(ticket):
            nonlocal invoked
            invoked = True
            return execute(cfg, ticket)
        with release_lock():
            try:
                result = s.release(raw, cfg, lambda t, r: candidate(cfg, t, r), invoke)
            except Exception as exc:
                if invoked:
                    raise
                admission = exc
        if admission is not None:
            raise admission
        print(json.dumps(result), flush=True)
        return 0 if result['status'] == 'released' else 2
    except Exception as exc:
        print(json.dumps({'status': 'unknown' if locals().get('invoked') else 'blocked',
                          'reason': str(exc) if isinstance(exc, s.Denied) else type(exc).__name__}), flush=True)
        return 2


if __name__ == '__main__':
    sys.exit(main())
