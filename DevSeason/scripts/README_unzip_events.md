# GRID Event Archive Extractor

## Overview

`scripts/py/unzip_events_to_hot.py` extracts GRID event archives from cold storage (`F:\grid-archive`) to a hot cache (`E:\grid-cache\hot`) for faster processing.

**Location:** `scripts/py/unzip_events_to_hot.py`

**Configuration:** Uses `.env.local` for default paths (GRID_ARCHIVE_ROOT, GRID_HOT_ROOT)

## Features

- ✅ Recursively finds all event archives (events.jsonl, events.zip, events*.zip)
- ✅ Detects ZIP files by magic bytes (not extension)
- ✅ Extracts inner *.jsonl files from ZIP containers
- ✅ Preserves directory structure: `2024/tournaments/<id>/series/<id>/events.jsonl`
- ✅ Skips existing files (checks size)
- ✅ Creates extraction manifest at `E:\grid-cache\hot\manifest_extracted.json`
- ✅ Handles corrupted ZIPs gracefully
- ✅ Dry-run mode for testing

## Usage

### Basic Usage

```powershell
# Uses .env.local automatically (GRID_ARCHIVE_ROOT, GRID_HOT_ROOT)
python scripts/py/unzip_events_to_hot.py

# Or specify paths explicitly (overrides .env.local)
python scripts/py/unzip_events_to_hot.py --archive-root "F:\grid-archive" --hot-root "E:\grid-cache\hot"
```

### Dry Run (Test Mode)

```powershell
# Test with first 5 files (no actual extraction)
python scripts/py/unzip_events_to_hot.py --dry-run --max 5
```

### Force Overwrite

```powershell
# Re-extract even if files exist
python scripts/py/unzip_events_to_hot.py --force
```

### Limited Extraction

```powershell
# Process only first 10 files
python scripts/py/unzip_events_to_hot.py --max 10
```

## Command-Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--archive-root PATH` | Archive root directory | `GRID_ARCHIVE_ROOT` env var |
| `--hot-root PATH` | Hot cache root directory | `GRID_HOT_ROOT` env var |
| `--force` | Force overwrite existing files | `False` |
| `--dry-run` | Simulate without writing files | `False` |
| `--max N` | Process maximum N files | Unlimited |

## Manifest Format

The script creates `manifest_extracted.json` with the following structure:

```json
[
  {
    "tournamentId": "757073",
    "seriesId": "2629390",
    "srcPath": "F:\\grid-archive\\2024\\tournaments\\757073\\series\\2629390\\events.jsonl",
    "dstPath": "E:\\grid-cache\\hot\\2024\\tournaments\\757073\\series\\2629390\\events.jsonl",
    "bytes": 57569901,
    "status": "extracted|copied|skipped|error",
    "error": null
  }
]
```

## Status Values

- `extracted` - File was extracted from ZIP
- `copied` - File was already .jsonl and copied
- `skipped` - Destination already exists (not forced)
- `error` - Extraction failed (see error field)

## ZIP Detection

The script detects ZIP files by checking for magic bytes `PK\x03\x04` at the start of the file, not by file extension. This correctly handles:

- `events.jsonl` files that are actually ZIP containers
- `events.zip` files
- Already-extracted `.jsonl` files (copied as-is)

## Error Handling

- Corrupted ZIP files are logged as errors and processing continues
- Missing source files are logged as errors
- Extraction errors are captured in the manifest

## .gitignore

The following patterns are added to `.gitignore` to prevent accidental commits:

```
grid-cache/
grid-archive/
*.jsonl
manifest_extracted.json
```

**Note:** The main cache (`E:\grid-cache\hot`) is outside the repository, so it won't be committed regardless.

## Examples

### Full Workflow

```powershell
# 1. Test with dry run
python scripts/py/unzip_events_to_hot.py --dry-run --max 5

# 2. Extract first 100 files
python scripts/py/unzip_events_to_hot.py --max 100

# 3. Check manifest
Get-Content E:\grid-cache\hot\manifest_extracted.json | ConvertFrom-Json | Format-Table

# 4. Extract remaining files
python scripts/py/unzip_events_to_hot.py
```

### Re-running After Errors

If the script encounters errors, just re-run it. It will skip successfully extracted files and retry failed ones:

```powershell
# Re-run to process failed files
python scripts/py/unzip_events_to_hot.py
```

## Performance

- Typical extraction rate: ~50-100 MB/s (depends on disk speed)
- Memory usage: Minimal (streams files, doesn't load into memory)
- Large archives (100+ GB): 10-20 minutes
