# Recovery checkpoint — 2026-10-05

Work resumed at commit `9dcd9e869d7362b3031410924e71e64e5d73bf88` on branch `local/post-v1-2-1`. The verified Git bundle is `recovery-v1.3.9-20261005.bundle`.

Pre-existing uncommitted and untracked files remain in the shared workspace and are intentionally excluded from the release.

The user explicitly authorized a local encrypted production database checkpoint after the configured cloud backup could not read its objects (HTTP 403).

- Manifest: `.source-archive/release-checkpoint-v1.4.0-2026-10-05-OGSpwo/manifest.jlex`.
- Database: 10,794,078 plaintext bytes, stored encrypted as `database.jlex`.
- SHA-256: `b05aa9dcb5f5e28f25be87b658b6c0c5451ad68c79124a854087bb339672202a`.
- The encrypted archive and manifest were decrypted and checked. `pg_restore --list` confirmed archive readability and required user/review table data.
- 118 original-file references are recorded in the encrypted manifest. External storage files were not copied. Auth session/refresh-token rows and temporary import/upload token data are excluded consistently with the scheduled backup policy.
- The raw dump was removed; encrypted files remain in the ignored local `.source-archive` directory and are excluded from Git.

This is database archive validation, not an isolated restore rehearsal. The release migration separately verifies that existing application records and live Auth sessions are unchanged.
