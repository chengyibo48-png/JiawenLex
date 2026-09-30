<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# User release policy (2026-09-30)

- The user authorized the current audit/fix/content publication as JiawenLex v1.0.0. After this release, all new file/code/content changes remain local until the user explicitly asks to update a version.
- Do not push, deploy, apply live migrations, import/publish candidates to the production database, or run a local preview against production for write tests without that later release request. Localhost can still use the production database: it is not an isolated staging environment.
- Prepare changes on a local development branch. Main is the release branch; do not create `release: vX.Y.Z` commits or change release metadata without the user's version-update request.
- Vercel's ignoreCommand skips ordinary commits. A release commit must start `release: vX.Y.Z` and match release.json and package.json; only create it after the user-authorized release is ready.
- Before release, document changes, run requested regression checks and record a recoverable checkpoint. Use additive, backward-compatible migrations; preserve all user records, drafts, archives, word schedules, sessions and preferences. Keep material IDs and historical versions. Do not reset/reseed/replace user data or require global logout as part of an upgrade.
- Fix source content through versioned application interfaces. Never mark unchecked OCR verified. Retain unresolved material with specific issues.
- Read-only live audits and the existing scheduled backup/retention/reminder behavior can continue; this rule limits assistant-initiated release changes, not normal user activity.
