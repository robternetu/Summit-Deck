# Demo Data Seeding

This directory contains demo match data with pre-extracted evidence_v1 for reproducible testing without requiring raw GRID data.

## Files

- **demo_matches.json**: 2 demo Match documents with complete evidence_v1 data
- **seed_demo.ts**: Script to upsert demo matches into MongoDB

## Usage

### Seed Demo Matches

```bash
# Set MongoDB URI (required)
export MONGODB_URI="mongodb://localhost:27017"

# Or on Windows PowerShell
$env:MONGODB_URI="mongodb://localhost:27017"

# Run seed script
npm run seed:demo
```

The script will:
1. Connect to MongoDB (database: c9-stratos)
2. Upsert 2 demo matches by gridSeriesId
3. Print inserted/updated counts

### Demo Match IDs

The seed includes:

1. **Series 2629390**: Breeze, FURIA vs NRG
   - 23 rounds, 13-10
   - First blood conversion: 85.7% (FURIA), 77.8% (NRG)
   - Plant success: 70% (FURIA), 50% (NRG)

2. **Series 2629391**: Ascent, FURIA vs Sentinels
   - 24 rounds, 13-11
   - First blood conversion: 86.7% (FURIA), 88.9% (Sentinels)
   - Plant success: 75% (FURIA), 62.5% (Sentinels)

## What's Included

Each match document contains:
- Basic match metadata (map, opponent, date)
- Player stats (kills, deaths, KD)
- **analytics.evidence_v1**: Full evidence including:
  - Games metadata
  - Round-by-round data
  - First blood stats
  - Plant/defuse stats
  - Player performance metrics
  - Isolated deaths tracking

## What's NOT Included

- Raw GRID event logs (*.jsonl files)
- Raw end_state.json files
- Any files >100KB

All data is derived and compressed for demo purposes.
