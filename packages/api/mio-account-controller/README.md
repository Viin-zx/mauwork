---
description: "Account screens use authenticated Remote commands and a snapshot stream for the mioagent backend. The controller exposes login state, provisioning progress, models, quota, and agreements without returning the access token or model key."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-mio-account-controller

English | [中文](README.zh.md)

## Summary

Account screens use authenticated Remote commands and a snapshot stream for the mioagent backend. The controller exposes login state, provisioning progress, models, quota, and agreements without returning the access token or model key.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

The `mioAccount` namespace exposes getState, getProfile, sendSmsCode, register, loginWithPassword, loginWithSms, resetPassword, logout, getAccountStatus, retryAccount, getModels, getQuota, getAgreements, watch, and watchExpiry. `watch` emits an initial complete state and subsequent complete states; disconnecting stops observation. `watchExpiry` delivers live credential-expiry notices without an initial item or replay, and a UI uses it to return to the sign-in screen after the Host removes a rejected session.

Every command except getState and the two streams reaches the business backend. Model access, including the resolved endpoint and key, stays Host-only: `llm-mio` reads it from the account service, and no Remote method returns it.

<a id="understand-the-implementation"></a>
## Understand the implementation

The controller forwards operations to the account service and maintains no independent account state. A provider `MioAccountError` becomes a `RemoteError` with code `mio-account/failure`; its `details` carry the stable backend code, HTTP status, and trace identifier, so clients branch on codes such as `SMS_CODE_INVALID` instead of message text. The Typert generator emits the declaration and Remote client artifacts from the decorated methods; the method signatures are the wire vocabulary.

<a id="further-exploration"></a>
## Further Exploration

`@deepseek-ai/dsh-mio-account` owns session persistence and backend requests; `@deepseek-ai/dsh-llm-mio` consumes the same service for model traffic. The [architecture](../../../docs/architecture.md) explains application composition.

<a id="model-experience"></a>
## Model Experience

None, as account credentials affect HTTP authentication and never enter model prompts, Session logs, or tool results.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A disconnected UI can recover account state through watch, but cannot resume a sign-in attempt after the Host exits. Purchase, subscription, order, and account-deletion operations are not exposed.

<a id="dev-note"></a>
### Dev Note

Every provider business failure crosses Remote as `RemoteError('mio-account/failure')` with the stable backend code, HTTP status, and trace identifier in `details`, so UI code branches on codes instead of translating messages. Model access never crosses this namespace.
