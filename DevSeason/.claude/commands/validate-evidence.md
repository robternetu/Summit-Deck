---
name: validate-evidence
description: Validate evidence extraction and MongoDB ingestion status
---

Run the following validation checks for Summit Deck evidence data:

## 1. MongoDB Connection & Count
Query the total number of matches with evidence:
```javascript
db.matches.countDocuments({"analytics.evidence_v1": {$exists: true}})
```
Expected: 200+ matches

## 2. Check Derived Stats Presence
Verify all derived stat types are populated:
```javascript
db.matches.aggregate([
  {$project: {
    hasSiteStats: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.siteStats", []]}}, 0]},
    hasEconomyStats: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.economyStats", []]}}, 0]},
    hasClutchStats: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.clutchStats", []]}}, 0]},
    hasTradeStats: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.tradeStats", []]}}, 0]},
    hasOpeningDuelStats: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.openingDuelStats", []]}}, 0]},
    hasMultiKillStats: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.multiKillStats", []]}}, 0]},
    hasAbilityStats: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.abilityStats", []]}}, 0]}
  }},
  {$limit: 5}
])
```
Expected: All fields should be `true`

## 3. Check Match Dates
Verify startTime population:
```javascript
db.matches.countDocuments({startTime: {$exists: true, $ne: null}})
```
Note: If 0, match dates still need to be populated from manifest.json

## 4. Sample Evidence Structure
Fetch one complete evidence document to verify schema:
```javascript
db.matches.findOne(
  {"analytics.evidence_v1": {$exists: true}},
  {"analytics.evidence_v1.meta": 1, "analytics.evidence_v1.games": 1, "analytics.evidence_v1.derived": 1}
)
```

## 5. TypeScript Validation
```bash
cd E:\A-c9-StratOS\Skys-The-Limit-Category-1
npm run typecheck
```
Expected: No errors related to EvidenceV1 types

## 6. Build Validation
```bash
npm run build
```
Expected: Build succeeds without type errors

## Report Format

Summarize findings as:

| Check | Status | Details |
|-------|--------|---------|
| Total matches with evidence | ✅/❌ | X/212 |
| Derived stats present | ✅/❌ | List any missing |
| Match dates populated | ✅/❌ | X/212 |
| TypeScript types valid | ✅/❌ | Error count |
| Build succeeds | ✅/❌ | Error count |

## If Issues Found

1. **Missing derived stats**: Re-run extraction with `--reprocess` flag
2. **Missing match dates**: Run date population script from manifest.json
3. **Type errors**: Check models/Match.ts EvidenceV1 type matches Python output
4. **Build errors**: Fix component type issues before proceeding

