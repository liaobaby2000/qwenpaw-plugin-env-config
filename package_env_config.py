import zipfile
from pathlib import Path

root = Path('/app/working/workspaces/coder/qwenpaw-plugin-env-config')
out = root / 'env-config-plugin.zip'

files = [
    'plugin.json',
    'plugin.py',
    'README.md',
    'dist/index.js',
]

# Include all files under data/scripts and data/schemes.
for base in ['data/scripts', 'data/schemes']:
    for path in sorted((root / base).rglob('*')):
        if path.is_file():
            files.append(path.relative_to(root).as_posix())

with zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
    for rel in files:
        path = root / rel
        if not path.exists():
            raise SystemExit(f'missing: {path}')
        zf.write(path, rel)
print(out)
