# JiawenLex v1.2.0 — administrator content publication

User authorized publishing pending material and a production version update on 2026-10-01. Video uploads are deferred; video code is held in the ignored local archive and excluded from this release.

## Changes
- Explicit administrator approval is recorded separately from source-page verification. Original reviewed_against_pdf and answer_alignment_checked flags remain unchanged.
- Structurally valid questions, vocabulary and study guides can be shared with active members. Extraction issues, incomplete questions and unresolved question duplicates remain pending.
- Administrator-approved questions display a review notice and are excluded from automated scoring. Shared vocabulary displays the approval notice.
- Bulk word publication deduplicates shared templates and preserves existing personal memory schedules and review events.
- The review screen exposes an administrator-only approval option. Existing verified publication remains available.

## Recovery and checks
- Private encrypted release checkpoint: 25,473 candidate rows in 128 chunks, database archive and 94 original-file references. Every encrypted chunk was authenticated/decrypted; coverage and database archive directory were checked. Originals remain in private storage and local source files.
- pg_dump of the large candidate table loses its SSL COPY connection. The release checkpoint saves that table in encrypted chunks alongside the database dump; this checkpoint is separate from scheduled backups.
- 93 regression checks pass; TypeScript and production build pass. Existing attempts, drafts, sessions, plans and vocabulary review events are compared after publication.
- Publication results and held-item reasons are kept privately under .source-archive, without credentials.

After this release, subsequent changes stay local until the next explicit version-update request.
