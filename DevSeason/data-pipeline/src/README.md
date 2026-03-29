# Python Scripts

This directory contains Python utilities for working with GRID data and Summit Deck.

## Requirements

Install Python dependencies:

```bash
pip install -r requirements.txt
```

Required packages:
- `requests` - HTTP client for API calls
- `python-dotenv` - Environment variable loading

## Scripts

### bulk_download_grid.py

Bulk downloads GRID events and end state files for all series in configured tournaments.

**Usage:**

```bash
# Download first 3 series (recommended on Windows):
npm run grid:download -- 3

# Download all series files to archive:
npm run grid:download

# Direct Python usage with positional arg:
python scripts/py/bulk_download_grid.py 5

# Direct Python usage with flag:
python scripts/py/bulk_download_grid.py --max-series 10 --extract --force
```

**Options:**

- `max_series` - (positional) Maximum number of series to download
- `--extract` - Extract zip files to hot cache directory (default: false)
- `--force` - Re-download files even if they already exist (default: false)
- `--max-series N` - Limit to first N series for testing/debugging (flag form)

**Note:** On Windows with npm, use `--` to pass arguments: `npm run grid:download -- 3`

**Configuration:**

Set these variables in `.env.local`:

```env
GRID_API_KEY=your_api_key_here
GRID_CENTRAL_DATA_URL=https://api-op.grid.gg/central-data/graphql
GRID_FILE_DOWNLOAD_BASE_URL=https://api.grid.gg/file-download
GRID_ARCHIVE_ROOT=F:\GRID-ARCHIVE
GRID_HOT_ROOT=E:\A-C9-STRATOS\grid-cache\hot
GRID_TOURNAMENT_IDS=757371,757481,774782,775516,800675,826660,757614
```

**Output:**

- **Archive:** `F:\GRID-ARCHIVE\{year}\{seriesId}\events.zip` and `end_state.json`
- **Hot cache (if --extract):** `E:\A-C9-STRATOS\grid-cache\hot\{seriesId}\events.jsonl` and `end_state.json`

**Features:**

- Fetches all series for configured tournament IDs using GraphQL pagination
- Downloads events as zip files and end state JSON files
- Safe to rerun - skips existing files unless `--force` is used
- Rate limiting with delays between requests
- Retry logic with exponential backoff for failed requests
- Progress indication during downloads
- Summary statistics at completion

**Example output:**

```
======================================================================
GRID Bulk Downloader
======================================================================

Configuration:
  Central Data URL: https://api-op.grid.gg/central-data/graphql
  File Download Base: https://api.grid.gg/file-download
  Archive Root: F:\GRID-ARCHIVE
  Hot Root: E:\A-C9-STRATOS\grid-cache\hot
  Title ID: 6
  Tournament IDs: 757371, 757481, 774782, 775516, 800675, 826660, 757614
  API Key present: True

Max series limit: 3

Fetching series for 7 tournaments (titleId=6) (max: 3)...

[DEBUG] GraphQL Request:
  Endpoint: https://api-op.grid.gg/central-data/graphql
  Auth token present: True
  Variables: {'first': 50, 'after': None, 'tournamentIds': ['757371', '757481', ...], 'titleId': '6'}

  Page 1: fetched 3 series (total: 3)
  Reached max_series limit of 3
Total series found: 3

Processing 3 series...

[1/3] Series 2653969 (VCT Americas League 2024)
  Downloading events from: https://api.grid.gg/file-download/events/grid/series/2653969
  Progress: 100.0% (1234567/1234567 bytes)
  Downloading end_state from: https://api.grid.gg/file-download/end-state/grid/series/2653969
  Progress: 100.0% (45678/45678 bytes)

...

======================================================================
DOWNLOAD SUMMARY
======================================================================
Total series found:       82
Events downloaded:        78
End states downloaded:    80
Skipped (already exist):  4
Failed:                   0

Archive location: F:\GRID-ARCHIVE
```

### bulk_download_tournament_series.py

Advanced bulk downloader that fetches all series from specified tournaments via GraphQL pagination,
then downloads events.jsonl and end_state.json files with proper rate limiting.

**IMPORTANT:** This script now uses the correct GRID File Download API endpoints:
- File listing: `GET {FILE_DOWNLOAD_BASE}/list/{seriesId}`
- Returns file metadata including `fullURL` for downloading

**Usage (Windows PowerShell):**

