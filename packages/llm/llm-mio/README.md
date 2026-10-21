---
description: "The mioagent model route serves the user's backend-provided models through pi-ai's OpenAI-compatible protocol. The route appears only while the account reports both provisioning and credential status ready, and its endpoint and key are resolved through the account service instead of configuration."
kind: "package-reference"
---

# @deepseek-ai/dsh-llm-mio

English | [中文](README.zh.md)

## Summary

The mioagent model route serves the user's backend-provided models through pi-ai's OpenAI-compatible protocol. The route appears only while the account reports both provisioning and credential status ready, and its endpoint and key are resolved through the account service instead of configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

Configure `provider` (default `mio`), `displayName` (default `mioagent`), `catalogTtlMs` (default 60,000 ms), and `provisioningRetryMs` (default 5,000 ms) on the plugin row. `autoSelectDefaultModel` (default true) repoints the agent default at the backend-declared default chat model (the first published one when none is declared) whenever the stored selection names another provider or a model the backend no longer serves. The route is registered with the LLM registry only when the account is signed in and `/account/status` reports `status: READY` and `credentialStatus: READY`; signing out, an expired token, or a status leaving `READY` withdraws it and notifies model selectors through `llm/adapters-updated`. While a signed-in account is still provisioning, the adapter re-reads `/account/status` every `provisioningRetryMs` and publishes the route as soon as both statuses become ready.

The model directory is read through the account service after login, so it is available even while provisioning is still pending; the model endpoint and key are read only after both statuses are ready. Only `LANGUAGE` models become selectable. Each request names the backend's `modelId` and posts to the returned `baseUrl`, with the trailing slash removed so pi-ai appends `/chat/completions` exactly once.

The model key is resolved for every stream call from the account service's bounded cache. It is never written to configuration, Session events, or logs. A model service rejection classified as `AUTH` discards that cached key so the next request resolves a new one; if the business token itself is rejected, the account service clears the session and the route disappears.

<a id="understand-the-implementation"></a>
## Understand the implementation

`MioAdapter` subclasses the pi-ai adapter and fills its profile map from two asynchronous inputs: the model directory and the model-access record. Account changes mark the profile stale; concurrent model operations coalesce on one refresh, and a failed refresh is reported to its callers rather than replacing the last published route.

Account readiness is re-read before every model operation. A route that has just been withdrawn is reported as an unknown provider or an empty model list, so a stale picker entry cannot reach a model service the backend no longer authorizes.

<a id="further-exploration"></a>
## Further Exploration

`@deepseek-ai/dsh-mio-account` owns the business session and model-access cache; `@deepseek-ai/dsh-api-mio-account-controller` exposes account screens. The [architecture](../../../docs/architecture.md) explains application composition.

<a id="model-experience"></a>
## Model Experience

### Model catalog and request rendering

#### What the model sees

The selectable model set and each model's display name, context window, output capability, and text/image input modalities come from the business model directory. Only `LANGUAGE` entries are offered, and request model names are the backend's `modelId` values. System prompts, tools, and transcript projection follow the shared pi-ai adapter.

#### Token effect

The catalog contributes no message or tool tokens. Each request is bounded by the selected model's backend-declared context window and output limit.

#### KV Cache effect

No model request prefix changes; the route only supplies the endpoint, credential, and model catalog.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Reasoning levels, temperature defaults, and tool-calling capability reported by the backend are not mapped into request options; only capacities and modalities reach the adapter. A model that cannot call tools is still offered to the agent loop.
- The default-model policy commits through the configuration editor. A deployment without a profile entry keeps its composed default selection.

<a id="dev-note"></a>
### Dev Note

The route is published only after the account reports both `READY` statuses; when the account signs out or provisioning regresses, the route is withdrawn instead of serving stale credentials. `modelId` from the business catalog is the wire model name; display names never reach requests.
