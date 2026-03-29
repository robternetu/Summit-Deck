# SkyLimit Command: Complete Stats Display Implementation

## Task
Add UI sections for opening duels, clutch, trade, multi-kill, and ability stats. Investigate cold storage for assists and match dates.

## Files to Read First
```
data-pipeline/src/extract_evidence_v1.py
models/Match.ts
components/matches/EvidencePanel.tsx
F:/grid-archive/2024/tournaments/757073/series/2629390/manifest.json
F:/grid-archive/2024/tournaments/757073/series/2629390/end_state.json (head 200 lines)
```

## MongoDB Verification
```javascript
// Run this first to confirm data exists
db.matches.findOne(
  {"analytics.evidence_v1.derived.openingDuelStats": {$exists: true}},
  {
    "analytics.evidence_v1.derived.openingDuelStats": {$slice: 2},
    "analytics.evidence_v1.derived.clutchStats": {$slice: 2},
    "analytics.evidence_v1.derived.tradeStats": {$slice: 2},
    "analytics.evidence_v1.derived.multiKillStats": {$slice: 2},
    "analytics.evidence_v1.derived.abilityStats": {$slice: 2}
  }
)
```

## Implementation Steps

### Step 1: Add Opening Duel Stats to EvidencePanel.tsx
After Economy Performance section, add:
- Table: Player | Duels | Kills | Deaths | Win Rate | Attack WR | Defense WR
- Filter for SkyLimit (teamId === '79')
- Color code rates: green ≥60%, yellow ≥40%, red <40%

### Step 2: Add Clutch Stats
- Table: Player | Attempts | Wins | Rate | Breakdown (1v1, 1v2, etc.)
- Show breakdown as compact badges

### Step 3: Add Trade Stats
- Table: Player | Deaths | Traded | Untraded | Trade Rate | Trades Given
- High trade rate = green, low = red

### Step 4: Add Multi-Kill Stats
- Table: Player | 2Ks | 3Ks | 4Ks | Aces | Impact Score
- Sort by impact score descending

### Step 5: Add Ability Stats
- Table: Player | Agent | Total Uses | Per Round | Top 3 Abilities
- Show agent icon using AgentImage component

### Step 6: Investigate Cold Storage
Read manifest.json and end_state.json to find:
- startTimeScheduled (for match dates)
- Any assist data in player stats

### Step 7: Create Match Date Script (if needed)
```python
# data-pipeline/src/populate_match_dates.py
# Scan F:/grid-archive and E:/A-c9-StratOS/grid-cache/hot
# For each series with manifest.json, update MongoDB startTime field
```

## Acceptance Criteria
- [ ] All 5 new sections render without errors
- [ ] SkyLimit stats highlighted in blue
- [ ] `npm run typecheck` passes
- [ ] `npm run build` succeeds
- [ ] Report findings on assists from end_state.json
- [ ] Report if ADR data is available in events

## UI Pattern Reference
Follow existing EvidencePanel patterns:
```tsx
{evidence.derived?.statName && evidence.derived.statName.length > 0 && (
  <section className="card backdrop-blur-xl bg-gray-900/70">
    <div className="px-6 py-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-white">Section Title</h2>
      <p className="text-sm text-gray-400 mt-1">Description</p>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full">...</table>
    </div>
  </section>
)}
```

## Constraints
- DO NOT modify Python extraction (stats already computed)
- DO NOT modify MongoDB schema (types already defined)
- DO NOT modify API responses
- ONLY add UI sections to EvidencePanel.tsx
- Preserve all existing functionality

