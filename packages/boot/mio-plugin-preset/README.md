---
description: "Apply mioagent plugin catalog presets to installed plugins whose settings entry has no user overrides."
kind: "package-reference"
---

# @deepseek-ai/dsh-mio-plugin-preset

English | [中文](README.zh.md)

## Summary

`mio-plugin-preset` watches installation and settings changes, reads the enabled plugin catalog through `mioAccount`, and writes a catalog entry's preset into its target settings entry when that entry has no user-configured channels. The catalog's `config` object uses a product envelope with a target and values; the Host resolves account placeholders before writing, so the renderer never receives the raw preset. A successful write is idempotent: the next sweep sees the user-configured channels and skips. A missing entry, an inactive plugin, or an unresolved placeholder leaves the preset for a later sweep and never fails the installation.

## Use this package

Mount the row beside `mio-account`:

```yaml
- id: mio-plugin-preset
  name: '@deepseek-ai/dsh-mio-plugin-preset'
```

The plugin injects `mioAccount`, `settings`, and `pluginManager`. It runs once shortly after startup, after `plugin-manager/changed` with `install` or `bundle`, and after a settings document update. Each sweep ignores signed-out accounts, catalog entries whose package is not installed, entries without a preset, and imagegen entries that already carry user channels, channel secrets, or a default channel.

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
- There is no preset version or migration. An existing user's settings are never overwritten, and a changed preset reaches only users whose target entry is still empty.
- A plugin that requires a restart is retried after the entry becomes active; there is no persistent pending queue across a failed settings service.
