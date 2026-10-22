---
description: "Plugins page tab listing the mioagent account catalog and installing its bundles through the page's install dialog."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mio-plugin-market

English | [中文](README.zh.md)

## Summary

The browser half contributes a **Plugin market** tab to the Plugins page. It reads the account catalog through `remote.mioAccount.listPlugins`, marks installed packages through `remote.pluginManager.listBundles`, and installs through the page's own install dialog. It checks registry versions with `pluginManager.inspect` and offers **Update** when newer, removing the package before reopening the dialog. The Host's [`mio-plugin-preset`](../../boot/mio-plugin-preset/README.md) row applies catalog presets after installation; the tab never receives raw preset values.

## Use this package

Mount the row in a Web or Desktop profile:

```yaml
- id: ui-mio-plugin-market
  name: '@deepseek-ai/dsh-client-ui-mio-plugin-market'
```

The tab injects `slots`, `locale`, `remote`, `remote.mioAccount`, and `remote.pluginManager`. It registers into `plugins.tab` after the page's own Installed tab. Cards show the catalog name, package name, description, category, and an Auto-configured badge; an installed card opens the bundle's detail page through the page's `openPackage`. The tab refreshes installed names after `plugin-manager/changed` and reloads the catalog after a connection reset.

## Model Experience

### Plugin market tab

#### What the model sees

Nothing. The `plugins.tab` contribution lists and installs bundles and registers no prompt content, tools, or Session events.

#### Token effect

No token is added.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

- The catalog API has no version, icon, or install spec. Installation uses `packageName` and the page displays `latest`; update detection therefore asks `pluginManager.inspect` for each installed package, which needs registry access and may still install an older version when pnpm's `minimumReleaseAge` blocks the newest one. A catalog version field would remove that network check.
- There is no search or pagination because the client endpoint returns every enabled plugin once.
- Preset application is Host-side and automatic; the tab does not display the apply outcome beyond the plugin's subsequent configuration state.
- The direct account-key preset is a development path. Production image providers need the loopback proxy described in the preset package limitations.
