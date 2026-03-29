/**
 * Test Gemini integration for coaching reports
 * 
 * Usage: npx tsx scripts/testGemini.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env.local explicitly
config({ path: resolve(process.cwd(), '.env.local') })

async function main() {
  console.log('='.repeat(60))
  console.log('GEMINI INTEGRATION TEST')
  console.log('='.repeat(60))
  console.log()
  
  // Check environment
  console.log('Environment Check:')
  console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ Set (' + process.env.GEMINI_API_KEY.slice(0, 10) + '...)' : '❌ Not set'}`)
  console.log(`  GEMINI_MODEL: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp (default)'}`)
  console.log(`  COACH_MOCK: ${process.env.COACH_MOCK || 'false (default)'}`)
  console.log()

  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ ERROR: GEMINI_API_KEY not set in .env.local')
    console.log()
    console.log('To fix:')
    console.log('1. Go to https://aistudio.google.com/apikey')
    console.log('2. Create an API key')
    console.log('3. Add to .env.local: GEMINI_API_KEY=your_key_here')
    process.exit(1)
  }

  // Import the LLM client after env is loaded
  const { generateCoachReport } = await import('../lib/ai/llmClient')

  // Test prompt with sample Valorant data
  const testPrompt = `You are an assistant coach for a professional Valorant team.

You are reviewing a match for Summit against LOUD.

Match context:
- Event: VCT Americas 2024
- Map: Lotus
- Final score: 13 - 10 (Summit win)

Player stat lines:
- Demon1: 24/15 (KD 1.60) - Jett
- leaf: 19/14 (KD 1.36) - Omen  
- Zellsis: 18/16 (KD 1.13) - Fade
- vanity: 14/17 (KD 0.82) - Killjoy
- mCe: 12/18 (KD 0.67) - Breach

EVIDENCE (Advanced Metrics):

First Blood Stats:
- Summit: 14 first bloods, 11 rounds won (78.6% conversion)
- LOUD: 9 first bloods, 6 rounds won (66.7% conversion)

Trade Kill Analysis:
- Demon1: 73% of deaths traded (excellent team support)
- mCe: 42% of deaths traded (often caught isolated)

Opening Duel Stats:
- Demon1: 68% opening duel win rate (8/12 on attack, 6/8 on defense)
- vanity: 35% opening duel win rate (struggling)

Multi-Kill Performance:
- Demon1: 2 aces, 3 4Ks (Impact score: 28)
- leaf: 1 4K, 4 3Ks (Impact score: 15)

Economy Stats:
- Summit full buy win rate: 72%
- Summit eco/save win rate: 31%

Guidelines:
- Focus on patterns and actionable insights
- Use the EVIDENCE section to ground your analysis
- Be specific and reference the data

Output format:

## EVIDENCE
- List 3-5 key data points

## INSIGHT  
- 2-4 bullet points analyzing patterns

## RECOMMENDATION
- 3-5 actionable practice items`

  console.log('Sending test prompt to Gemini...')
  console.log()

  try {
    const startTime = Date.now()
    const response = await generateCoachReport(testPrompt)
    const elapsed = Date.now() - startTime

    console.log('='.repeat(60))
    console.log(`RESPONSE (${elapsed}ms)`)
    console.log('='.repeat(60))
    console.log()
    console.log(response)
    console.log()
    console.log('='.repeat(60))
    console.log('✅ TEST PASSED')
    console.log('='.repeat(60))
  } catch (error) {
    console.error('❌ TEST FAILED:', error)
    process.exit(1)
  }
}

main()

