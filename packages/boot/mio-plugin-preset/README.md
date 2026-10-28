---
description: "Apply mioagent plugin catalog presets to installed plugins and install the catalog defaults once per profile."
kind: "package-reference"
---

# @deepseek-ai/dsh-mio-plugin-preset

English | [中文](README.zh.md)

## Summary

`mio-plugin-preset` reads the mioagent plugin catalog through `mioAccount` and writes each entry's preset into its target plugin settings, resolving account placeholders before writing. A newly installed package always overwrites existing user channels; startup and later events only fill targets without user channels, and a fresh sign-in or changed model credential refreshes only the preset-managed channel's key and base URL. A catalog entry the administration switched on with `autoRefresh` is overwritten with the current preset at each startup, hand edits included. The same sweep installs the catalog defaults once per profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the row beside `mio-account`; it needs a bound profile:

```yaml
- id: mio-plugin-preset
  name: '@deepseek-ai/dsh-mio-plugin-preset'
  disabled: !!js "!ctx.get('profileContext')"
```

The plugin injects `mioAccount`, `settings`, and `pluginManager`. It runs once shortly after startup, after `plugin-manager/changed` with `install` or `bundle`, and after a settings document update. Each sweep timer is scheduled outside any active HMR transaction: a settings entry publishing during a reload emits its event inside that transaction, and a sweep created there could not write settings without being refused as a nested transaction. Each sweep ignores signed-out accounts, catalog entries whose package is not installed, entries without a preset, and imagegen entries that already carry user channels, channel secrets, or a default channel. A sweep caused by `mio-account/changed` refreshes the managed channel of a configured target: the resolved base URL and API key are merged into that channel only, and a channel the user deleted is not recreated. A package that appears as newly installed is force-applied with `settings.replace`; the pending marker is written before that write so a restart-required installation is still forced on the next start. A pending install retries once per second for up to 20 seconds while its settings entry activates, and a non-secret failure is recorded in `last-error.json` beside the marker. After a forced in-process install is written and its marker cleared, the Host emits `mio-plugin-preset/applied`; the plugin market reloads the renderer once so the plugin's settings page mounts against the new config. A marker loaded at startup applies without that reload.

The same sweep installs `DEFAULT_INSTALL_PACKAGES` (`dsh-skill-mcp-panel` and `@wxg-prc-cpg/browser-skill-dsh-plugin`) when the profile has never handled them. A package found already present is recorded as handled, so a later removal keeps it removed. A failed installation stays unrecorded and retries at the next sign-in or process start instead of reacting to its own change event in a loop. One defaults pass that installs packages emits `mio-plugin-preset/defaults-installed`; the plugin market reloads the renderer so the new client bundles load.

The sweep shortly after startup carries the catalog refresh. That startup sweep force-overwrites with `settings.replace` every entry whose plugin record has automatic refresh switched on, so a model the administration moves to a new endpoint reaches the client at the next launch without a reinstall. A sweep that ran before sign-in leaves the refresh armed, so the first signed-in sweep still overwrites. Only the startup sweep overwrites: a sweep caused by an install, a settings change, or an account event never replaces channels the person edited, and an entry without the switch keeps the fill-if-empty rule. The write is silent because a refresh is not a pending install, so no `mio-plugin-preset/applied` reload follows it. Turning the switch off in the administration stops the overwrites from the next launch and changes nothing already written.

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

`target` currently accepts `imagegen`, owned by `@q253595422/dsh-imagegen-video`. `policy` only accepts `empty-only`. `values` may contain exact `{{MIO_MODEL_BASE_URL}}` and `{{MIO_API_KEY}}` strings anywhere in its JSON structure; other placeholders and embedded placeholders are refused. The account HTTP provider supplies both values from `/models/config`, and the resolved key is written to plugin settings only because the preset explicitly requests it; the proxy mode for image providers remains future work. The refresh switch is not part of this envelope: it is the plugin record's own `autoRefresh` field, which the catalog endpoint returns beside `packageName` and follows the service's status convention — `'0'` is on and `'1'` is off, with the numeric `0` also on. `mioAccount` reads it, and an absent or unreadable value stays off.

<a id="model-experience"></a>
## Model Experience

### Plugin settings preset

#### What the model sees

Nothing. The `mio-plugin-preset` row registers no prompt content, tools, or Session events; it only writes user-owned plugin settings.

#### Token effect

No token is added.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the `imagegen` target is registered. A new plugin needs an explicit target-to-package entry and a settings schema review.
- The direct `{{MIO_API_KEY}}` mode stores the account key in the plugin's profile configuration, which the imagegen plugin itself documents as plaintext. Prefer a loopback image proxy before production use.
- There is no preset version or migration. A new installation or reinstall replaces the target's user channels with the catalog preset; later startups do not overwrite edits made after that, unless the entry has automatic refresh switched on — each startup replaces those edits too.
- The pending marker is best-effort local state. If the profile home is read-only, a restart-required installation may not be forced after the restart.
- A plugin that requires a restart is retried after the entry becomes active; there is no persistent pending queue across a failed settings service.

<a id="dev-note"></a>
### Dev Note

The refresh switch is a column of the plugin record, not a field of the preset: the administration edits it beside the plugin's status, the catalog endpoint returns it with the entry, and the sweep reads it from the entry. Keeping it out of the preset envelope leaves the `config` object as pure model configuration, so turning automatic overwriting on and off never rewrites the channels an entry ships. `mioAccount` is the only reader of the wire value, and it treats anything but an explicit on as off: a malformed flag leaves local settings alone rather than overwriting them. Only the startup sweep force-overwrites, and only for an entry with the switch on, so an installation, settings, or account event never replaces channels the person edited and an entry that never opted in keeps its own configuration.
