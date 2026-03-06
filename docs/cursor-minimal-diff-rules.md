# Cursor Minimal Diff Rules

## Core limits
- Keep files under about 800 lines.
- If a file grows past that limit, split it before adding more logic.
- Make the smallest possible edit for each task.

## Structure rules
- Extract repeated UI blocks into shared components.
- Move stateful logic into focused hooks when it improves patch size.
- Keep route files thin and focused on composition and data flow.

## Safety rules
- Avoid full-file rewrites for localized changes.
- Do not include formatting-only edits in functional tasks.
- Keep changes scoped to related files only.