```powershell
# SMOKE TEST: Download a single series with debug output (recommended first step):
python scripts/py/bulk_download_tournament_series.py --series-id 2653969 --debug

# Download first 3 series total (for testing):
python scripts/py/bulk_download_tournament_series.py --max-series 3

# Download with limit per tournament:
python scripts/py/bulk_download_tournament_series.py --max-per-tournament 5

# Force re-download existing files:
python scripts/py/bulk_download_tournament_series.py --force

# Keep zip files after extraction:
python scripts/py/bulk_download_tournament_series.py --keep-zip

# Download all series from all tournaments:
python scripts/py/bulk_download_tournament_series.py
```

**Options:**

- `--series-id ID` - **Smoke test mode**: Download a single series by ID (e.g., `--series-id 2653969`)
- `--debug` - **Enable debug logging**: Shows API requests, file listings, and detailed processing info
- `--max-series N` - Limit total series processed across all tournaments (useful for testing)
- `--max-per-tournament N` - Limit series per tournament
- `--force` - Re-download files even if they already exist
- `--keep-zip` - Keep zip files after extraction (by default, zips are deleted after extracting)
- `--extract` - (Deprecated) Zips are now extracted automatically

**Configuration:**

Set these variables in `.env.local`:

```env
GRID_API_KEY=your_api_key_here
GRID_CENTRAL_DATA_URL=https://api-op.grid.gg/central-data/graphql  # optional
GRID_FILE_DOWNLOAD_BASE=https://api.grid.gg/file-download  # optional
GRID_ARCHIVE_ROOT=F:\GRID-ARCHIVE  # optional, defaults to F:\GRID-ARCHIVE
GRID_HOT_ROOT=E:\grid-cache\hot  # optional, defaults to E:\grid-cache\hot
```

**Output Structure:**

```
F:\GRID-ARCHIVE\
  {year}\
    tournaments\
      {tournamentId}\
        series\
          {seriesId}\
            events.jsonl
            end_state.json
            manifest.json
```

**Rate Limiting:**

The script enforces GRID API rate limits:
- **Central Data API**: 20 requests/minute → 3.2 second delay between GraphQL queries
- **File Download API**: 20 requests/minute → 3.2 second delay between downloads
- **File Listing API**: No official limit → 0.2 second delay to be respectful

**Features:**

- **Correct API endpoints**: Uses `/list/{seriesId}` for file listing with proper response parsing
- **Flexible field name handling**: Supports both `fileName`/`filename`, `fullURL`/`fullUrl`/`full_url`
- **Status handling**: Accepts both `"ready"` and `"available"` file status
- **Automatic zip extraction**: Downloads and extracts .zip files to .jsonl/.json automatically
- **Retry logic**: Automatic retry with exponential backoff for rate limit errors (HTTP 429 and ENHANCE_YOUR_CALM)
- **Smoke test mode**: Test with a single series using `--series-id --debug` before bulk downloads
- **Smart file selection**: Prefers files with IDs `events-grid` and `state-grid`, with fallbacks to description and filename patterns
- **Comprehensive logging**: `--debug` shows API calls, file listings, and processing details
- GraphQL pagination to fetch all series in each tournament
- Robust error handling - continues on individual failures, logs all skips and failures
- Skips existing files unless `--force` is specified
- Downloads to temp `.part` files in hot cache, then moves to archive when complete
- Creates `manifest.json` with series metadata and file IDs in each series folder
- Derives year from `startTimeScheduled` for organized folder structure
- Detailed summary statistics: series processed, list failures, downloads attempted/succeeded, skipped counts by reason

**Tournament IDs:**

Currently hardcoded in the script:
```
757073, 757074, 757101, 757234, 757235, 757321, 757628, 757629, 758114,
774784, 774785, 774787, 775518, 800677, 800678, 800680, 826662, 826663, 826992
```

### grid_download.py

Lower-level module for GRID File Download API interactions. Used by `bulk_download_grid.py`.

Functions:
- `list_files(series_id, api_key)` - List available files for a series
- `download_file(url, api_key, out_path)` - Download a file with streaming
- `download_series_files(series_id, out_dir, api_key)` - Download both events and end_state

### rate_limiter.py

Simple rate limiter utility for enforcing minimum delays between API calls.

**Usage:**

```python
from rate_limiter import RateLimiter

# Create limiter with 3.2 second minimum delay
limiter = RateLimiter(3.2, "MyAPI")

# Wait before each API call
limiter.wait()
make_api_call()
```

### Other Scripts

- `metrics.py` - Player metrics calculations
- `mongo_write.py` - MongoDB write utilities
- `parse_events.py` - Event data parsing
