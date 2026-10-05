# Source import audit — 2026-10-05

## Scope and recovery

- Work resumed in `D:\.codex\JiawenLex`, branch `local/post-v1-2-1`, at release commit `9dcd9e869d7362b3031410924e71e64e5d73bf88` (`v1.3.9`).
- A verified Git bundle of all refs at that point is `docs/local-changes/recovery-v1.3.9-20261005.bundle` (16,019,769 bytes). Existing untracked inputs and prior local edits were left in place.
- Release metadata is prepared as v1.4.0 following the user's explicit online-update request. The user-authorized local encrypted database checkpoint is verified, and the additive source-rights migration has been applied with identical fingerprints across 37 protected tables. No source content was imported; deployment proceeds through the release commit after these checks.

## File inventory findings

- The P3 set contains 84 DOCX files and 84 MP3/M4A files. 83 pairs have matching normalized filename stems. The remaining pair is `P3-Should parks be built in cities.docx` and `P3-Should parks be built in big cities.mp3`; filename similarity is not enough to publish the pair.
- `P3-What are the differences between living in a city and living in the countryside.docx.mp3` is present and was not renamed. The nested “Why do people still look down…” question and audio both exist under their respective matching nested folders; neither was moved.
- A local Faster-Whisper `base.en` transcription of the 41.425-second parks audio produced the prompt “Shouldn't parks be built in cities?” followed by an affirmative answer. Because the opening polarity is consequential and this is ASR rather than human listening, this pair remains pending manual audio review.
- The 100-sentence audio directory contains numbered files `01.mp3` through `100.mp3`. Numbering has not been used as proof of the PDF match. A local cached English ASR model is available for content comparison; only a small sample has been examined so far.
- Two candidate PDF pairs are byte-identical by SHA-256 and should map to one archived original each:
  - `100句翻译.pdf` and `雅思写作100句（题目）.pdf`: `6943afc07ffe06140ac5160174010ea07fcac9241573a8fd4f2a8cbd8274168e`.
  - `100句翻译 -答案.pdf` and `雅思写作100句（答案-解析）.pdf`: `9cad67239c60befc96f2e6f67c58e5e5ad34c7643a919708ee1c634ab2293173`.
