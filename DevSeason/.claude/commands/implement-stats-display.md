# Claude Code Prompt: Complete Stats Display Implementation

## Objective
Add UI display sections for all derived statistics that are already computed in the Python pipeline but not yet shown in the frontend. Also investigate cold storage files (manifest.json, end_state.json) for assists data and tournament dates.

---

## Files to Inspect First

**Backend/Data Layer:**
1. `data-pipeline/src/extract_evidence_v1.py` - Verify all stats are being extracted
2. `models/Match.ts` - EvidenceV1 TypeScript types (verify they match Python output)
3. `app/api/coach/match/route.ts` - API endpoint returning evidence data

**Frontend:**
4. `components/matches/EvidencePanel.tsx` - Main component to add sections to

**Cold Storage (investigate for assists/dates):**
5. `F:/grid-archive/2024/tournaments/757073/series/2629390/manifest.json` - Contains `startTimeScheduled`
6. `F:/grid-archive/2024/tournaments/757073/series/2629390/end_state.json` - May contain assists

**MongoDB:**
7. Query `db.matches.findOne({"analytics.evidence_v1": {$exists: true}}, {"analytics.evidence_v1.derived": 1})` to verify data structure

---

## Step Plan

### Phase 1: Data Verification (10 min)
1. Query MongoDB to confirm these derived stats exist and have data:
   - `openingDuelStats` ✓ (in schema)
   - `clutchStats` ✓ (in schema)
   - `tradeStats` + `tradeKills` ✓ (in schema)
   - `multiKillStats` + `multiKillRounds` ✓ (in schema)
   - `abilityStats` ✓ (in schema)

2. Check MongoDB for sample data:
```javascript
db.matches.aggregate([
  {$match: {"analytics.evidence_v1": {$exists: true}}},
  {$project: {
    hasOpening: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.openingDuelStats", []]}}, 0]},
    hasClutch: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.clutchStats", []]}}, 0]},
    hasTrade: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.tradeStats", []]}}, 0]},
    hasMulti: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.multiKillStats", []]}}, 0]},
    hasAbility: {$gt: [{$size: {$ifNull: ["$analytics.evidence_v1.derived.abilityStats", []]}}, 0]}
  }},
  {$limit: 5}
])
```

### Phase 2: Cold Storage Investigation (15 min)
1. Read `manifest.json` - extract `startTimeScheduled` for match dates
2. Read `end_state.json` - search for assist data structure
3. If assists found, plan extraction approach

### Phase 3: Frontend Implementation (45 min)

Add these sections to `EvidencePanel.tsx` after the existing Economy Performance section:

#### 3.1 Opening Duel Stats Section
```tsx
{/* Opening Duel Stats */}
{evidence.derived?.openingDuelStats && evidence.derived.openingDuelStats.length > 0 && (
  <section className="card backdrop-blur-xl bg-gray-900/70">
    <div className="px-6 py-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-white">Opening Duel Performance</h2>
      <p className="text-sm text-gray-400 mt-1">First kill/death of each round</p>
    </div>
    {/* Table showing: Player | Duels | Kills | Deaths | Win Rate | Attack WR | Defense WR */}
  </section>
)}
```

#### 3.2 Clutch Stats Section
```tsx
{/* Clutch Performance */}
{evidence.derived?.clutchStats && evidence.derived.clutchStats.length > 0 && (
  <section className="card backdrop-blur-xl bg-gray-900/70">
    <div className="px-6 py-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-white">Clutch Performance</h2>
      <p className="text-sm text-gray-400 mt-1">1vX situation outcomes</p>
    </div>
    {/* Table showing: Player | Attempts | Wins | Rate | 1v1 | 1v2 | 1v3+ */}
  </section>
)}
```

#### 3.3 Trade Stats Section
```tsx
{/* Trade Efficiency */}
{evidence.derived?.tradeStats && evidence.derived.tradeStats.length > 0 && (
  <section className="card backdrop-blur-xl bg-gray-900/70">
    <div className="px-6 py-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-white">Trade Efficiency</h2>
      <p className="text-sm text-gray-400 mt-1">Death trading within 3 seconds</p>
    </div>
    {/* Table showing: Player | Deaths | Traded | Untraded | Trade Rate | Trades Given */}
  </section>
)}
```

