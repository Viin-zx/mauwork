---
description: "The Host owns mioagent business sessions and resolves the model endpoint and key on demand. Login, registration, account provisioning status, model directory, quota, and agreements stay behind one service; tokens never cross the Remote wire."
kind: "package-reference"
---

# @deepseek-ai/dsh-mio-account

English | [中文](README.zh.md)

`MioAccount` is the Service Definition consumed by the Remote controller and by `llm-mio`. `MioAccountHttp` is the provider that talks to the business backend at `/mio/client/v1`, validates every response envelope and payload with zod, and stores the access token in the credentials seam under `mio-account/session`. The stored grant carries only the token, its expiry, and the display-safe user projection; the model key is never persisted.

The access token authenticates business calls only. Model requests use a separate key from `POST /models/config`, which `getModelAccess` caches for `modelAccessTtlMs` and caps at the server-declared expiry. The cache is discarded on logout, on a rejected token, on a credential-record change, and after a model service rejects the key through `invalidateModelAccess`. Neither credential enters a log, Session event, or Remote result.

## Summary

The Host owns mioagent business sessions and resolves the model endpoint and key on demand. Login, registration, account provisioning status, model directory, quota, and agreements stay behind one service; tokens never cross the Remote wire.

A 401 response on a token-bearing request removes the session and emits `mio-account/session-expired`. The same status for a login request without a token is returned to the caller without touching the current session, so a wrong password cannot sign the user out.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Configure `businessBaseUrl` (default `http://localhost:8080`), `requestTimeoutMs` (default 30,000 ms), and `modelAccessTtlMs` (default 300,000 ms) on the plugin row. `businessBaseUrl` is an HTTP(S) address with an optional path prefix: the client appends `/mio/client/v1` itself and refuses a query, fragment, or embedded credentials.

`getState()` and `watch(signal)` report login presence without network access. `sendSmsCode`, `register`, `loginWithPassword`, `loginWithSms`, and `resetPassword` perform the documented authentication and recovery flows; `sendSmsCode` and `resetPassword` take `authenticated: true` to use the stored token and its bound phone for a password change. A successful login or registration stores the grant before returning the signed-in view, while a successful password reset removes the stored session because the backend revokes its token. `getProfile` refreshes the stored user projection only when the token it read is still current. `getAccountStatus` and `retryAccount` mirror provisioning status into the stored user. `getModels` reads the model directory, `getQuota` reads remaining quota, `getAgreements` reads the agreement documents, and `getPlugins` reads the enabled plugin catalog with its preset config kept inside the Host. `getPlans`, `purchasePlan`, `getOrder`, and `getSubscriptions` carry the purchase and subscription flows; a purchase retry reuses the caller's `requestId` so the backend returns the same order.

Login responses use `expiresIn` seconds; a response without it stores a session with no local expiry. Optional user projections normalize missing fields to empty strings, and an absent user stays null. An expired stored session is removed at the next read, and `mio-account/session-expired` is emitted once. `logout` calls the revocation endpoint before deleting the local record, and a rejection of the token still removes it locally.

<a id="understand-the-implementation"></a>
## Understand the implementation

`MioClient` owns the request deadline, cancellation, envelope parsing, backend `errorCode` propagation, and unauthorized notification. Every response payload is validated against a zod schema before it becomes a typed value. Business failures raise `MioAccountError` with the backend code, HTTP status, and trace identifier when supplied.

The provider accepts only the record kind it writes. A malformed or foreign record is removed from the session key and treated as signed out. Session writes go through `modifyRecord`, so a profile refresh or status update that raced a logout cannot recreate a removed session.

<a id="further-exploration"></a>
## Further Exploration

The [credentials subsystem](../../../docs/subsystems/credentials.md) owns storage APIs; the [architecture](../../../docs/architecture.md) explains application composition. `@deepseek-ai/dsh-api-mio-account-controller` exposes the safe operations over Typert Remote, and `@deepseek-ai/dsh-llm-mio` consumes `getModelAccess` to serve OpenAI-compatible chat completions.

<a id="model-experience"></a>
## Model Experience

None, as business credentials affect HTTP authentication only and never enter model prompts, Session logs, or tool results; the model key serves request authentication and is never logged.

#### KV Cache effect

No model request prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Plans, subscriptions, orders, and account deletion are not implemented. The access token has no refresh flow: an expired or rejected token returns the user to the signed-out state only after the stored record is cleared.
- A model key accepted at resolution is used until the model service rejects it or `modelAccessTtlMs` elapses. Requests already streaming when the key is invalidated finish with the credentials they started with.

<a id="dev-note"></a>
### Dev Note

Access tokens and model keys are deliberately separate credentials: the token authenticates `/mio/client/v1` business calls, the key authenticates only the OpenAI-compatible model endpoint, and neither is written to logs or returned over Remote. The stored grant keeps the token, expiry, and safe user projection under `mio-account/session`; the model key lives in memory only.
