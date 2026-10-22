---
description: "Host 持有 mioagent 业务会话，并按需解析模型端点与密钥。登录、注册、账号开通状态、模型目录、额度与协议都封装在一个服务之后；token 不经过 Remote 线缆。"
kind: "package-reference"
---

# @deepseek-ai/dsh-mio-account

[English](README.md) | 中文

`MioAccount` 是由 Remote 控制器和 `llm-mio` 使用的服务定义。`MioAccountHttp` 是与业务后端 `/mio/client/v1` 通信的提供者：它用 zod 校验每个响应信封和载荷，并把访问 token 以 `mio-account/session` 为键存入凭证接缝。存储的授权只包含 token、过期时间和可展示的用户投影；模型密钥从不持久化。

访问 token 只用于业务调用。模型请求使用来自 `POST /models/config` 的独立密钥，`getModelAccess` 会将其缓存 `modelAccessTtlMs`，并以服务端声明的过期时间封顶。退登、token 被拒绝、凭证记录变化，以及模型服务拒绝密钥后调用 `invalidateModelAccess` 时，缓存都会被丢弃。两种凭证都不会进入日志、Session 事件或 Remote 结果。

## 概述

Host 持有 mioagent 业务会话，并按需解析模型端点与密钥。登录、注册、账号开通状态、模型目录、额度与协议都封装在一个服务之后；token 不经过 Remote 线缆。

携带 token 的请求返回 401 时，提供者删除会话并发送 `mio-account/session-expired`。不带 token 的登录请求得到相同的状态码时，失败原样返回给调用方，当前会话不受影响，因此密码错误不会让用户退出登录。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

在插件行配置 `businessBaseUrl`（默认 `http://localhost:8080`）、`requestTimeoutMs`（默认 30,000ms）和 `modelAccessTtlMs`（默认 300,000ms）。`businessBaseUrl` 是带可选路径前缀的 HTTP(S) 地址：客户端自行追加 `/mio/client/v1`，配置中的查询、片段或内嵌凭证都会被拒绝。

`getState()` 和 `watch(signal)` 无需网络即可报告登录状态。`sendSmsCode`、`register`、`loginWithPassword`、`loginWithSms` 和 `resetPassword` 执行文档定义的认证与找回流程；`sendSmsCode` 与 `resetPassword` 接受 `authenticated: true`，改用存储的 token 及其绑定手机号完成修改密码。登录或注册成功后，先存储授权再返回已登录视图；密码重置成功后删除存储的会话，因为后端会撤销其 token。`getProfile` 仅在读取到的 token 仍是当前 token 时更新存储的用户投影。`getAccountStatus` 和 `retryAccount` 把开通状态写回存储的用户。`getModels` 读取模型目录，`getQuota` 读取剩余额度，`getAgreements` 读取协议文档，`getPlugins` 读取已启用插件目录，其预设配置只保留在 Host 内。

登录响应使用以秒为单位的 `expiresIn`；响应未携带时保存无本地过期时间的会话。可选的用户信息中缺失字段会归一化为空字符串，缺少用户对象时保持 null。过期的存储会话会在下一次读取时删除，并发送一次 `mio-account/session-expired`。`logout` 先调用撤销端点，再删除本地记录；即使 token 被拒绝，本地记录仍会被删除。

<a id="understand-the-implementation"></a>
## 理解实现

`MioClient` 负责请求截止时间、取消、信封解析、后端 `errorCode` 传播和未授权通知。每个响应载荷在成为类型化值前都经过 zod schema 校验。业务失败抛出 `MioAccountError`，携带后端代码、HTTP 状态和（若有）跟踪标识。

提供者只接受自己写入的记录类型。格式错误或来自其他插件的记录会从会话键中删除，并按未登录处理。会话写入经过 `modifyRecord`，因此与退登竞态的刷新资料或更新状态不会重建已删除的会话。

<a id="further-exploration"></a>
## 深入探索

[凭证子系统](../../../docs/subsystems/credentials.zh.md)定义存储接口；[架构](../../../docs/architecture.zh.md)说明应用组合。`@deepseek-ai/dsh-api-mio-account-controller` 通过 Typert Remote 暴露安全的操作，`@deepseek-ai/dsh-llm-mio` 使用 `getModelAccess` 提供 OpenAI 兼容的 chat completions。

<a id="model-experience"></a>
## 模型体验

无，因为业务凭证只影响 HTTP 认证，从不进入模型提示词、Session 日志或工具结果；模型密钥仅用于请求认证且从不记录日志。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 未实现套餐、订阅、订单和账号注销。访问 token 没有刷新流程：过期或被拒绝的 token 在清除存储记录后，使用户回到未登录状态。
- 解析成功的模型密钥会一直使用，直到模型服务拒绝它或 `modelAccessTtlMs` 到期。密钥失效时已在流式传输的请求会用其启动时的凭证完成。

<a id="dev-note"></a>
### 开发备注

访问 token 与模型密钥是刻意分离的两种凭证：token 只认证 `/mio/client/v1` 业务调用，密钥只认证 OpenAI 兼容模型端点，两者都不写入日志，也不经过 Remote 返回。存储的授权在 `mio-account/session` 下保留 token、过期时间和安全用户投影；模型密钥只存在于内存。
