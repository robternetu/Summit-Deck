# Team Name Display Fix Report

## Issue Summary
Investigation into team names potentially displaying with "(1)" suffix (e.g., "MIBR (1)" instead of "MIBR").

## Investigation Findings

### 1. Database Analysis
**MongoDB Query Results:**
```json
[
  {"teamNames":["MIBR","SkyLimit","SkyLimit","MIBR","MIBR","SkyLimit"]},
  {"teamNames":["NRG","SkyLimit","SkyLimit","NRG"]},
  {"teamNames":["Leviatán Esports","SkyLimit","Leviatán Esports","SkyLimit"]},
  {"teamNames":["SkyLimit","Evil Geniuses","SkyLimit","Evil Geniuses"]}
]
```

**Finding:** Team names in MongoDB are **already stored without "(1)" suffixes**. The database is clean with names like "MIBR", "NRG", "SkyLimit", etc.

### 2. Code Analysis

#### Existing Normalization Function
File: `lib/teamUtils.ts`
- Already has `normalizeTeamName()` function that removes `\(\d+\)` suffixes
- Includes hardcoded aliases for common cases
- Uses regex pattern to handle any numeric suffix

**Function works correctly:**
```typescript
normalizeTeamName("MIBR (1)") → "MIBR"
normalizeTeamName("LOUD (1)") → "LOUD"
```

#### Where Normalization Was Missing
The normalization function existed but **wasn't being applied consistently** in display components:

1. **EvidencePanel.tsx** - Building teamMap from raw evidence data
2. **Match detail page** - Extracting opponent names from mapsStats
3. **Dashboard page** - Displaying opponent names in recent series

## Fixes Implemented

### 1. EvidencePanel.tsx
**Location:** `components/matches/EvidencePanel.tsx`

**Changes:**
- Added import: `import { normalizeTeamName } from '@/lib/teamUtils'`
- Applied normalization when building teamMap from evidence stats
- Applied normalization in siteStats display (attack/defense team names)

```typescript
// Before
map[stat.teamId] = stat.teamName

// After
map[stat.teamId] = normalizeTeamName(stat.teamName)
```

**Lines affected:**
- Lines 6, 89, 95, 101 (teamMap building)
- Line 440 (attackStat.teamName display)
- Line 463 (defenseStat.teamName display)

### 2. Match Detail Page
**Location:** `app/(main)/matches/[matchId]/page.tsx`

**Changes:**
- Added import: `import { normalizeTeamName } from '@/lib/teamUtils'`
- Normalized opponent name extracted from mapsStats

```typescript
// Before
opponentName = stat.teamName

// After
opponentName = normalizeTeamName(stat.teamName)
```

**Lines affected:** Lines 7, 60

### 3. Dashboard Page
**Location:** `app/(main)/dashboard/page.tsx`

**Changes:**
- Added import: `import { normalizeTeamName } from '@/lib/teamUtils'`
- Normalized opponent names in series results

```typescript
// Before
opponentName = stats.opponent.teamName

// After
opponentName = normalizeTeamName(stats.opponent.teamName)
```

**Lines affected:** Lines 5, 100

### 4. Already Normalized (No Changes Needed)
These files were already using normalization correctly:

- **matches/page.tsx** - Line 53: `const normalizedName = normalizeTeamName(rawOpponentName)`
- **matches/opponent/[opponentName]/page.tsx** - Line 138: `const normalizedOpponent = normalizeTeamName(foundOpponent)`

## Verification

### TypeScript Compilation
```bash
npm run typecheck
✓ No type errors found
```

### Data Flow
1. **Python Extraction** → Team names stored as-is (some may have "(1)")
2. **MongoDB Storage** → Evidence contains raw names
3. **TypeScript API** → Normalizes on read with `normalizeTeamName()`
4. **React UI** → Displays clean names without suffixes

## Coverage Summary

All team name display locations now apply normalization:

| Location | Component | Status |
|----------|-----------|---------|
| Opponent list page | `matches/page.tsx` | ✅ Already normalized |
| Opponent detail page | `matches/opponent/[opponentName]/page.tsx` | ✅ Already normalized |
| Match detail page | `matches/[matchId]/page.tsx` | ✅ **Fixed** |
| Dashboard recent series | `dashboard/page.tsx` | ✅ **Fixed** |
| Evidence panel stats | `EvidencePanel.tsx` | ✅ **Fixed** |
| Site-specific stats | `EvidencePanel.tsx` | ✅ **Fixed** |
| Team logos | `TeamLogo.tsx` | ✅ Receives normalized names |

## Conclusion

**Status: ✅ RESOLVED**

All team name displays in the UI now consistently apply the `normalizeTeamName()` function, ensuring that any "(1)", "(2)", etc. suffixes are removed. Even though the current database data is already clean, this fix provides **defense in depth** against:

1. Future data imports that might contain suffixes
2. External API responses with team name variations
3. Manual data entry errors
4. Edge cases in GRID data format

The normalization layer ensures a consistent user experience regardless of the data source.

## Testing Recommendations

1. ✅ TypeScript compilation - **PASSED**
2. ⚠️ Visual verification - Navigate to:
   - `/matches` - Check opponent names in grid
   - `/matches/opponent/MIBR` - Check opponent detail page header
   - `/matches/[matchId]` - Check match detail opponent name
   - `/dashboard` - Check recent series opponent names
   - Evidence panel stats tables
3. ⚠️ Database query - Confirm all team names display without "(1)" suffixes
4. ⚠️ Edge case testing - If any "(1)" data exists, verify it's normalized

## Files Modified

1. `components/matches/EvidencePanel.tsx`
2. `app/(main)/matches/[matchId]/page.tsx`
3. `app/(main)/dashboard/page.tsx`

## Schema Impact

**No schema changes required.** This is a display-layer fix only. The data contract remains unchanged:
- MongoDB stores team names as-is
- TypeScript types remain the same
- Normalization happens at the presentation layer

