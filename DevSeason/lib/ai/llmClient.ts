import { GoogleGenerativeAI } from '@google/generative-ai'
import { createHash } from 'crypto'
import { connectToDB } from '@/lib/db'
import { GeminiKeyRotationState, GeminiKeyUsage } from '@/models/GeminiKeyUsage'

const ROTATION_STATE_ID = 'gemini-key-rotation'
const PER_KEY_MINUTE_LIMIT = 4
const PER_KEY_DAY_LIMIT = 19

export const DAILY_QUOTA_REACHED_CODE = 'DAILY_QUOTA_REACHED'

export class DailyQuotaReachedError extends Error {
  code: string

  constructor(message = 'Daily AI request limit reached. Please try again in 24 hours.') {
    super(message)
    this.name = 'DailyQuotaReachedError'
    this.code = DAILY_QUOTA_REACHED_CODE
  }
}

type GeminiPoolKey = {
  apiKey: string
  keyLabel: string
  keyId: string
}

type KeyReservationResult = 'reserved' | 'minute_limit' | 'day_limit'

type RotationExhaustionReason = 'none' | 'minute_limit' | 'day_limit' | 'mixed'

function hashKey(apiKey: string) {
  return createHash('sha256').update(apiKey).digest('hex').slice(0, 16)
}

function getStartOfCurrentMinute(now: Date) {
  const minuteStart = new Date(now)
  minuteStart.setSeconds(0, 0)
  return minuteStart
}

function getStartOfCurrentUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function sameMinute(a: Date, b: Date) {
  return a.getTime() === b.getTime()
}

function sameUtcDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

function getGeminiPoolKeys(): GeminiPoolKey[] {
  const singleKey = process.env.GEMINI_API_KEY || ''
  const extraKeys = (process.env.GEMINI_API_KEYS || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

  const rawKeys = [singleKey.trim(), ...extraKeys].filter(Boolean)
  const deduped = Array.from(new Set(rawKeys))

  return deduped.map((apiKey, index) => ({
    apiKey,
    keyLabel: `key-${index + 1}`,
    keyId: hashKey(apiKey),
  }))
}

async function tryReserveSlotForKey(key: GeminiPoolKey): Promise<KeyReservationResult> {
  const now = new Date()
  const currentMinute = getStartOfCurrentMinute(now)
  const currentUtcDay = getStartOfCurrentUtcDay(now)

  const existing = (await GeminiKeyUsage.findOne({ keyId: key.keyId }).lean()) as {
    minuteWindowStart: Date
    minuteCount: number
    dayWindowStart: Date
    dayCount: number
    totalCount: number
  } | null

  if (!existing) {
    await GeminiKeyUsage.create({
      keyId: key.keyId,
      keyLabel: key.keyLabel,
      minuteWindowStart: currentMinute,
      minuteCount: 1,
      dayWindowStart: currentUtcDay,
      dayCount: 1,
      totalCount: 1,
      lastUsedAt: now,
    })
    return 'reserved'
  }

  const minuteCount = sameMinute(new Date(existing.minuteWindowStart), currentMinute)
    ? existing.minuteCount
    : 0

  const dayCount = sameUtcDay(new Date(existing.dayWindowStart), currentUtcDay)
    ? existing.dayCount
    : 0

  if (dayCount >= PER_KEY_DAY_LIMIT) {
    return 'day_limit'
  }

  if (minuteCount >= PER_KEY_MINUTE_LIMIT) {
    return 'minute_limit'
  }

  await GeminiKeyUsage.findOneAndUpdate(
    { keyId: key.keyId },
    {
      keyLabel: key.keyLabel,
      minuteWindowStart: currentMinute,
      minuteCount: minuteCount + 1,
      dayWindowStart: currentUtcDay,
      dayCount: dayCount + 1,
      totalCount: (existing.totalCount || 0) + 1,
      lastUsedAt: now,
    },
    { new: true }
  )

  return 'reserved'
}

async function reserveNextAvailableGeminiKey(
  excludedKeyIds: Set<string> = new Set()
): Promise<{ key: GeminiPoolKey | null; reason: RotationExhaustionReason }> {
  await connectToDB()

  const keys = getGeminiPoolKeys()
  if (keys.length === 0) {
    return { key: null, reason: 'none' }
  }

  const state = (await GeminiKeyRotationState.findOneAndUpdate(
    { _id: ROTATION_STATE_ID },
    { $setOnInsert: { _id: ROTATION_STATE_ID, nextIndex: 0 } },
    { upsert: true, new: true }
  ).lean()) as { nextIndex: number } | null

  const startIndex = state?.nextIndex ?? 0
  let dayLimitedCount = 0
  let minuteLimitedCount = 0

  for (let i = 0; i < keys.length; i++) {
    const index = (startIndex + i) % keys.length
    const key = keys[index]

    if (excludedKeyIds.has(key.keyId)) {
      continue
    }

    const reserved = await tryReserveSlotForKey(key)
    if (reserved === 'day_limit') {
      dayLimitedCount++
      continue
    }

    if (reserved === 'minute_limit') {
      minuteLimitedCount++
      continue
    }

    await GeminiKeyRotationState.findByIdAndUpdate(ROTATION_STATE_ID, {
      nextIndex: (index + 1) % keys.length,
    })

    return { key, reason: 'none' }
  }

  const totalChecked = Math.max(1, keys.length - excludedKeyIds.size)
  if (dayLimitedCount === totalChecked) {
    return { key: null, reason: 'day_limit' }
  }

  if (minuteLimitedCount === totalChecked) {
    return { key: null, reason: 'minute_limit' }
  }

  if (dayLimitedCount > 0 && minuteLimitedCount > 0) {
    return { key: null, reason: 'mixed' }
  }

  return { key: null, reason: 'none' }
}

function isLikelyQuotaError(error: unknown) {
  const message = String(error || '').toLowerCase()
  return (
    message.includes('quota') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('resource_exhausted')
  )
}

// Model selection - default to gemini-2.5-flash for best balance
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

export async function generateCoachReport(prompt: string): Promise<string> {
  const useMock = process.env.COACH_MOCK === 'true'

  if (useMock) {
    console.log('[LLM] Using mock response (COACH_MOCK=true)')
    return getMockResponse()
  }

  // Check for configured pool keys
  if (getGeminiPoolKeys().length === 0) {
    console.warn('[LLM] No Gemini API keys configured, falling back to mock response')
    return getMockResponse()
  }

  const attemptedKeyIds = new Set<string>()
  const maxAttempts = getGeminiPoolKeys().length

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const reservation = await reserveNextAvailableGeminiKey(attemptedKeyIds)
    const selectedKey = reservation.key

    if (!selectedKey) {
      if (reservation.reason === 'day_limit') {
        throw new DailyQuotaReachedError()
      }

      console.warn('[LLM] All Gemini keys are currently at local safety limits, falling back to mock response')
      return getMockResponse()
    }

    attemptedKeyIds.add(selectedKey.keyId)

    try {
      console.log(`[LLM] Calling Gemini model: ${MODEL_NAME} with ${selectedKey.keyLabel}`)
      const startTime = Date.now()

      const model = new GoogleGenerativeAI(selectedKey.apiKey).getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,  // Increased significantly for full coaching reports
        },
      })

      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()

      const elapsed = Date.now() - startTime
      console.log(`[LLM] Gemini response received in ${elapsed}ms, length: ${text.length} chars`)

      if (!text) {
        console.error('[LLM] Empty response from Gemini')
        continue
      }

      return text
    } catch (error) {
      console.error(`[LLM] Gemini API error on ${selectedKey.keyLabel}:`, error)

      if (!isLikelyQuotaError(error)) {
        continue
      }
    }
  }

  // Fallback to mock on error
  return getMockResponse()
}

