---
description: "把 mioagent 插件目录中的预设写入插件设置，并为每个 profile 安装一次目录默认插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mio-plugin-preset

[English](README.md) | 中文

## 概述

`mio-plugin-preset` 通过 `mioAccount` 读取 mioagent 已启用插件目录，并把条目的预设写入目标插件设置；写入前由 Host 解析账号占位符。被发现为新安装的包始终套用目录预设，覆盖已有的用户渠道；启动和后续事件只为没有用户配置渠道的目标填充，而重新登录或模型凭据变化时只刷新预设管理的渠道密钥和 base URL。后台用 `autoRefresh` 开启的目录条目每 5 分钟重新读取目录并整体覆盖为当前预设，包括用户手工修改的配置。同一次扫描还为每个 profile 安装一次目录默认插件。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在 `mio-account` 旁边挂载这一行，它需要已绑定的 profile：

```yaml
- id: mio-plugin-preset
  name: '@deepseek-ai/dsh-mio-plugin-preset'
  disabled: !!js "!ctx.get('profileContext')"
```

插件注入 `mioAccount`、`settings` 和 `pluginManager`。它在启动后不久、`plugin-manager/changed` 的 `install` 或 `bundle` 事件后，以及设置文档更新后各扫描一次。每次扫描的定时器都在当前 HMR 事务之外创建：插件重载期间设置项发布时，事件是在该事务内发出的，在那里创建的扫描会因子事务嵌套而被拒绝写设置。每次扫描都会跳过未登录账号、包未安装的目录条目、没有预设的条目，以及已经带有用户渠道、渠道密钥或默认渠道的 imagegen 设置项。由 `mio-account/changed` 触发的扫描会刷新已配置目标的受管渠道：只把解析后的 base URL 和 API key 合并进该渠道，用户已删除的渠道不会重建。新出现的包会用 `settings.replace` 强制覆盖；待应用标记在写入前保存，因此需要重启的安装也会在下次启动时强制覆盖。待应用安装会每秒重试一次，最多 20 秒，等待其设置项激活；非敏感失败记录在标记旁的 `last-error.json`。进程内强制安装写入完成且标记清除后，Host 发送 `mio-plugin-preset/applied`，插件市场据此重载一次渲染进程，使插件设置页按新配置重新挂载；启动时加载标记的应用不会触发重载。

同一次扫描还会为从未处理过默认插件的 profile 安装 `DEFAULT_INSTALL_PACKAGES`（`dsh-skill-mcp-panel` 与 `@wxg-prc-cpg/browser-skill-dsh-plugin`）。已经存在的包会记为已处理，之后即使被卸载也不会再装回。安装失败不会记录，下一次登录或进程启动时重试，避免被自身的变更事件触发成循环。一次安装了包默认插件后会发送 `mio-plugin-preset/defaults-installed`，插件市场据此重载渲染进程，加载新的客户端 bundle。

扫描还会每 5 分钟重新读取一次目录，启动后不久也算一次。这一轮定时器扫描会用 `settings.replace` 整体覆盖后台开启了自动同步的条目，因此后台把模型换到新端点之后，用户不必卸载重装就能拿到新配置。只有定时器扫描会覆盖：安装、设置变化或账号事件触发的扫描永远不会替换用户手工编辑的渠道，没有开启开关的条目仍按「为空才填」处理。这类写入静默完成，因为它不是待应用安装，不会发出 `mio-plugin-preset/applied` 重载。后台关闭开关后覆盖停止，已经写入的配置保持不变。

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

`target` 当前只接受 `imagegen`，归属包为 `@q253595422/dsh-imagegen-video`。`policy` 只接受 `empty-only`。`values` 的 JSON 结构中可以出现完整的 `{{MIO_MODEL_BASE_URL}}` 与 `{{MIO_API_KEY}}` 字符串；其他占位符和嵌入文本的占位符会被拒绝。账号 HTTP 提供者从 `/models/config` 取得这两个值；只有在预设明确要求时，解析后的密钥才会写入插件设置；图像提供者的代理模式仍属于后续工作。刷新开关不属于这个 envelope：它是插件记录自身的 `autoRefresh` 字段，目录接口把它和 `packageName` 一起返回，沿用与 status 相同的约定——`'0'` 为开启、`'1'` 为关闭，数字 `0` 也算开启。`mioAccount` 负责读取它，字段缺失或读不懂一律按关闭处理。

<a id="model-experience"></a>
## 模型体验

### 插件设置预设

#### What the model sees

无。`mio-plugin-preset` 行不注册提示词、工具或 Session 事件，只写入用户插件设置。

#### Token effect

不增加 token。

#### KV Cache effect

模型请求前缀不发生变化。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 目前只注册 `imagegen` 目标。新增插件需要显式登记目标到包的映射，并审查其设置 schema。
- 直连 `{{MIO_API_KEY}}` 模式会把账号密钥写入插件的 profile 配置，而 imagegen 插件本身声明该配置为明文保存。正式环境优先改用本机回环图像代理。
- 没有预设版本或迁移。新安装或重装会把目标用户渠道替换为目录预设；之后启动不会覆盖用户在这次安装后做的修改，除非该条目开启了自动同步——每 5 分钟的定时器会连同这些修改一起被覆盖。
- 待应用标记是尽力而为的本地状态。如果 profile home 不可写，需要重启的安装可能无法在重启后强制覆盖。
- 需要重启的插件会在设置项重新激活后重试；设置服务失败期间没有跨进程的持久待应用队列。

<a id="dev-note"></a>
### 开发备注

刷新开关是插件记录的一列，不属于预设：管理后台在插件状态旁边编辑它，目录接口随条目返回，扫描从条目读取。把它放在 preset envelope 之外，`config` 就只剩模型配置，开关自动同步不会改写条目自带的渠道。`mioAccount` 是这个线上值的唯一读取方，除明确开启外一律当作关闭：字段读不懂时保持本机设置不动，而不是覆盖它。只有定时器扫描会强制覆盖，且只覆盖已开启开关的条目，所以安装、设置或账号事件触发的扫描永远不会替换用户手工编辑的渠道，从未开启开关的条目也保留自己的配置。
