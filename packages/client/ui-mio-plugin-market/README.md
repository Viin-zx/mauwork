---
description: "Plugins page tab listing the mioagent account catalog and installing its bundles through the page's install dialog."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mio-plugin-market

English | [中文](README.zh.md)

## Summary

The browser half contributes a **Plugin market** tab to the Plugins page. It reads the enabled catalog through `remote.mioAccount.listPlugins`, marks packages the profile already declares installed through `remote.pluginManager.listBundles`, and installs a missing package by passing its package name to the page's own `install` action. Installation therefore keeps the page's existing check, progress, cancellation, registry, and restart surfaces. The Host's [`mio-plugin-preset`](../../boot/mio-plugin-preset/README.md) row applies a catalog preset after the bundle is installed; the tab itself never receives raw preset values.

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

- The catalog API has no version, icon, or install spec. Installation uses `packageName` and the page displays `latest`; a pinned version needs a catalog field or a client-side allowlist.
- There is no search or pagination because the client endpoint returns every enabled plugin once.
- Preset application is Host-side and automatic; the tab does not display the apply outcome beyond the plugin's subsequent configuration state.
- The direct account-key preset is a development path. Production image providers need the loopback proxy described in the preset package limitations.
