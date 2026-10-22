---
description: "把 mioagent 插件目录中的预设写入尚未被用户配置的插件设置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mio-plugin-preset

[English](README.md) | 中文

## 概述

`mio-plugin-preset` 监听安装和设置变化，通过 `mioAccount` 读取已启用插件目录，并在目标设置项没有用户配置的渠道时写入该条目的预设。目录的 `config` 使用产品约定的 envelope，包含目标和值；Host 在写入前解析账号占位符，因此渲染进程永远拿不到原始预设。写入成功后具备幂等性：下一次扫描看到用户配置的渠道后跳过。目标设置项不存在、插件未启用或占位符无法解析时，预设留待下次扫描，不会导致安装失败。

## 使用此包

在 `mio-account` 旁边挂载：

```yaml
- id: mio-plugin-preset
  name: '@deepseek-ai/dsh-mio-plugin-preset'
```

插件注入 `mioAccount`、`settings` 和 `pluginManager`。它在启动后不久、`plugin-manager/changed` 的 `install` 或 `bundle` 事件后，以及设置文档更新后各扫描一次。每次扫描都会跳过未登录账号、包未安装的目录条目、没有预设的条目，以及已经带有用户渠道、渠道密钥或默认渠道的 imagegen 设置项。

目录的 `config` 使用以下 envelope 时才会被当作预设：

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

`target` 当前只接受 `imagegen`，归属包为 `@q253595422/dsh-imagegen-video`。`policy` 只接受 `empty-only`。`values` 的 JSON 结构中可以出现完整的 `{{MIO_MODEL_BASE_URL}}` 与 `{{MIO_API_KEY}}` 字符串；其他占位符和嵌入文本的占位符会被拒绝。账号 HTTP 提供者从 `/models/config` 取得这两个值；只有在预设明确要求时，解析后的密钥才会写入插件设置；图像提供者的代理模式仍属于后续工作。

## 模型体验

### 插件设置预设

#### What the model sees

无。`mio-plugin-preset` 行不注册提示词、工具或 Session 事件，只写入用户插件设置。

#### Token effect

不增加 token。

#### KV Cache effect

模型请求前缀不发生变化。

## 已知限制与后续工作

- 目前只注册 `imagegen` 目标。新增插件需要显式登记目标到包的映射，并审查其设置 schema。
- 直连 `{{MIO_API_KEY}}` 模式会把账号密钥写入插件的 profile 配置，而 imagegen 插件本身声明该配置为明文保存。正式环境优先改用本机回环图像代理。
- 没有预设版本或迁移。已配置渠道的用户永远不会被覆盖，修改后的预设只影响目标设置仍未配置渠道的用户。
- 需要重启的插件会在设置项重新激活后重试；设置服务失败期间没有跨进程的持久待应用队列。
