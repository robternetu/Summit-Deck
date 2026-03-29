---
name: add-stat-display
description: Guide for adding a new statistics section to the Evidence Panel UI
---

When adding a new stat section to display in the match detail view, follow this checklist:

## Pre-Implementation Checklist

### 1. Verify Data Exists in MongoDB
```javascript
// Check if the stat exists and has data
db.matches.findOne(
  {"analytics.evidence_v1.derived.<STAT_NAME>": {$exists: true}},
  {"analytics.evidence_v1.derived.<STAT_NAME>": 1}
)

// Check how many matches have this data
db.matches.countDocuments({
  "analytics.evidence_v1.derived.<STAT_NAME>": {$exists: true, $ne: []}
})
```

### 2. Check TypeScript Type Definition
Open `models/Match.ts` and verify the stat is defined in `EvidenceV1.derived`:
```typescript
derived: {
  // ... existing stats
  <statName>?: Array<{
    // field definitions
  }>
}
```

If missing, add the type definition following the Python output structure.

## Implementation Steps

### Step 1: Locate EvidencePanel.tsx
```
components/matches/EvidencePanel.tsx
```

### Step 2: Add the Section
Find the appropriate location (usually after related stats) and add:

```tsx
{/* <Stat Name> Section */}
{evidence.derived?.<statName> && evidence.derived.<statName>.length > 0 && (
  <section className="card backdrop-blur-xl bg-gray-900/70">
    <div className="px-6 py-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-white"><Display Title></h2>
      <p className="text-sm text-gray-400 mt-1"><Brief description></p>
    </div>
    <div className="p-6">
      {/* Content based on data structure - see patterns below */}
    </div>
  </section>
)}
```

### Step 3: Choose Display Pattern

#### Pattern A: Table (for player-level or team-level stats)
```tsx
<div className="overflow-x-auto">
  <table className="w-full">
    <thead>
      <tr className="border-b border-gray-800">
        <th className="py-4 px-6 text-left text-gray-400 font-medium">Column</th>
        {/* More columns */}
      </tr>
    </thead>
    <tbody>
      {evidence.derived.<statName>
        .filter((stat: any) => stat.teamId === '79') // Optional: C9 only
        .map((stat: any) => (
          <tr key={stat.playerId || stat.teamId} className="border-b border-gray-800/50 hover:bg-black/20">
            <td className="py-4 px-6 text-gray-300">{stat.playerName}</td>
            {/* More cells */}
          </tr>
        ))}
    </tbody>
  </table>
</div>
```

#### Pattern B: Grid Cards (for grouped data like sites)
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {evidence.derived.<statName>.map((item: any) => (
    <div key={item.id} className="bg-black/30 rounded-lg p-4 border border-gray-800">
      <div className="text-lg font-semibold text-white mb-2">{item.title}</div>
      {/* Card content */}
    </div>
  ))}
</div>
```

#### Pattern C: Key-Value List (for summary stats)
```tsx
<div className="space-y-3">
  {Object.entries(stat.byCategory).map(([category, data]: [string, any]) => (
    <div key={category} className="flex justify-between items-center">
      <span className="text-gray-400 capitalize">{category.replace('_', ' ')}</span>
      <div className="flex items-center gap-4">
        <span className="text-gray-500">{data.count} items</span>
        <span className={`font-semibold ${data.rate >= 0.5 ? 'text-green-400' : 'text-red-400'}`}>
          {(data.rate * 100).toFixed(0)}%
        </span>
      </div>
    </div>
  ))}
</div>
```

### Step 4: Apply Color Coding
```tsx
// Team highlighting
className={stat.teamId === '79' ? 'text-blue-400' : 'text-gray-400'}

// Performance coloring
className={`font-semibold ${
  rate >= 0.6 ? 'text-green-400' : 
  rate >= 0.4 ? 'text-yellow-400' : 
  'text-red-400'
}`}
```

### Step 5: Filter for Summit (if appropriate)
```tsx
// Show only C9 stats
.filter((stat: any) => stat.teamId === '79')

// Or show C9 first, then opponents
.sort((a: any, b: any) => (a.teamId === '79' ? -1 : 1))
```

## Post-Implementation Checklist

- [ ] Component renders without errors
- [ ] Handles empty/missing data (no crash if undefined)
- [ ] Summit stats highlighted in blue
- [ ] Performance percentages color-coded
- [ ] Table is horizontally scrollable on mobile
- [ ] Section title is descriptive
- [ ] TypeScript has no errors: `npm run typecheck`
- [ ] Build succeeds: `npm run build`

## Example: Adding Clutch Stats

```tsx
{/* Clutch Performance */}
{evidence.derived?.clutchStats && evidence.derived.clutchStats.length > 0 && (
  <section className="card backdrop-blur-xl bg-gray-900/70">
    <div className="px-6 py-4 border-b border-gray-800">
      <h2 className="text-xl font-semibold text-white">Clutch Performance</h2>
      <p className="text-sm text-gray-400 mt-1">1vX situation win rates</p>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-800">
            <th className="py-4 px-6 text-left text-gray-400 font-medium">Player</th>
            <th className="py-4 px-6 text-center text-gray-400 font-medium">Attempts</th>
            <th className="py-4 px-6 text-center text-gray-400 font-medium">Wins</th>
            <th className="py-4 px-6 text-center text-gray-400 font-medium">Rate</th>
          </tr>
        </thead>
        <tbody>
          {evidence.derived.clutchStats
            .filter((stat: any) => stat.teamId === '79')
            .sort((a: any, b: any) => b.clutchAttempts - a.clutchAttempts)
            .map((stat: any) => (
              <tr key={stat.playerId} className="border-b border-gray-800/50 hover:bg-black/20">
                <td className="py-4 px-6 text-blue-400 font-medium">{stat.playerName}</td>
                <td className="py-4 px-6 text-center text-gray-300">{stat.clutchAttempts}</td>
                <td className="py-4 px-6 text-center text-green-400">{stat.clutchWins}</td>
                <td className="py-4 px-6 text-center">
                  <span className={`font-semibold ${stat.clutchRate >= 0.4 ? 'text-green-400' : 'text-yellow-400'}`}>
                    {(stat.clutchRate * 100).toFixed(0)}%
                  </span>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  </section>
)}
```

