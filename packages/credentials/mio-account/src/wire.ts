/**
 * Zod validation for every mioagent response this Host consumes. Parsing is
 * the wire boundary: backend data enters typed values here and nowhere else.
 * @module @deepseek-ai/dsh-mio-account/wire
 */

import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {
  MioAccountStatusView, MioAgreement, MioModelCatalogView, MioModelType, MioQuotaView,
  MioSmsCode, MioUser, MioUserId,
} from './types.ts'

/** Universal business response envelope. */
export const envelopeSchema = z.object({
  code: z.number(),
  msg: z.string(),
  data: z.unknown(),
  errorCode: z.string().optional(),
  traceId: z.string().optional(),
})

/** One user projection; a numeric user id is normalized to the documented string form. */
export const userSchema = z.object({
  userId: z.union([z.string(), z.number()]).nullish().transform(value => brandString<MioUserId>(String(value ?? ''))),
  maskedPhone: z.string().nullish().transform(value => value ?? ''),
  nickname: z.string().nullish().transform(value => value ?? ''),
  accountStatus: z.string().nullish().transform(value => value ?? ''),
  credentialStatus: z.string().nullish().transform(value => value ?? ''),
})

/** Successful registration, password login, or SMS login; the user and expiry are optional. */
export const loginSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.string().optional(),
  expiresIn: z.union([z.number().positive(), z.string().regex(/^\d+$/u).transform(Number)])
    .nullish().transform(value => value ?? undefined),
  user: userSchema.nullish().transform(value => value ?? null),
  accountStatus: z.string().nullish(),
})

/** Issued SMS verification code. */
export const smsCodeSchema: z.ZodType<MioSmsCode> = z.object({
  smsRequestId: z.string().min(1),
  retryAfterSeconds: z.number().nonnegative(),
  expiresIn: z.number().nonnegative(),
})

/** Account provisioning progress. */
export const accountStatusSchema: z.ZodType<MioAccountStatusView> = z.object({
  status: z.string().min(1),
  stage: z.string(),
  credentialStatus: z.string().min(1),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().nonnegative(),
})

const modelParametersSchema = z.object({
  contextWindowTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  temperature: z.number().nullable().optional(),
  topP: z.number().nullable().optional(),
  reasoningEffort: z.string().nullable().optional(),
  reasoningEnabled: z.boolean().optional(),
  visionEnabled: z.boolean().optional(),
  functionCallingEnabled: z.boolean().optional(),
  speechRecognitionEnabled: z.boolean().optional(),
})

const modelTypeSchema: z.ZodType<MioModelType> = z.enum([
  'LANGUAGE', 'EMBEDDING', 'RERANK', 'IMAGE', 'VIDEO', 'TTS',
])

const modelSchema = z.object({
  modelId: z.string().min(1),
  // The directory omits display and provider names for some service models.
  displayName: z.string().nullish().transform(value => value ?? ''),
  providerName: z.string().nullish().transform(value => value ?? ''),
  modelType: modelTypeSchema,
  requestTimeoutMs: z.number().nonnegative().nullish().transform(value => value ?? 0),
  isDefault: z.boolean().nullish().transform(value => value ?? false),
  parameters: modelParametersSchema.nullish().transform(value => value ?? {}),
})

/** Model directory snapshot. */
export const modelCatalogSchema: z.ZodType<MioModelCatalogView> = z.object({
  items: z.array(modelSchema),
  fetchedAt: z.string(),
  stale: z.boolean(),
})

/** Host-only model access facts. */
export const modelAccessSchema = z.object({
  baseUrl: z.url(),
  apiKey: z.string().min(1),
  credentialVersion: z.union([z.number(), z.string()]).transform(value => Number(value)),
  expiresAt: z.string(),
})

/** Remaining upstream quota. */
export const quotaSchema: z.ZodType<MioQuotaView> = z.object({
  remainingQuota: z.number(),
  usedQuota: z.number(),
  unit: z.string(),
  fetchedAt: z.string(),
})

/** Agreement documents in the backend's fixed order. */
export const agreementsSchema: z.ZodType<readonly MioAgreement[]> = z.array(z.object({
  agreementType: z.string().min(1),
  title: z.string().optional(),
  content: z.string(),
  version: z.string().optional(),
  updatedAt: z.string().optional(),
}))

/** The one durable session record written under the account's credential key. */
export const storedSessionSchema = z.object({
  version: z.literal(1),
  accessToken: z.string().min(1),
  /** Unix epoch milliseconds; null when the login response carried no expiry. */
  expiresAt: z.number().int().positive().nullable(),
  user: userSchema.nullable(),
})

/** Validated stored session. */
export type StoredSession = z.infer<typeof storedSessionSchema>

/** Validated login payload. */
export type LoginPayload = z.infer<typeof loginSchema>

/** Narrow a parsed user projection to its public type. */
export type ParsedUser = MioUser
