import zipfile
from pathlib import Path

root = Path('/app/working/workspaces/coder/qwenpaw-plugin-env-config')
out = root / 'env-config-plugin.zip'
files = [
    'plugin.json',
    'plugin.py',
    'README.md',
    'dist/index.js',
    'data/scripts/apt-tsinghua.json',
    'data/scripts/sshd-setup.json',
    'data/scripts/proxychains-setup.json',
    'data/scripts/opencode-setup.json',
    'data/schemes/full-dev.json',
    'data/schemes/minimal.json',
]
with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for rel in files:
        path = root / rel
        if not path.exists():
            raise SystemExit(f'missing: {path}')
        zf.write(path, rel)
print(out)
