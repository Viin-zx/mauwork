---
description: "Apply mioagent plugin catalog presets to installed plugins whose settings entry has no user overrides."
kind: "package-reference"
---

# @deepseek-ai/dsh-mio-plugin-preset

English | [中文](README.zh.md)

## Summary

`mio-plugin-preset` watches installation and settings changes, reads the plugin catalog through `mioAccount`, and writes the catalog preset into its target settings entry. A newly installed package always overwrites existing user channels; startup and later events only fill targets without user channels, while a fresh sign-in or changed model credential refreshes only the preset-managed channel's key and base URL. The Host resolves account placeholders before writing, and a profile-local marker keeps the force intent across a restart. Missing entries, inactive plugins, and unresolved placeholders leave the preset for a later sweep without failing installation.

## Use this package

Mount the row beside `mio-account`:

```yaml
- id: mio-plugin-preset
  name: '@deepseek-ai/dsh-mio-plugin-preset'
```

The plugin injects `mioAccount`, `settings`, and `pluginManager`. It runs once shortly after startup, after `plugin-manager/changed` with `install` or `bundle`, and after a settings document update. Each sweep ignores signed-out accounts, catalog entries whose package is not installed, entries without a preset, and imagegen entries that already carry user channels, channel secrets, or a default channel. A sweep caused by `mio-account/changed` refreshes the managed channel of a configured target: the resolved base URL and API key are merged into that channel only, and a channel the user deleted is not recreated. A package that appears as newly installed is force-applied with `settings.replace`; the pending marker is written before that write so a restart-required installation is still forced on the next start. A pending install retries once per second for up to 20 seconds while its settings entry activates, and a non-secret failure is recorded in `last-error.json` beside the marker. After a forced in-process install is written and its marker cleared, the Host emits `mio-plugin-preset/applied`; the plugin market reloads the renderer once so the plugin's settings page mounts against the new config. A marker loaded at startup applies without that reload.

A catalog `config` is a preset when it carries this envelope:

```json
{
  "schemaVersion": 1,
  "target": "imagegen",
  "policy": "empty-only",
  "values": {
    "channelSecrets": { "mio": "{{MIO_API_KEY}}" }
  }
}
```

`target` currently accepts `imagegen`, owned by `@q253595422/dsh-imagegen-video`. `policy` only accepts `empty-only`. `values` may contain exact `{{MIO_MODEL_BASE_URL}}` and `{{MIO_API_KEY}}` strings anywhere in its JSON structure; other placeholders and embedded placeholders are refused. The account HTTP provider supplies both values from `/models/config`, and the resolved key is written to plugin settings only because the preset explicitly requests it; the proxy mode for image providers remains future work.

## Model Experience

### Plugin settings preset

#### What the model sees

Nothing. The `mio-plugin-preset` row registers no prompt content, tools, or Session events; it only writes user-owned plugin settings.

#### Token effect

No token is added.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

- Only the `imagegen` target is registered. A new plugin needs an explicit target-to-package entry and a settings schema review.
- The direct `{{MIO_API_KEY}}` mode stores the account key in the plugin's profile configuration, which the imagegen plugin itself documents as plaintext. Prefer a loopback image proxy before production use.
- There is no preset version or migration. A new installation or reinstall replaces the target's user channels with the catalog preset; later startups do not overwrite edits made after that.
- The pending marker is best-effort local state. If the profile home is read-only, a restart-required installation may not be forced after the restart.
- A plugin that requires a restart is retried after the entry becomes active; there is no persistent pending queue across a failed settings service.