// Streaming version for real-time responses (future enhancement)
export async function generateCoachReportStream(
  prompt: string,
  onChunk: (chunk: string) => void
): Promise<string> {
  if (getGeminiPoolKeys().length === 0 || process.env.COACH_MOCK === 'true') {
    const mock = getMockResponse()
    onChunk(mock)
    return mock
  }

  const attemptedKeyIds = new Set<string>()
  const maxAttempts = getGeminiPoolKeys().length

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const reservation = await reserveNextAvailableGeminiKey(attemptedKeyIds)
    const selectedKey = reservation.key

    if (!selectedKey) {
      if (reservation.reason === 'day_limit') {
        throw new DailyQuotaReachedError()
      }

      const mock = getMockResponse()
      onChunk(mock)
      return mock
    }

    attemptedKeyIds.add(selectedKey.keyId)

    try {
      console.log(`[LLM] Streaming from Gemini model: ${MODEL_NAME} with ${selectedKey.keyLabel}`)

      const model = new GoogleGenerativeAI(selectedKey.apiKey).getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      })

      const result = await model.generateContentStream(prompt)

      let fullText = ''
      for await (const chunk of result.stream) {
        const chunkText = chunk.text()
        fullText += chunkText
        onChunk(chunkText)
      }

      return fullText
    } catch (error) {
      console.error(`[LLM] Gemini streaming error on ${selectedKey.keyLabel}:`, error)
      if (!isLikelyQuotaError(error)) {
        continue
      }
    }
  }

  const mock = getMockResponse()
  onChunk(mock)
  return mock
}

function getMockResponse(): string {
  return `## EVIDENCE

• **Rotation timing data** — Defense rotations averaged 4+ seconds after initial contact calls, resulting in 1v2 or 1v3 retake situations in 6 of 13 defensive rounds.

• **Attack-side execute patterns** — The default A-site execute was used in 8 of 12 attack rounds. Opponents began pre-positioning utility by round 15, countering 5 consecutive entries.

• **Trade efficiency metrics** — Entry fragger eliminations were traded within 2 seconds only 40% of the time. Teammates were positioned 15+ meters back during entries, leading to repeated 4v5 situations.

• **Player performance breakdown** — Top performer had 18K/12D (1.50 KD) but 7 deaths in isolated positions. Support players showed inconsistent utility timing on executes.

## INSIGHT

• **Defensive communication breakdown** — Late rotations indicate information is not being shared quickly enough when opponents fake site takes. The team is over-committing to initial contact before confirming enemy positions.

• **Predictability on attack** — Over-reliance on the default A execute has made the team readable. Opponents have identified the timing windows and pre-positioned utility accordingly.

• **Spacing issues impacting trades** — Entry fraggers are dying in positions where teammates cannot follow up. This suggests a coordination gap between the entry player and the second-in.

## RECOMMENDATION

1. **Implement 2-second rotation protocol** — When initial contact is called, one player should rotate immediately while others hold for confirmation. Run retake drills (3v3, 4v4) focusing on staggered utility and trading.

2. **Develop 2-3 execute variations per site** — Create alternative timings and entry points. Assign one player to track which executes have been used and call for variation.

3. **Close entry spacing to 8-10 meters** — Second player should be positioned to trade within 1.5 seconds. Practice entry sequences in custom games with explicit trade responsibilities.

4. **VOD review: 5 closest round losses** — Identify decision points where different rotations or execute calls could have changed outcomes. Focus on communication timestamps.`
}
