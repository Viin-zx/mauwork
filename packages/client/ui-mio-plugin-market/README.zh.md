---
description: "插件页中的 mioagent 账号插件市场标签页，通过页面自带的安装对话框安装插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mio-plugin-market

[English](README.md) | 中文

## 概述

浏览器半边在插件页增加一个 **插件市场** 标签页。它通过 `remote.mioAccount.listPlugins` 读取已启用目录，通过 `remote.pluginManager.listBundles` 标记 profile 已声明安装的包，并把缺失包名交给页面自己的 `install` 动作完成安装。对已安装的包，它通过 `pluginManager.inspect` 查询注册表版本，发现更高版本时显示 **更新**；更新会先移除当前包，再按发现的版本重新打开页面的安装对话框。因此安装继续复用页面现有的检查、进度、取消、注册表和重启提示。安装完成后由 Host 侧的 [`mio-plugin-preset`](../../boot/mio-plugin-preset/README.zh.md) 行应用目录预设；标签页本身不接触原始预设值。

## 使用此包

在 Web 或 Desktop profile 中挂载：

```yaml
- id: ui-mio-plugin-market
  name: '@deepseek-ai/dsh-client-ui-mio-plugin-market'
```

标签页注入 `slots`、`locale`、`remote`、`remote.mioAccount` 和 `remote.pluginManager`，注册到 `plugins.tab` 中页面自带 Installed 标签之后。卡片展示目录名称、包名、描述、分类和“自动配置”标记；已安装卡片通过页面的 `openPackage` 打开插件详情。`plugin-manager/changed` 后刷新已安装包名，连接重置后重新读取目录。

## 模型体验

### 插件市场标签页

#### What the model sees

无。`plugins.tab` 贡献只列出和安装插件，不注册提示词、工具或 Session 事件。

#### Token effect

不增加 token。

#### KV Cache effect

模型请求前缀不发生变化。

## 已知限制与后续工作

- 目录接口没有版本、图标或安装源字段。安装使用 `packageName`，页面显示 `latest`；因此更新检测会对每个已安装包调用 `pluginManager.inspect`，需要注册表访问，而且 pnpm 的 `minimumReleaseAge` 拦截最新版时仍可能装入较旧版本。目录补一个版本字段即可省去这次网络检查。
- 客户端接口一次返回全部启用插件，因此没有搜索和分页。
- 预设由 Host 自动应用；标签页除插件后续配置状态外，不展示应用结果。
- 直连账号密钥预设只是开发路径。正式环境的图像提供者需要预设包限制中描述的本机回环代理。
