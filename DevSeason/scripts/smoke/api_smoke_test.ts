/**
 * API smoke test
 *
 * Tests core API endpoints with demo data
 *
 * Usage:
 *   BASE_URL="http://localhost:3000" npx tsx scripts/smoke/api_smoke_test.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000'
const DEMO_SERIES_ID = '2629390'

interface TestResult {
  name: string
  passed: boolean
  error?: string
}

const results: TestResult[] = []

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertExists(value: any, fieldName: string) {
  assert(value !== null && value !== undefined, `${fieldName} should exist`)
}

function assertNonEmpty(array: any[], fieldName: string) {
  assertExists(array, fieldName)
  assert(Array.isArray(array), `${fieldName} should be an array`)
  assert(array.length > 0, `${fieldName} should not be empty`)
}

async function test(name: string, fn: () => Promise<void>) {
  console.log(`\n[TEST] ${name}`)
  try {
    await fn()
    results.push({ name, passed: true })
    console.log(`  PASS`)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    results.push({ name, passed: false, error: errorMessage })
    console.log(`  FAIL: ${errorMessage}`)
  }
}

async function testGetMatchBySeriesId() {
  const url = `${BASE_URL}/api/coach/match?seriesId=${DEMO_SERIES_ID}`
  console.log(`  Fetching: ${url}`)

  const response = await fetch(url)
  assert(response.ok, `Expected 200, got ${response.status}`)

  const data = await response.json()

  // Assert structure
  assertExists(data.matchId, 'matchId')
  assertExists(data.meta, 'meta')
  assertExists(data.evidence, 'evidence')

  // Assert evidence structure
  assertExists(data.evidence.meta, 'evidence.meta')
  assertNonEmpty(data.evidence.games, 'evidence.games')
  assertNonEmpty(data.evidence.rounds, 'evidence.rounds')
  assertNonEmpty(data.evidence.players, 'evidence.players')

  // Assert derived stats
  assertExists(data.evidence.derived, 'evidence.derived')
  assertNonEmpty(data.evidence.derived.firstBloodStats, 'evidence.derived.firstBloodStats')
  assertNonEmpty(data.evidence.derived.plantStats, 'evidence.derived.plantStats')

  console.log(`  Evidence found: ${data.evidence.rounds.length} rounds, ${data.evidence.players.length} players`)
}

async function testCoachingReport() {
  // First get the match to get the matchId
  const matchResponse = await fetch(`${BASE_URL}/api/coach/match?seriesId=${DEMO_SERIES_ID}`)
  assert(matchResponse.ok, `Expected 200, got ${matchResponse.status}`)
  const matchData = await matchResponse.json()
  const matchId = matchData.matchId

  console.log(`  Using matchId: ${matchId}`)

  // Generate coaching report
  const reportUrl = `${BASE_URL}/api/coach/match`
  console.log(`  Posting to: ${reportUrl}`)

  const reportResponse = await fetch(reportUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId }),
  })

  assert(reportResponse.ok, `Expected 200, got ${reportResponse.status}`)

  const reportData = await reportResponse.json()
  assertExists(reportData.report, 'report')

  const report = reportData.report

  // Assert Evidence-Insight-Recommendation structure
  assert(
    report.includes('EVIDENCE') || report.includes('Evidence'),
    'Report should contain EVIDENCE section'
  )
  assert(
    report.includes('INSIGHT') || report.includes('Insight'),
    'Report should contain INSIGHT section'
  )
  assert(
    report.includes('RECOMMENDATION') || report.includes('Recommendation'),
    'Report should contain RECOMMENDATION section'
  )

  console.log(`  Report generated successfully (${report.length} characters)`)
  console.log(`  Contains required sections: Evidence, Insight, Recommendation`)
}

async function runSmokeTests() {
  console.log('=' .repeat(80))
  console.log('API Smoke Tests')
  console.log('=' .repeat(80))
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`Demo Series ID: ${DEMO_SERIES_ID}`)

  await test('GET /api/coach/match?seriesId=<id>', testGetMatchBySeriesId)
  await test('POST /api/coach/match (coaching report)', testCoachingReport)

  console.log('\n' + '='.repeat(80))
  console.log('Summary')
  console.log('='.repeat(80))

  const passedCount = results.filter((r) => r.passed).length
  const failedCount = results.filter((r) => !r.passed).length

  console.log(`Total tests: ${results.length}`)
  console.log(`Passed: ${passedCount}`)
  console.log(`Failed: ${failedCount}`)

  if (failedCount > 0) {
    console.log('\nFailed tests:')
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  - ${r.name}: ${r.error}`)
      })
    process.exit(1)
  } else {
    console.log('\nAll tests passed!')
    process.exit(0)
  }
}

runSmokeTests().catch((error) => {
  console.error('Smoke test error:', error)
  process.exit(1)
})
