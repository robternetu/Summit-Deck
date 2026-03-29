/**
 * Test full coaching report with real match data
 * 
 * Usage: npx tsx scripts/testCoachReport.ts
 */
import { config } from 'dotenv'
import { resolve } from 'path'
import mongoose from 'mongoose'

// Load .env.local explicitly FIRST before any other imports
const result = config({ path: resolve(process.cwd(), '.env.local') })
console.log('Dotenv loaded:', result.parsed ? Object.keys(result.parsed).length + ' variables' : 'FAILED')

async function main() {
  console.log('='.repeat(70))
  console.log('FULL COACHING REPORT TEST - REAL MATCH DATA')
  console.log('='.repeat(70))
  console.log()

  // Debug env vars
  console.log('Environment Variables:')
  console.log(`  GEMINI_API_KEY: ${process.env.GEMINI_API_KEY ? '✅ ' + process.env.GEMINI_API_KEY.slice(0, 15) + '...' : '❌ NOT SET'}`)
  console.log(`  GEMINI_MODEL: ${process.env.GEMINI_MODEL || '(default)'}`)
  console.log(`  COACH_MOCK: ${process.env.COACH_MOCK}`)
  console.log(`  MONGODB_URI: ${process.env.MONGODB_URI ? '✅ Set' : '❌ NOT SET'}`)
  console.log()

  // Connect to MongoDB
  console.log('Connecting to MongoDB...')
  await mongoose.connect(process.env.MONGODB_URI!)
  console.log('✅ Connected to MongoDB')
  console.log()

  // Import after env is loaded
  const { Match } = await import('../models/Match')
  const { computeMatchAnalytics } = await import('../lib/analytics/computeMatchAnalytics')
  const { generateCoachingReport } = await import('../lib/ai/coach')

  // First, let's see what we have
  const count = await Match.countDocuments({})
  console.log(`Total matches in database: ${count}`)

  // Find ANY match first
  const match = await Match.findOne({}).lean() as any

  if (!match) {
    console.error('❌ No matches found in database at all!')
    await mongoose.disconnect()
    process.exit(1)
  }

  console.log()
  console.log('Match Found:')
  console.log(`  ID: ${match._id}`)
  console.log(`  Series: ${match.gridSeriesId}`)
  console.log(`  Map: ${match.map}`)
  console.log(`  Opponent: ${match.opponentName}`)
  console.log(`  Event: ${match.eventName}`)
  console.log(`  Has analytics: ${!!match.analytics}`)
  console.log(`  Has evidence_v1: ${!!match.analytics?.evidence_v1}`)
  console.log()

  // Check evidence
  const evidence = match.analytics?.evidence_v1 || null
  if (evidence) {
    console.log('Evidence Available:')
    console.log(`  Rounds: ${evidence.rounds?.length || 0}`)
    console.log(`  Kills: ${evidence.kills?.length || 0}`)
    console.log(`  Clutches: ${evidence.clutchSituations?.length || 0}`)
    console.log(`  Ability Uses: ${evidence.abilityUses?.length || 0}`)
    console.log(`  Trade Stats: ${evidence.derived?.tradeStats?.length || 0}`)
    console.log(`  Multi-Kill Stats: ${evidence.derived?.multiKillStats?.length || 0}`)
    console.log(`  Opening Duel Stats: ${evidence.derived?.openingDuelStats?.length || 0}`)
    console.log()
  } else {
    console.log('⚠️ No evidence_v1 data found in this match')
    console.log()
  }

  // Compute analytics
  console.log('Computing match analytics...')
  let analytics
  try {
    analytics = computeMatchAnalytics(match as any)
    console.log(`  Team: ${analytics.teamName}`)
    console.log(`  Score: ${analytics.teamRoundsWon} - ${analytics.teamRoundsLost}`)
    console.log(`  Players: ${analytics.players.length}`)
    console.log()
  } catch (err) {
    console.error('Failed to compute analytics:', err)
    await mongoose.disconnect()
    process.exit(1)
  }

  // Generate report
  console.log('Generating coaching report with Gemini...')
  console.log('(This should take 2-5 seconds if using real API)')
  console.log()
  
  const startTime = Date.now()
  const report = await generateCoachingReport(analytics, evidence)
  const elapsed = Date.now() - startTime

  // Check if it's likely mock or real
  const likelyMock = elapsed < 500
  if (likelyMock) {
    console.log('⚠️  WARNING: Response was very fast - likely using MOCK response!')
    console.log('    Check that COACH_MOCK=false and GEMINI_API_KEY is set')
    console.log()
  }

  console.log('='.repeat(70))
  console.log(`COACHING REPORT (Generated in ${elapsed}ms)${likelyMock ? ' [LIKELY MOCK]' : ' [REAL GEMINI]'}`)
  console.log('='.repeat(70))
  console.log()
  console.log(report)
  console.log()
  console.log('='.repeat(70))
  if (likelyMock) {
    console.log('⚠️  TEST COMPLETED BUT USED MOCK - Check env vars!')
  } else {
    console.log('✅ FULL TEST PASSED - Gemini coaching report generated!')
  }
  console.log('='.repeat(70))

  await mongoose.disconnect()
}

main().catch(err => {
  console.error('Test failed:', err)
  mongoose.disconnect()
  process.exit(1)
})