- The requested source folders contain 15 PDF paths representing 13 unique hashes. The separate, unrequested `顾家北` grammar PDF is outside those folders and is not included in that count. The handoff's 11-PDF count does not reconcile with the actual named files; retain the extra material and resolve scope before import.
- The unique `100句翻译.pdf` has a complete 5-page cached Standard parse with all 100 Chinese prompts. Printed numbering repeats 54, so stable candidate identity must not rely on displayed numbering alone.
- The first 10 `01.mp3`–`10.mp3` recordings were transcribed locally with cached Faster-Whisper `base.en`. Their spoken opening sentences do not match prompts 1–10 in `100句翻译.pdf` (for example, audio 01 begins with debate about an alien-civilization signal while prompt 1 is about exercise and confidence; audio 02 begins with the World Wars interrupting Japan's raw-material supply while prompt 2 is about teaching quality). Do not pair this folder to either translation PDF by filename/index. Locate the actual source or retain all 100 tracks as unpaired.

## MinerU evidence checked

- MinerU 4.0.10 local server is healthy; Standard parsing is available. No remote parse was requested.
- `剑18阅读同义替换.pdf` parsed at Standard as `doc:c45e9f9/tier:standard`, SHA-256 `c45e9f9f071ec41fdca7a471ab60944a4d7c0b99301904d1538ed4d1d8fa7cdf`, 4 physical pages.
- All 4 pages were extracted; original-page images for physical pages 2–4 were visually checked against the OCR. The 73 listed pairs match the printed page text. This verifies transcription fidelity for those pages, not the accuracy of the source's synonym claims.
- Preserve source issues for review, including `oil-free - no soil used`, `enrich - add`, `avoid a treat - minimise risk`, `be Steer - superior`, `shortages - negative response`, and `with a few exceptions - not ambitious`. Do not silently rewrite or publish these as verified vocabulary.
- The answer PDF for the 100-sentence set has a completed Standard cache spanning 69 pages, but the current read stopped after pages 1–13 with a continuation for pages 14–69. It contains source corrections, explanations, and extended sample sentences; the complete answer alignment has not been reviewed.
- The P3 parks audio's first ASR phrase is also polarity-ambiguous against its title; this remains a manual-listening issue, separate from whether its file stem resembles the Word title.
- The remaining named Simon/99/synonym PDFs were submitted to the local Standard parser. Long books returned `parse_wait_timeout` and remain pending in the local parser queue; submitted is not the same as completed or reviewed.

## Application change and verification

- `app/api/source-review/route.ts`: private question publication no longer incorrectly requires a group-sharing rights attestation. Group publication still requires the attestation and administrator path.
- Administrator-only read paths now expose members' private original metadata, short-lived original-PDF links, and review candidates. Cross-owner review mutations remain owner-scoped; page-audit writes remain owner-only. Review GET responses are private/no-store.
- Group sharing now has a separate uploader declaration and administrator review status. The uploader's declaration is recorded as pending; an administrator can approve or reject it with reviewer identity, timestamp, and note. Approval alone does not open sharing; the owner must enable it afterward. Rejection closes group visibility. An additive migration preserves existing records and visibility while requiring approval for future sharing changes.
- Admin review of other members' candidates is read-only at the API mutation boundary and in the editor controls. Page-audit controls show read-only summaries for other owners; admin document filters include all documents, and batch publication fetches only the current user's candidates.
- Rights decisions match both the reviewed declaration and its timestamp. Sharing atomically checks approval again when updating visibility. A renewed declaration closes sharing and preserves earlier decisions through the transaction-bound, immutable `source_rights_audit` table.
- TypeScript check passed with `node node_modules/typescript/bin/tsc --noEmit --incremental false`.
- All 19 test files passed when invoked one at a time, including new rights authorization/concurrency tests and a PostgreSQL history rollback regression. The normal `pnpm test` test-worker launch was blocked by sandbox `spawn EPERM`.
- TypeScript and `git diff --check` passed. `pnpm build` passed after approval to write generated build files in the workspace.
- The `pnpm backup` wrapper's missing default mode is fixed while preserving explicit modes such as `verify`. The user specifically authorized the configured cloud destination, and the elevated backup attempt was allowed. Both configured backup and source reader keys can head/list buckets but object reads return `AccessDenied 403`; no complete cloud snapshot was verified.
- The user subsequently explicitly authorized the local archive. The checkpoint at `.source-archive/release-checkpoint-v1.4.0-2026-10-05-OGSpwo/` passed encrypted round-trip hashes and `pg_restore --list`; the manifest retains 118 source-object references. External stored files were not copied, and an isolated restore was not rehearsed.
- Only `20261005090000_source_rights_review.sql` was applied. Before/after protected fingerprints match: `69d05edcc6a99dd78cfdcf37afa2f73d554acfd5607d5b19d0930832e7b17760`. Existing data, source visibility and live sessions are unchanged.

## Still pending

- Finish and collect MinerU parses for all requested PDFs and read continuations to complete coverage.
- Convert the P3 Word sources to page-stable PDF reading copies before creating physical-page evidence; original DOCX files remain untouched.
- Match audio by listening/transcription against each actual question and answer, and do not create/publish listening exercises until a real uploaded playable recording is attached and checked.
- Review answers, figures, source quality, and unresolved OCR/page issues. Keep all candidate review flags false until the specific original-page and answer-key checks are complete.
- Finish PDF/audio evidence and unresolved content review before importing source content.
- Resolve the configured cloud backup object read permissions separately. The local encrypted database checkpoint is usable for this additive migration; stored-file backup and isolated-restore limitations remain recorded.
- Review the final scoped diff, release metadata/version policy, migration rollout, and Vercel release trigger before publishing.
