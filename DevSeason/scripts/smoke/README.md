# API Smoke Tests

Minimal smoke tests to verify core API functionality after seeding demo data.

## Usage

```bash
# Make sure demo data is seeded first
npm run seed:demo

# Start the dev server
npm run dev

# In another terminal, run smoke tests
npm run smoke

# Or specify a custom base URL
BASE_URL="http://localhost:3000" npm run smoke
```

## What's Tested

1. **GET /api/coach/match?seriesId=<id>**
   - Fetches match by series ID
   - Verifies evidence structure
   - Checks games, rounds, players arrays are non-empty
   - Validates derived stats (first bloods, plants)

2. **POST /api/coach/match (coaching report)**
   - Generates coaching report for a match
   - Verifies EVIDENCE section
   - Verifies INSIGHT section
   - Verifies RECOMMENDATION section

## Exit Codes

- `0`: All tests passed
- `1`: One or more tests failed

## Requirements

- Demo data must be seeded (`npm run seed:demo`)
- Next.js dev server must be running (`npm run dev`)
- MongoDB must be accessible

## Example Output

```
================================================================================
API Smoke Tests
================================================================================
Base URL: http://localhost:3000
Demo Series ID: 2629390

[TEST] GET /api/coach/match?seriesId=<id>
  Fetching: http://localhost:3000/api/coach/match?seriesId=2629390
  Evidence found: 3 rounds, 5 players
  PASS

[TEST] POST /api/coach/match (coaching report)
  Using matchId: 507f1f77bcf86cd799439011
  Posting to: http://localhost:3000/api/coach/match
  Report generated successfully (1247 characters)
  Contains required sections: Evidence, Insight, Recommendation
  PASS

================================================================================
Summary
================================================================================
Total tests: 2
Passed: 2
Failed: 0

All tests passed!
```
