---
description: "Plugins page tab listing the mioagent account catalog and installing its bundles through the page's install dialog."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mio-plugin-market

English | [中文](README.zh.md)

## Summary

The browser half adds a **Plugin market** tab to the Plugins page. It reads the account catalog through `remote.mioAccount.listPlugins`, marks installed packages through `remote.pluginManager.listBundles`, and installs through the page's install dialog. **Update** removes an installed package with a newer registry version and reopens the dialog; **Update all** replaces every such package through the Host's checked `pluginManager.updateBundle`, stopping at the first plugin that needs a restart or script approval. While any installed plugin has a newer version, the tab's label carries a red dot through `plugins.tab.badge`. The Host's [`mio-plugin-preset`](../../boot/mio-plugin-preset/README.md) row applies catalog presets after installation.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

Mount the row in a Web or Desktop profile:

```yaml
- id: ui-mio-plugin-market
  name: '@deepseek-ai/dsh-client-ui-mio-plugin-market'
```

The tab injects `slots`, `locale`, `remote`, `remote.mioAccount`, and `remote.pluginManager`. It registers into `plugins.tab` after the page's own Installed tab, and into `plugins.tab.badge` under the same id so the page can mark that tab. Cards show the catalog name, package name, description, category, and an Auto-configured badge; an installed card opens the bundle's detail page through the page's `openPackage`. Each card carries a pin button: pinned packages lead the grid in the order they were pinned, and that order is kept in this browser's localStorage rather than the account. The header's Update all button lists the pending replacements, with their installed and target versions, before the run starts; the run names its current plugin, and a restart notice stays until the next catalog load. The tab refreshes installed names after `plugin-manager/changed` and reloads the catalog after a connection reset.

<a id="model-experience"></a>
## Model Experience

### Plugin market tab

#### What the model sees

Nothing. The `plugins.tab` contribution lists and installs bundles and registers no prompt content, tools, or Session events.

#### Token effect

No token is added.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The catalog API has no version, icon, or install spec. Installation uses `packageName` and the page displays `latest`; update detection therefore asks `pluginManager.inspect` for each installed package, which needs registry access and may still install an older version when pnpm's `minimumReleaseAge` blocks the newest one. A catalog version field would remove that network check.
- Update all runs the Host's checked update rather than the page's install dialog, so an installation that needs install-script approval stops the run instead of asking; the tab names the plugin and leaves updating it individually. Plugins are replaced one at a time because the Host serializes profile changes.
- There is no search or pagination because the client endpoint returns every enabled plugin once.
- Preset application is Host-side and automatic; the tab does not display the apply outcome beyond the plugin's subsequent configuration state. Because an update removes and reinstalls the package, it also re-applies the catalog preset and replaces the plugin's existing channels.
- The direct account-key preset is a development path. Production image providers need the loopback proxy described in the preset package limitations.

<a id="dev-note"></a>
### Dev Note

The tab never installs on its own: it opens the Plugins page's install dialog, so registry fallback, cancellation, script approval, and the restart notice stay in one place for every install path. Update all differs deliberately: it uses the Host's checked update so a failed replacement restores the installed version, and the run stops rather than opening the dialog in the middle of a queue. Installed state comes from `pluginManager.listBundles`, not from the catalog, because the account endpoint reports no version and no install spec; update detection therefore asks `pluginManager.inspect` with the installed package allowed to answer, and the badge it shows is that comparison rather than the catalog.
