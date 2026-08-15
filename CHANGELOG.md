# Changelog

## 0.1.6 — 2026-08-15

- Added a dedicated right-sidebar view with live progress, the latest transfer
  totals, exact errors, controls, and a persistent activity journal.
- Added permanent diagnostics controls in settings for copying a redacted
  error report or the complete VPS Sync activity journal.
- Removed all VPS Sync pop-up notices and the desktop status-bar item; their
  information is now recorded in the sidebar without interrupting work.
- Collapsed repeated queued-run messages into one journal entry with a counter.
- Ignored the plug-in's actual installation directory when its version is part
  of the folder name, preventing journal writes from triggering synchronisation.

## 0.1.5 — 2026-08-15

- Fixed deterministic decryption failures after re-uploading unchanged file
  contents: every ciphertext now receives a blob identifier bound to its IV.
- Added an authoritative desktop migration that re-encrypts legacy blobs once
  when `Отправить хранилище` is used, repairing previously mismatched heads and
  ciphertext without deleting local files.

## 0.1.4 — 2026-08-15

- Displayed the first failing paths and reasons directly in the completion
  notice instead of reporting only an opaque error count.
- Stored up to 500 errors from the latest run and added a settings section for
  viewing or copying the complete diagnostic report on mobile devices.

## 0.1.3 — 2026-08-15

- Stored the non-secret encryption salt in CouchDB so a reinstall can recover
  it automatically instead of silently generating an incompatible value.
- Added an encrypted key verifier so a wrong encryption password is detected
  before any vault data is read or written.
- Migrated a legacy database only after its existing file records were
  successfully decrypted with the restored local settings.

## 0.1.2 — 2026-08-15

- Added automatic, lossless renaming of every path collision caused only by
  letter case.
- Excluded the synchroniser's own folder even when the installation directory
  contains a version suffix such as `vps-sync-0.1.1`.
- Changed uploads to take a consistent byte snapshot of frequently changing
  plug-in settings instead of treating normal background writes as failures.

## 0.1.1 — 2026-08-15

- Made the desktop plug-in directory authoritative during the first download
  to a secondary device.
- Added removal of plug-in folders that exist only on the secondary device.
- Kept ordinary notes and other vault files on the safer merge policy.
- Kept the running VPS Sync folder and per-device enabled plug-in list local.

## 0.1.0 — 2026-08-15

- Added encrypted synchronisation of files, folders, attachments, hidden
  `.obsidian` data, plug-ins, themes, and CSS snippets.
- Added a strictly serial CouchDB request queue with exponential retries.
- Added explicit deletion tombstones and local recovery when server metadata is
  missing.
- Added conflict copies that preserve both independently edited versions.
- Added encrypted connection-code transfer between desktop and mobile devices.
- Added device-local exclusions for layouts, enabled plug-in lists, and the
  synchroniser's own files.
- Added unit tests for reconciliation, encryption, path rules, request
  serialisation, retries, and an encrypted CouchDB round trip.
