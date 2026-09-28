"""Create a source-only archive next to the project directory."""
from pathlib import Path
import os
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
archive = root.parent / "JiawenLex-source.zip"
excluded_dirs = {"node_modules", ".next", ".git", ".pnpm-store", ".vercel", "__pycache__"}
excluded_names = {".env.local", "tsconfig.tsbuildinfo"}

with ZipFile(archive, "w", ZIP_DEFLATED) as package:
    for directory, folders, files in os.walk(root):
        folders[:] = [name for name in folders if name not in excluded_dirs]
        for name in files:
            if name in excluded_names or name.endswith(".log"):
                continue
            path = Path(directory) / name
            package.write(path, Path("JiawenLex") / path.relative_to(root))

print(archive)
