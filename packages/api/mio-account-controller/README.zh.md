---
description: "账号界面通过已认证的 Remote 命令和快照流访问 mioagent 后端。控制器暴露登录状态、开通进度、模型、额度与协议，但不返回访问 token 或模型密钥。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mio-account-controller

[English](README.md) | 中文

## 概述

账号界面通过已认证的 Remote 命令和快照流访问 mioagent 后端。控制器暴露登录状态、开通进度、模型、额度与协议，但不返回访问 token 或模型密钥。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

`mioAccount` 命名空间提供 getState、getProfile、sendSmsCode、register、loginWithPassword、loginWithSms、resetPassword、logout、getAccountStatus、retryAccount、getModels、getQuota、getAgreements、watch 和 watchExpiry。`watch` 先发送完整初始状态，之后发送每次变化的完整状态；断开连接即停止观察。`watchExpiry` 提供实时的凭证过期通知，没有初始项也不重放；界面借此在 Host 删除被拒绝的会话后回到登录页。

除 getState 和两个流之外，每个命令都会访问业务后端。模型访问信息（包括解析出的端点和密钥）仅限 Host：`llm-mio` 从账号服务读取，任何 Remote 方法都不返回它。

<a id="understand-the-implementation"></a>
## 理解实现

控制器把操作转发给账号服务，不维护独立的账号状态。提供方的 `MioAccountError` 会转换成 code 为 `mio-account/failure` 的 `RemoteError`，其 `details` 携带稳定的后端错误码、HTTP 状态和追踪标识，客户端据此分支判断 `SMS_CODE_INVALID` 等错误码而不是匹配文案。Typert 生成器根据装饰过的方法生成声明和 Remote 客户端产物；方法签名就是线缆词汇。

<a id="further-exploration"></a>
## 深入探索

`@deepseek-ai/dsh-mio-account` 负责会话持久化和后端请求；`@deepseek-ai/dsh-llm-mio` 使用同一服务处理模型流量。[架构](../../../docs/architecture.zh.md)说明应用组合。

<a id="model-experience"></a>
## 模型体验

无，因为账号凭证只影响 HTTP 认证，不进入模型提示、Session 日志或工具结果。

#### KV Cache effect

不改变模型请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 断开的界面可以通过 watch 恢复账号状态，但 Host 退出后无法继续登录尝试。未暴露购买、订阅、订单和账号注销操作。

<a id="dev-note"></a>
### 开发备注

提供方的每个业务失败都以 `RemoteError('mio-account/failure')` 跨过 Remote，`details` 携带稳定的后端错误码、HTTP 状态与追踪标识，界面据此按错误码分支而不是翻译文案。模型访问信息从不经过该命名空间。
