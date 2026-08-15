# VPS Sync

VPS Sync is an Obsidian plug-in for reliable encrypted synchronisation between
desktop and mobile devices through a self-hosted CouchDB server.

The project is intentionally smaller than Self-hosted LiveSync. It does not use
PouchDB replication, continuous HTTP connections, parallel downloads, or
multiple transport modes. Every CouchDB request is performed through one
strictly serial queue and is retried after temporary failures.

## Interface and diagnostics

VPS Sync keeps routine operation out of Obsidian's pop-up notices and status
bar. Its right-sidebar view shows live progress, the latest transfer totals,
exact errors, and a persistent activity journal. The settings page can copy a
redacted error report or the complete activity journal for troubleshooting;
neither report contains passwords, the encryption salt, or the connection code.

## Synchronised data

- Markdown notes and all other file types inside the vault.
- Folder structure, including empty folders.
- Attachments.
- `.obsidian/plugins`, including plug-in code and `data.json` settings.
- Themes, CSS snippets, hotkeys, appearance settings, and other `.obsidian`
  files unless explicitly excluded.

## Device-local data

The following data is excluded by default:

- `.obsidian/workspace.json` and `.obsidian/workspace-mobile.json` because the
  desktop and mobile layouts are different.
- `.obsidian/community-plugins.json` because enabling a desktop-only plug-in on
  iOS can prevent Obsidian from starting correctly. Plug-in folders and their
  settings are still synchronised; enable compatible plug-ins once per device.
- `.obsidian/plugins/vps-sync` because the synchroniser must not replace its own
  running code or copy its passwords to another device.
- `.git`, `.trash`, operating-system metadata, and additional user patterns.

## Security

File contents and path metadata are encrypted on the client with AES-256-GCM.
Keys are derived with PBKDF2-HMAC-SHA-256 using 310,000 iterations. CouchDB sees
only encrypted values and keyed identifiers. HTTPS remains mandatory.

The random encryption salt is not secret and is stored in a service document
inside CouchDB. A reinstall restores it automatically. An encrypted verifier
checks the password before vault data is accessed; the password and derived
keys never leave the device.

The connection code contains the CouchDB password and the encryption password.
Treat it as a secret and delete it after configuring the second device.

## First setup

1. Install the plug-in on the desktop device.
2. Enter the CouchDB root URL, a new database name, credentials, and an
   encryption password of at least 12 characters.
3. Test the connection.
4. Choose `Отправить хранилище` on the desktop device.
5. Install the plug-in manually on the iPhone.
6. Copy the connection code from the desktop settings, paste it on the iPhone,
   and apply it.
7. Choose `Получить хранилище` on the iPhone.

During that first download, `.obsidian/plugins` is mirrored from the desktop
source: complete configured plug-in folders are copied, and plug-in folders
that exist only on the iPhone are removed. This strict mirroring applies only
to installed plug-in folders; ordinary notes retain merge behaviour.

Do not run Obsidian Sync, Self-hosted LiveSync, Remotely Save, Syncthing, or any
other writer against the same vault at the same time. Git may be used as backup
history, but automatic pulls must not run while VPS Sync is active.

On iOS, synchronisation runs while Obsidian is open. Apple does not permit an
Obsidian community plug-in to keep arbitrary network and filesystem work alive
after the application has been closed.
