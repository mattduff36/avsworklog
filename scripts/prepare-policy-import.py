"""Prepare the supplied SharePoint ZIP locally; never connects to a database.

Usage: python scripts/prepare-policy-import.py PATH_TO_ZIP
Original bytes and manifest go to ignored data/policies-procedures/import.
All versions start as drafts; document controllers confirm publication in-app.
"""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import sys
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'data/policies-procedures/import'

def prepare(source):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    references = set()
    with zipfile.ZipFile(source) as archive:
        if sum(item.file_size for item in archive.infolist()) > 200 * 1024 * 1024:
            raise ValueError('Archive exceeds the 200 MB import limit.')
        for item in archive.infolist():
            if item.is_dir():
                continue
            name = PurePosixPath(item.filename).name
            ext = PurePosixPath(name).suffix.lower()
            if ext not in ('.docx', '.doc', '.xlsx', '.pdf') or not 0 < item.file_size <= 4 * 1024 * 1024:
                raise ValueError('Unsupported file or size: ' + item.filename)
            data = archive.read(item)
            digest = hashlib.sha256(data).hexdigest()
            document_id = str(uuid.uuid5(uuid.NAMESPACE_URL, 'squires-policy:' + item.filename))
            version_id = str(uuid.uuid5(uuid.NAMESPACE_URL, 'squires-policy-version:' + digest + ':' + item.filename))
            match = re.match(r'(AVS-(?:SHEQ-)?(?:CP|EMP|HSMP|IMS|IMS-MAN)-\d+)', name)
            reference = match.group(1) if match else 'AVS-EMPLOYEE-HANDBOOK'
            if reference.lower() in references:
                raise ValueError('Duplicate reference needs review: ' + reference)
            references.add(reference.lower())
            title = PurePosixPath(name).stem[len(match.group(1)):].strip(' .-') if match else PurePosixPath(name).stem
            title = re.sub(r'\s*(?:Rev\s*\d+\s*)?(?:March|September)?\s*(?:2026|26)(?:\s*\(1\))?\.*$', '', title, flags=re.I).strip(' .-')
            if title.isupper():
                title = title.title()
            category = ('Company policies' if item.filename.startswith('Policies Word/') else
                        'Environmental procedures' if '/Environmental Procedures/' in item.filename else
                        'Health and safety procedures' if '/HS Poilcies/' in item.filename else
                        'Quality management procedures' if '/QMS Procedures/' in item.filename else 'Manuals and handbooks')
            text = ''
            if ext == '.docx':
                with zipfile.ZipFile(io.BytesIO(data)) as inner:
                    for member in inner.namelist():
                        if re.match(r'word/(document|footer\d+|header\d+)\.xml$', member):
                            xml = ET.fromstring(inner.read(member))
                            text += '\n' + ' '.join(node.text or '' for node in xml.iter() if node.tag.endswith('}t'))
            version_match = re.search(r'\bREV\s*\.?\s*(\d+)\s*\.?\s*(\d+)?', text[-2000:], re.I)
            label = (version_match.group(1) + ('.' + version_match.group(2) if version_match.group(2) else '')) if version_match else ('6' if 'Manual Rev 6' in name else '2026 supplied issue')
            flags = []
            if ext == '.doc': flags.append('Legacy Word format: document controller must check content before publication.')
            if re.search(r'\b(?:TBC|TBD|TO BE COMPLETED)\b|\[insert|DRAFT\s+(?:VERSION|ONLY|COPY)', text, re.I): flags.append('Possible incomplete-content marker: review before publication.')
            if 'Employee Handbook' in name: flags.append('Source footer uses AVS-SHEQ-IMS-006, also used by Inspection and Testing; kept under AVS-EMPLOYEE-HANDBOOK to avoid collision.')
            target = OUTPUT / (version_id + ext)
            if not target.exists(): target.write_bytes(data)
            elif hashlib.sha256(target.read_bytes()).hexdigest() != digest: raise ValueError('Existing imported file differs: ' + str(target))
            records.append({'document_id': document_id, 'id': version_id, 'reference': reference, 'title': title, 'category': category, 'version': 1, 'version_label': label, 'status': 'draft', 'effective_date': None, 'review_date': None, 'notes': 'Imported from SharePoint: ' + item.filename + '\n' + '\n'.join(flags), 'file_name': name, 'file_size': len(data), 'storage_path': target.name, 'sha256': digest, 'source_path': item.filename, 'review_flags': flags, 'completion_candidate': not flags})
    (OUTPUT / 'manifest.json').write_text(json.dumps({'source_sha256': hashlib.sha256(Path(source).read_bytes()).hexdigest(), 'documents': records}, indent=2, ensure_ascii=False), encoding='utf8')
    print(json.dumps({'documents': len(records), 'completion_candidates': sum(r['completion_candidate'] for r in records), 'needs_review': [r['reference'] for r in records if r['review_flags']], 'destination': str(OUTPUT)}))

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit('Usage: python scripts/prepare-policy-import.py ZIP_PATH')
    prepare(sys.argv[1])
