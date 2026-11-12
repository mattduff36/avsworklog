"""Offline fixed-code failure transport; never loads enrollment or calls a provider."""
import io
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts/automation'))
import squires_repair as r

with tempfile.TemporaryDirectory(prefix='SquiresFailure-') as folder:
    root = Path(folder)
    events = root / 'events.jsonl'
    for code, expected in [('organization_spend_limit_exceeded', 'worker-provider-limit'),
                           ('PRIVATE_UNKNOWN', 'worker-execution-failed')]:
        events.write_text(json.dumps({'type': 'model.call_failure', 'data': {
            'errorCode': code, 'errorMessage': 'PRIVATE_SECRET'}}), encoding='utf-8')
        assert r.worker_failure_code(root) == expected
    events.write_text('PRIVATE_MALFORMED', encoding='utf-8')
    assert r.worker_failure_code(root) == 'worker-execution-failed'

class Process:
    def __init__(self):
        self.stdin = io.BytesIO()
        self.stdout = io.BytesIO(b'{"failure":"worker-provider-limit"}\n')
        self.returncode = 2
    def poll(self): return 2
    def wait(self, timeout=None): return 2

with patch.object(r.subprocess, 'Popen', return_value=Process()):
    try:
        r.monitored_native_operation({}, 'dispatch', {'request': {'mode': 'ask', 'timeout_minutes': 2}},
                                     lambda: None, lambda: None)
    except r.s.Denied as error:
        assert str(error) == 'worker-provider-limit'
    else:
        raise AssertionError('Provider failure accepted')

session = r.NativeBatchSession.__new__(r.NativeBatchSession)
outcome = {'clusters': [{'status': 'failed'}], 'decisions': []}
session.manifest = json.dumps({'retrieval': {'clusters': [{}]}}).encode()
session.value = {'batch': {'records': [], 'checkpoint': {'outcome': outcome}}}
session.mode = 'repair'
session.live = session.assert_snapshot = session.verify_checkpoint = session.save = lambda: None
result = session.finish(outcome)
assert result['status'] == 'failed' and result['batch']['counts']['failed'] == 1
assert session.batch['phase'] == 'completed'
print('Fixed failure categories, native transport and failed batch result verified')
