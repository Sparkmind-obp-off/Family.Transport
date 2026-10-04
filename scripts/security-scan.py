"""Report candidate secret locations only, never credential values."""
import os,re,subprocess,sys
from pathlib import Path
patterns = [
    r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY',
    r'gh[pousr]_[A-Za-z0-9]{20,}', r'github_pat_[A-Za-z0-9_]{20,}',
    r'sk_live_[A-Za-z0-9]{12,}', r'AKIA[0-9A-Z]{16}',
    r'(?i)(?:password|api[_-]?key|secret|token)\s*[:=]\s*[\"\x27][A-Za-z0-9/+_=.-]{20,}[\"\x27]'
]
known = [os.environ.get('CLOUDFLARE_API_TOKEN', ''), os.environ.get('GSK_TOKEN', '')]
for filename in ['.dev.vars', '.env.production']:
    if Path(filename).exists():
        known += [s.split('=',1)[1].strip() for s in Path(filename).read_text().splitlines() if '=' in s]
known = [s for s in known if len(s) >= 20]
findings = set()
def check(content, location):
    for pattern in patterns:
        if re.search(pattern,content): findings.add(location)
    if any(value in content for value in known): findings.add(location)
files = subprocess.check_output(['git','ls-files','-co','--exclude-standard'],text=True).splitlines()
for name in set(files):
    if Path(name).is_file(): check(Path(name).read_text(errors='replace'), name)
commits = subprocess.check_output(['git','rev-list','--all'],text=True).splitlines()
for commit in commits:
    paths = subprocess.check_output(['git','ls-tree','-r','--name-only',commit],text=True).splitlines()
    for name in paths:
        check(subprocess.check_output(['git','show',f'{commit}:{name}']).decode(errors='replace'),commit[:8]+':'+name)
print(f'Secret scan: {len(set(files))} working files, {len(commits)} commits, {len(findings)} candidate locations (values suppressed).')
for finding in sorted(findings): print('REVIEW:',finding)
sys.exit(1 if findings else 0)
