---
description: "mioagent 模型路由通过 pi-ai 的 OpenAI 兼容协议提供用户后端下发的模型。只有账号的开户状态和凭据状态均为就绪时路由才会出现，端点与密钥通过账号服务解析，而不是来自配置。"
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-mio

[English](README.md) | 中文

## 概述

mioagent 模型路由通过 pi-ai 的 OpenAI 兼容协议提供用户后端下发的模型。只有账号的开户状态和凭据状态均为就绪时路由才会出现，端点与密钥通过账号服务解析，而不是来自配置。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

在插件行配置 `provider`（默认 `mio`）和 `displayName`（默认 `mioagent`）。`catalogTtlMs`（默认 60,000ms）限制模型目录的复用时长。仅当账号已登录且 `/account/status` 返回 `status: READY` 与 `credentialStatus: READY` 时，路由才会注册到 LLM 注册表；退登、token 过期或状态离开 `READY` 时会撤销路由，并通过 `llm/adapters-updated` 通知模型选择器。

登录后即通过账号服务读取模型目录，因此开户尚未完成时目录依然可见；模型端点与密钥只在两个状态都就绪后读取。只有 `LANGUAGE` 模型会成为可选项。每次请求使用后端的 `modelId`，并请求返回的 `baseUrl`，去除末尾斜杠以确保 pi-ai 只追加一次 `/chat/completions`。

模型密钥在每次流式调用时从账号服务的有界缓存解析，从不写入配置、Session 事件或日志。模型服务返回被归类为 `AUTH` 的拒绝时，缓存密钥会被丢弃，下一次请求重新解析；如果业务 token 本身被拒绝，账号服务会清除会话，路由随之消失。

<a id="understand-the-implementation"></a>
## 理解实现

`MioAdapter` 继承 pi-ai 适配器，用两个异步输入填充其 profile 映射：模型目录和模型访问记录。账号变化会把 profile 标记为过期；并发的模型操作合并为一次刷新，刷新失败会报告给调用方，而不是替换已发布的路由。

每次模型操作前都会重新读取账号就绪状态。刚被撤销的路由会表现为未知提供者或空模型列表，因此过期的选择器条目无法访问后端已不再授权的模型服务。

<a id="further-exploration"></a>
## 深入探索

`@deepseek-ai/dsh-mio-account` 负责业务会话和模型访问缓存；`@deepseek-ai/dsh-api-mio-account-controller` 暴露账号界面。[架构](../../../docs/architecture.zh.md)说明应用组合。

<a id="model-experience"></a>
## 模型体验

### 模型目录与请求渲染

#### 模型看到的内容

可选模型集合及每个模型的显示名称、上下文窗口、输出能力、文本/图像输入模态均来自业务模型目录。只提供 `LANGUAGE` 条目，请求中的模型名是后端的 `modelId`。系统提示、工具和会话投影沿用共享的 pi-ai 适配器。

#### Token 影响

目录本身不贡献消息或工具 token。每个请求受所选模型由后端声明的上下文窗口和输出上限约束。

#### KV Cache effect

不改变模型请求前缀；路由只提供端点、凭证和模型目录。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 后端上报的推理等级、温度默认值和工具调用能力未映射为请求选项；只有容量和模态进入适配器。不能调用工具的模型仍会提供给 Agent 循环。
- 路由不会轮询开户状态。刚刚就绪的账号会在下一次模型操作或账号变化时可用，而不是由定时器触发。

<a id="dev-note"></a>
### 开发备注

只有账号同时报告两个 `READY` 状态后才发布路由；账号退出或开通状态回退时撤销路由，而不是继续使用过期凭证。业务目录中的 `modelId` 是请求使用的模型名，展示名称从不进入请求。
