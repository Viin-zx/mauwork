---
description: "mioagent 登录门禁在业务会话存在前阻止 Web 与 Desktop 客户端使用。它提供短信与密码登录、协议文档、找回密码，以及侧栏中已登录状态的账号入口，全部经由账号 Remote 命名空间。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mio-account

[English](README.md) | 中文

本包是 mioagent 账号界面的浏览器半边。它在 `shell.overlay` 注册一个全屏门禁，在 `settings.launcher` 注册一个账号入口；Node 半边只是占位的 Loader 行。门禁订阅账号快照流：首个快照到达前显示带品牌的加载界面，未登录时覆盖整个应用，登录后不渲染任何内容。

登录表单提供短信登录（后端会为未知手机号自动注册）与密码登录。验证码按 `LOGIN` 和 `RESET_PASSWORD` 场景申请，按 `retryAfterSeconds` 倒计时；提交前必须同意用户协议与隐私协议，并可打开协议正文。业务失败保留稳定的后端错误码，因此 `SMS_CODE_INVALID` 会作废已使用的验证码句柄，其他失败直接展示后端消息。账号入口显示昵称（或脱敏手机号）并提供退出登录；退出成功后重载渲染层，插件自行挂载的页面不会存活到会话之后，客户端直接回到登录界面。已登录的修改密码成功后同样使会话失效并重载到登录界面。

## 概述

mioagent 登录门禁在业务会话存在前阻止 Web 与 Desktop 客户端使用。它提供短信与密码登录、协议文档、找回密码，以及侧栏中已登录状态的账号入口，全部经由账号 Remote 命名空间。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用此包

在浏览器插件清单中与 `@deepseek-ai/dsh-mio-account`、`@deepseek-ai/dsh-api-mio-account-controller` 一同挂载。它注入 `slots`、`locale`、`remote` 和 `remote.mioAccount`；`dsh.client.inject` 列出了它依赖其注册的包。

门禁显示期间通过共享模态层独占 Escape 与 Tab，且没有可关闭的入口：登录成功前客户端不可用。它还会把框架中的其他列设为 inert，应用无法获得指针或键盘输入。表单必须等到首个快照才出现，应用不会在会话状态未知时闪现。账号入口仅在已登录时渲染。

文案位于本包的 `mioAccount` 语言字典。颜色、圆角和表面使用 `--dsw-*` 主题令牌，因此明暗主题与折叠侧栏都会跟随应用。

<a id="understand-the-implementation"></a>
## 理解实现

`createMioAccountState` 只打开一次 `watch` 与 `watchExpiry` Remote 流，并把同一份快照共享给两个注册入口。帧在发布后才被接受。过期通知会把会话标记为已过期，直到收到已登录帧才清除；流失败时保留最后一个可信快照，因为共享流层负责重连。

`createMioAccountOperations` 解包 Remote 结果，并把控制器的 `mio-account/failure` 错误转换为 `MioAccountClientError`，保留后端错误码供分支判断。访问 token 与模型密钥都无法到达本包：账号 Remote 命名空间只暴露安全投影和认证命令。

<a id="further-exploration"></a>
## 进一步探索

`@deepseek-ai/dsh-mio-account` 负责会话与后端调用；`@deepseek-ai/dsh-api-mio-account-controller` 通过 Remote 暴露它们；`@deepseek-ai/dsh-llm-mio` 消费模型访问信息。[架构](../../../docs/architecture.zh.md)说明应用组合方式。

<a id="model-experience"></a>
## 模型体验

无，因为门禁与账号入口不注册提示词内容、工具结果或 Session 事件；账号凭证只影响 HTTP 认证。

#### KV Cache 影响

模型请求前缀不变。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 手机号使用 `+86` 区号与大陆手机号格式。
- 短信登录由后端为未知号码自动注册，没有独立注册页。
- 与参考客户端一致，NewAPI 开户尚未完成时也允许进入应用；只有 Host 同时报告账号与凭证就绪后，模型路由才会出现。
- 套餐、购买、订阅与注销账号尚未暴露。

<a id="dev-note"></a>
### 开发备注

门禁等待首个账号快照后才渲染表单，应用不会在登录状态解析完成前显得可用。过期通知会把会话标记为过期，直到收到已登录快照；表单随后展示过期提示，而不是把超时当作登录失败。
