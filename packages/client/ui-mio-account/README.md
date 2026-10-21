---
description: "The mioagent login gate blocks the Web and Desktop clients until a business session exists. It renders SMS and password login, agreement documents, password recovery, and the signed-in sidebar launcher over the account Remote namespace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-mio-account

English | [中文](README.zh.md)

This package is the browser half of the mioagent account surface. It registers one full-screen gate on `shell.overlay` and one launcher on `settings.launcher`; the node half is an inert Loader row. The gate subscribes to the account snapshot stream, shows a branded loading surface until the first snapshot arrives, covers the whole application while signed out, and renders nothing once the account is signed in.

The login form offers SMS login (which registers an unknown phone on the backend) and password login. It requests codes for the `LOGIN` and `RESET_PASSWORD` scenes, counts down from `retryAfterSeconds`, requires consent to the User and Privacy agreements, and opens their documents. Business failures keep their stable backend codes, so `SMS_CODE_INVALID` clears the consumed code handle while other failures display the backend message. The launcher shows the nickname (or masked phone) and signs out.

## Summary

The mioagent login gate blocks the Web and Desktop clients until a business session exists. It renders SMS and password login, agreement documents, password recovery, and the signed-in sidebar launcher over the account Remote namespace.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Mount the package in a browser roster beside `@deepseek-ai/dsh-mio-account` and `@deepseek-ai/dsh-api-mio-account-controller`. It injects `slots`, `locale`, `remote`, and `remote.mioAccount`; `dsh.client.inject` lists the packages whose registrations it relies on.

The gate owns Escape and Tab through the shared modal layer while visible, and there is nothing to dismiss: the client is unusable until login succeeds. It also marks every other frame column inert, so the application behind it cannot take pointer or keyboard input. A first snapshot is required before the form appears, so the application never flashes behind an unresolved session. The launcher renders only while signed in.

The Account & balance settings section shows the signed-in profile, quota, and purchased subscriptions, opens the SMS-authorized password-change dialog, and runs the plan purchase flow: purchasable plans, the subscription agreement, a WeChat Native QR code, and order polling until payment completes. Reused purchase retries keep one request id, which persists per plan in browser storage.

Copy lives in the package's `mioAccount` locale dictionaries. Colors, radii, and surfaces come from `--dsw-*` theme tokens, so both themes and the collapsed sidebar rail follow the application.

<a id="understand-the-implementation"></a>
## Understand the implementation

`createMioAccountState` opens the `watch` and `watchExpiry` Remote streams once and shares one snapshot with both registrations. Frames are accepted after publication. An expiry notice marks the session as expired until a signed-in frame clears it; a stream failure keeps the last trusted snapshot because the shared stream owns reconnection.

`createMioAccountOperations` unwraps Remote results and converts the controller's `mio-account/failure` error into `MioAccountClientError`, preserving the backend code for branching. Neither the access token nor the model key can reach this package: the account Remote namespace exposes only safe projections and authentication commands.

<a id="further-exploration"></a>
## Further Exploration

`@deepseek-ai/dsh-mio-account` owns sessions and backend calls; `@deepseek-ai/dsh-api-mio-account-controller` exposes them over Remote; `@deepseek-ai/dsh-llm-mio` consumes the model access facts. The [architecture](../../../docs/architecture.md) explains application composition.

<a id="model-experience"></a>
## Model Experience

None, as the gate and launcher register no prompt content, tool results, or Session events; account credentials affect HTTP authentication only.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Phone numbers use the `+86` dialing prefix and the mainland mobile format.
- SMS login registers unknown numbers on the backend; there is no separate registration page.
- Login allows entry while NewAPI provisioning is still pending, matching the reference client. Model routes appear only after the Host reports both account and credential readiness.
- Plans, purchases, subscriptions, and account deletion are not exposed.

<a id="dev-note"></a>
### Dev Note

The gate waits for the first account snapshot before rendering the form, so the application never appears usable before login resolves. Expiry notifications mark the session until a signed-in snapshot arrives; the form then shows the expired notice rather than treating a timeout as a failed login.
