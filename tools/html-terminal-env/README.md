# HTML Terminal Environment

This helper builds a focused terminal workbench for HTML edits.

What it does:
- Uses `frontend/` as the editable source of truth.
- Creates `.html-terminal-env/workspace/` with hardlinked HTML and nearby support assets.
- Writes `.html-terminal-env/manifest.json` so you can see what is linked and which files are mirrors.
- Leaves root and `backend/public/` HTML files out of the edit surface unless they are true source files.

Why this exists:
- The repo has a large amount of scratch and snapshot HTML.
- Editing from a narrow workbench is easier when you only want the live HTML surface and its adjacent assets.

How to use it:
- Run the VS Code task `HTML Edit Shell`.
- Or run `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\html-terminal-env\enter-html-terminal-env.ps1` from the repo root.

What to edit:
- Edit files inside `.html-terminal-env/workspace/`.
- Those files are hardlinks, so changes write through to `frontend/`.

What not to edit first:
- Root HTML files like `portal.html` and `bundles.html` are mirrors in this repo.
- `backend/public/*.html` is also a mirror/artifact surface.

Useful follow-up commands:
- Sync mirrored portal/bundles files: `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\sync-workspace.ps1`
- Rebuild the single-file dashboard artifact: `node .\scripts\build-dash-singlefile.js`