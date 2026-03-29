---
name: run-ingestion
description: Run the full data pipeline to extract evidence and ingest to MongoDB
---

Execute the Summit Deck data pipeline to process GRID events and update MongoDB.

## Quick Reference

### Full Re-ingestion (All Matches)
```bash
cd E:\A-c9-StratOS\Skys-The-Limit-Category-1\data-pipeline\src

# Step 1: Extract evidence from all series (with reprocess flag)
python batch_extract_evidence_v1.py --hot-dir "E:\A-c9-StratOS\grid-cache\hot" --reprocess

# Step 2: Ingest to MongoDB
python ingest_evidence_v1_to_mongo.py
```

### Single Series Extraction (Testing)
```bash
cd E:\A-c9-StratOS\Skys-The-Limit-Category-1\data-pipeline\src

# Extract one series for testing
python extract_evidence_v1.py --series-dir "E:\A-c9-StratOS\grid-cache\hot\2024\tournaments\757073\series\2629390"

# Output will be in data-pipeline/src/out/
```

## Pipeline Steps Explained

### Step 1: batch_extract_evidence_v1.py
**What it does**:
- Scans hot cache directory for all series
- Runs `extract_evidence_v1.py` on each
- Generates `evidence_v1.json` files in each series folder
- Creates batch extraction report

**Key flags**:
- `--hot-dir`: Path to hot cache (default: E:\A-c9-StratOS\grid-cache\hot)
- `--reprocess`: Force re-extraction even if evidence_v1.json exists
- `--max-series N`: Limit to N series (for testing)

**Expected output**:
```
Processing series 1/212: 2629390
  [OK] Extracted 3 games, 68 rounds
Processing series 2/212: 2629391
  ...
Batch complete: 212 series processed, 0 errors
```

### Step 2: ingest_evidence_v1_to_mongo.py
**What it does**:
- Scans hot cache for evidence_v1.json files
- Creates/updates Match documents in MongoDB
- Stores evidence under `analytics.evidence_v1`
- Stores metadata under `analytics.evidence_v1_meta`

**Environment required**:
```bash
set MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/c9-stratos?appName=<app>
```

**Expected output**:
```
Connected to MongoDB
Processing 212 evidence files...
  Updated: 2629390 (Summit vs MIBR)
  Updated: 2629391 (Summit vs NRG)
  ...
Ingestion complete: 212 updated, 0 errors
```

## Validation After Ingestion

Run these checks to verify success:

### 1. Count matches with evidence
```javascript
db.matches.countDocuments({"analytics.evidence_v1": {$exists: true}})
// Expected: 212
```

### 2. Check latest extraction timestamps
```javascript
db.matches.aggregate([
  {$project: {
    opponentName: 1,
    extractedAt: "$analytics.evidence_v1_meta.extractedAt"
  }},
  {$sort: {extractedAt: -1}},
  {$limit: 5}
])
```

### 3. Verify derived stats exist
```javascript
db.matches.findOne({}, {"analytics.evidence_v1.derived": 1})
```

## Troubleshooting

### "No series found in hot cache"
- Verify path: `dir E:\A-c9-StratOS\grid-cache\hot`
- Check subdirectory structure: `{year}\tournaments\{id}\series\{id}\events.jsonl`

### "MongoDB connection failed"
- Check MONGODB_URI environment variable
- Verify network access to MongoDB Atlas
- Test connection: `python -c "from pymongo import MongoClient; print(MongoClient('$MONGODB_URI').server_info())"`

### "Evidence extraction errors"
- Check events.jsonl exists in series folder
- Look for Python errors in console output
- Try single series extraction to isolate issue

### "Type errors after ingestion"
- Run `npm run typecheck` to identify mismatches
- Compare Python output structure with TypeScript EvidenceV1 type
- Update models/Match.ts if schema changed

## Environment Setup

Create a `.env` file or set environment variables:
```bash
# Windows
set MONGODB_URI=mongodb+srv://...
set GRID_HOT_ROOT=E:\A-c9-StratOS\grid-cache\hot

# PowerShell
$env:MONGODB_URI="mongodb+srv://..."
$env:GRID_HOT_ROOT="E:\A-c9-StratOS\grid-cache\hot"
```

## Timing Expectations

| Step | Duration | Notes |
|------|----------|-------|
| Batch extraction (212 series) | ~5 min | CPU-bound, single-threaded |
| MongoDB ingestion | ~2 min | Network-bound |
| Total pipeline | ~7 min | Full re-ingestion |

## Post-Ingestion Tasks

After successful ingestion:
1. Restart Next.js dev server to pick up new data
2. Clear browser cache if seeing stale data
3. Run `/validate-evidence` command to verify completeness