#### 3.4 Multi-Kill Stats Section
```tsx
{/* Multi-Kill Performance */}
{evidence.derived?.multiKillStats && evidence.derived.multiKillStats.length > 0 && (
  <section className="card backdrop-blur-xl bg-gray-900/70">
    <div className="px-6 py-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-white">Multi-Kill Rounds</h2>
      <p className="text-sm text-gray-400 mt-1">2K, 3K, 4K, and Aces</p>
    </div>
    {/* Table showing: Player | 2Ks | 3Ks | 4Ks | Aces | Impact Score */}
  </section>
)}
```

#### 3.5 Ability Stats Section
```tsx
{/* Ability Usage */}
{evidence.derived?.abilityStats && evidence.derived.abilityStats.length > 0 && (
  <section className="card backdrop-blur-xl bg-gray-900/70">
    <div className="px-6 py-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-white">Ability Usage</h2>
      <p className="text-sm text-gray-400 mt-1">Abilities per round by player</p>
    </div>
    {/* Table showing: Player | Agent | Total Uses | Per Round | Top Abilities */}
  </section>
)}
```

### Phase 4: ADR Implementation (20 min)
ADR (Average Damage per Round) requires damage data from events.jsonl.

1. Check if GRID provides damage events:
   - Search events.jsonl for `damage` event types
   - If not available, ADR cannot be computed

2. If damage data exists:
   - Add extraction in `extract_evidence_v1.py`
   - Add to derived stats
   - Add UI section

### Phase 5: Assists & Match Date Script (30 min)
Create Python script to populate match dates and investigate assists:

```python
# data-pipeline/src/populate_match_dates.py
"""
Populate startTime field in MongoDB from manifest.json files.
Also investigate end_state.json for assist data.
"""
```

---

## Acceptance Checks

### Data Verification
- [ ] MongoDB query confirms all 5 stat types have data
- [ ] Sample match shows non-empty arrays for each stat

### UI Implementation
- [ ] Opening Duel section renders with player data
- [ ] Clutch section shows attempts/wins/rate
- [ ] Trade section displays traded/untraded deaths
- [ ] Multi-Kill section shows 2K/3K/4K/Ace counts
- [ ] Ability section shows usage per player
- [ ] All sections filter for Summit (teamId === '79') with blue highlighting
- [ ] Color coding: green ≥60%, yellow ≥40%, red <40%
- [ ] No TypeScript errors: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

### Cold Storage Investigation
- [ ] Document what data manifest.json contains
- [ ] Document what data end_state.json contains
- [ ] Report if assists are available
- [ ] Create script to populate match dates if applicable

---

## Expected Response Shape

After implementation, the EvidencePanel should render these additional sections:

```
[Existing Sections]
- Agent Compositions ✓
- First Blood Stats ✓
- Plant Stats ✓
- Site Performance ✓
- Isolated Deaths ✓
- Economy Performance ✓

[New Sections to Add]
- Opening Duel Performance (NEW)
- Clutch Performance (NEW)
- Trade Efficiency (NEW)
- Multi-Kill Rounds (NEW)
- Ability Usage (NEW)
```

---

## Contract Preservation Checklist

Before completing, verify:
- [ ] `models/Match.ts` EvidenceV1 type unchanged (stats already defined)
- [ ] `/api/coach/match` response shape unchanged
- [ ] Python extraction output unchanged
- [ ] LLM coaching report schema unchanged
- [ ] Only additive changes to frontend

---

## Cold Storage File Structures (Reference)

### manifest.json
```json
{
  "seriesId": "2629390",
  "tournamentId": "757073",
  "tournamentName": "VCT Americas - Kickoff 2024",
  "startTimeScheduled": "2024-02-16T22:00:00Z",  // <-- Match date!
  "teams": [...]
}
```

### end_state.json
(Large file - inspect for player stats including assists)

---

## Execution Order

1. Run MongoDB verification queries
2. Inspect cold storage files for assists
3. Implement UI sections one at a time
4. Test each section renders correctly
5. Run typecheck and build
6. Create match date population script if needed

---

## Notes

- Summit Team ID: `'79'`
- All stats already computed in Python pipeline
- TypeScript types already defined in Match.ts
- UI patterns established in existing EvidencePanel sections
- Follow Evidence → Insight → Recommendation for any coaching additions

