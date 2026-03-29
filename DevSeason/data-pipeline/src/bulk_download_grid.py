#!/usr/bin/env python3
"""
Bulk download GRID events and end state files for all series in allowed tournaments.

Usage:
    # Download first 3 series (positional arg - recommended for npm on Windows):
    npm run grid:download -- 3

    # Download with flags:
    python scripts/py/bulk_download_grid.py --max-series 3 --extract --force

    # Download all series in tournaments:
    npm run grid:download
"""

import os
import sys
import argparse
import time
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

# Configuration from environment
GRID_API_KEY = os.getenv('GRID_API_KEY')
GRID_CENTRAL_DATA_URL = os.getenv('GRID_CENTRAL_DATA_URL', 'https://api-op.grid.gg/central-data/graphql')
GRID_FILE_DOWNLOAD_BASE_URL = os.getenv('GRID_FILE_DOWNLOAD_BASE_URL', 'https://api.grid.gg/file-download')
GRID_ARCHIVE_ROOT = os.getenv('GRID_ARCHIVE_ROOT', 'F:\\GRID-ARCHIVE')
GRID_HOT_ROOT = os.getenv('GRID_HOT_ROOT', 'E:\\A-C9-STRATOS\\grid-cache\\hot')
GRID_TOURNAMENT_IDS_STR = os.getenv('GRID_TOURNAMENT_IDS', '757371,757481,774782,775516,800675,826660,757614')
GRID_TITLE_ID = os.getenv('GRID_TITLE_ID', '6')  # Valorant by default

# Parse tournament IDs
GRID_TOURNAMENT_IDS = [tid.strip() for tid in GRID_TOURNAMENT_IDS_STR.split(',') if tid.strip()]

# Request settings
REQUEST_DELAY = 0.5  # seconds between requests to avoid rate limits
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2  # seconds


def validate_config():
    """Validate required configuration is present."""
    if not GRID_API_KEY:
        print("ERROR: GRID_API_KEY not set in .env.local")
        sys.exit(1)

    print(f"Configuration:")
    print(f"  Central Data URL: {GRID_CENTRAL_DATA_URL}")
    print(f"  File Download Base: {GRID_FILE_DOWNLOAD_BASE_URL}")
    print(f"  Archive Root: {GRID_ARCHIVE_ROOT}")
    print(f"  Hot Root: {GRID_HOT_ROOT}")
    if GRID_TITLE_ID:
        print(f"  Title ID: {GRID_TITLE_ID}")
    print(f"  Tournament IDs: {', '.join(GRID_TOURNAMENT_IDS)}")
    print(f"  API Key present: {GRID_API_KEY is not None and len(GRID_API_KEY) > 0}")
    print()


def graphql_request(query: str, variables: Dict, debug: bool = False) -> Dict:
    """Make a GraphQL request with retry logic and detailed error reporting."""
    headers = {
        'Content-Type': 'application/json',
        'x-api-key': GRID_API_KEY
    }

    if debug:
        print(f"\n[DEBUG] GraphQL Request:")
        print(f"  Endpoint: {GRID_CENTRAL_DATA_URL}")
        print(f"  Auth token present: {GRID_API_KEY is not None and len(GRID_API_KEY) > 0}")
        print(f"  Variables: {variables}")

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(
                GRID_CENTRAL_DATA_URL,
                json={'query': query, 'variables': variables},
                headers=headers,
                timeout=30
            )
            response.raise_for_status()

            json_data = response.json()

            # Check for GraphQL errors and report them clearly
            if 'errors' in json_data and json_data['errors']:
                print("\n❌ GraphQL Error Response:")
                print(f"  Endpoint: {GRID_CENTRAL_DATA_URL}")
                print(f"  Auth token present: {GRID_API_KEY is not None}")
                for i, error in enumerate(json_data['errors'], 1):
                    print(f"  Error {i}: {error.get('message', 'Unknown error')}")
                    if 'extensions' in error:
                        print(f"    Extensions: {error['extensions']}")
                raise Exception(f"GraphQL errors: {[e.get('message') for e in json_data['errors']]}")

            if 'data' not in json_data:
                print("\n❌ GraphQL Response Missing Data Field:")
                print(f"  Endpoint: {GRID_CENTRAL_DATA_URL}")
                print(f"  Response keys: {list(json_data.keys())}")
                raise Exception("GraphQL response missing data field")

            return json_data['data']

        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                print(f"  Request failed, retrying in {delay}s... ({e})")
                time.sleep(delay)
            else:
                print(f"\n❌ HTTP Request Failed:")
                print(f"  Endpoint: {GRID_CENTRAL_DATA_URL}")
                print(f"  Error: {e}")
                raise


def fetch_series_ids_for_tournaments(tournament_ids: List[str], title_id: Optional[str] = None, max_series: Optional[int] = None) -> List[Dict]:
    """
    Fetch all series for given tournament IDs using pagination.

    Args:
        tournament_ids: List of tournament ID strings
        title_id: Optional title ID filter (e.g., "6" for Valorant)
        max_series: Optional limit on total series to fetch

    Returns list of series objects with id, tournamentId, startTimeScheduled.
    """
    # Build filter based on what's provided
    if title_id:
        query = """
        query FetchSeriesForTournaments($first: Int!, $after: Cursor, $tournamentIds: [ID!]!, $titleId: ID!) {
          allSeries(
            first: $first
            after: $after
            filter: {
              tournamentIds: { in: $tournamentIds }
              titleIds: { in: [$titleId] }
            }
            orderBy: StartTimeScheduled
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                startTimeScheduled
                tournament {
                  id
                  name
                }
              }
            }
          }
        }
        """
    else:
        query = """
        query FetchSeriesForTournaments($first: Int!, $after: Cursor, $tournamentIds: [ID!]!) {
          allSeries(
            first: $first
            after: $after
            filter: { tournamentIds: { in: $tournamentIds } }
            orderBy: StartTimeScheduled
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            edges {
              node {
                id
                startTimeScheduled
                tournament {
                  id
                  name
                }
              }
            }
          }
        }
        """

    all_series = []
    after = None
    page = 0

    filter_desc = f"{len(tournament_ids)} tournaments"
    if title_id:
        filter_desc += f" (titleId={title_id})"
    if max_series:
        filter_desc += f" (max: {max_series})"

    print(f"Fetching series for {filter_desc}...")

    while True:
        # Build variables
        variables = {
            'first': 50,
            'after': after,
            'tournamentIds': tournament_ids
        }
        if title_id:
            variables['titleId'] = title_id

        # Debug first request
        debug = (page == 0)
        data = graphql_request(query, variables, debug=debug)
        all_series_data = data['allSeries']

        edges = all_series_data['edges']
        page_info = all_series_data['pageInfo']

        for edge in edges:
            node = edge['node']
            all_series.append({
                'id': node['id'],
                'tournamentId': node['tournament']['id'] if node.get('tournament') else '',
                'tournamentName': node['tournament']['name'] if node.get('tournament') else 'Unknown',
                'startTimeScheduled': node.get('startTimeScheduled')
            })

            # Stop if we've reached max_series
            if max_series and len(all_series) >= max_series:
                break

        page += 1
        print(f"  Page {page}: fetched {len(edges)} series (total: {len(all_series)})")

        # Stop if max reached or no more pages
        if max_series and len(all_series) >= max_series:
            print(f"  Reached max_series limit of {max_series}")
            break

        if not page_info['hasNextPage'] or not page_info.get('endCursor'):
            break

        after = page_info['endCursor']
        time.sleep(REQUEST_DELAY)

    print(f"Total series found: {len(all_series)}\n")
    return all_series


def list_files(series_id: str) -> Dict:
    """List available files for a series using the File Download API."""
    url = f"{GRID_FILE_DOWNLOAD_BASE_URL}/list/{series_id}"
    headers = {'x-api-key': GRID_API_KEY}

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                time.sleep(delay)
            else:
                raise


def download_file_with_progress(url: str, out_path: str) -> bool:
    """Download a file with progress indication."""
    headers = {'x-api-key': GRID_API_KEY}

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, headers=headers, stream=True, timeout=120)
            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))

            os.makedirs(os.path.dirname(out_path), exist_ok=True)

            downloaded = 0
            with open(out_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)

                        if total_size > 0:
                            percent = (downloaded / total_size) * 100
                            print(f"\r  Progress: {percent:.1f}% ({downloaded}/{total_size} bytes)", end='', flush=True)

            print()  # New line after progress
            return True

        except requests.exceptions.RequestException as e:
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_BASE_DELAY * (2 ** attempt)
                print(f"\n  Download failed, retrying in {delay}s... ({e})")
                time.sleep(delay)
            else:
                print(f"\n  Download failed after {MAX_RETRIES} attempts: {e}")
                return False


def extract_zip_to_hot(zip_path: str, series_id: str) -> bool:
    """Extract events.jsonl from zip to hot cache."""
    try:
        hot_dir = os.path.join(GRID_HOT_ROOT, series_id)
        os.makedirs(hot_dir, exist_ok=True)

        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            # Extract all files to hot directory
            zip_ref.extractall(hot_dir)

        print(f"  Extracted to: {hot_dir}")
        return True
    except Exception as e:
        print(f"  Extraction failed: {e}")
        return False


def get_year_from_series(series: Dict) -> str:
    """Extract year from series start time, default to current year."""
    if series.get('startTimeScheduled'):
        try:
            dt = datetime.fromisoformat(series['startTimeScheduled'].replace('Z', '+00:00'))
            return str(dt.year)
        except:
            pass
    return str(datetime.now().year)


def download_series_files(series: Dict, force: bool, extract: bool) -> Tuple[bool, bool]:
    """
    Download events and end_state files for a series.

    Returns (events_downloaded, end_state_downloaded).
    """
    series_id = series['id']
    year = get_year_from_series(series)

    # Archive paths
    archive_dir = os.path.join(GRID_ARCHIVE_ROOT, year, series_id)
    events_archive_path = os.path.join(archive_dir, 'events.zip')
    end_state_archive_path = os.path.join(archive_dir, 'end_state.json')

    events_downloaded = False
    end_state_downloaded = False

    # Check if files already exist
    events_exists = os.path.exists(events_archive_path)
    end_state_exists = os.path.exists(end_state_archive_path)

    if not force and events_exists and end_state_exists:
        print(f"  Both files exist, skipping (use --force to re-download)")
        return (False, False)

    # List available files
    try:
        file_list = list_files(series_id)
    except Exception as e:
        print(f"  Failed to list files: {e}")
        return (False, False)

    files = file_list.get('files', [])

    # Find events and end-state files
    events_file = None
    end_state_file = None

    for file_entry in files:
        file_id = file_entry.get('id', '')
        if file_id == 'events-grid' or 'events' in file_id.lower():
            events_file = file_entry
        elif file_id == 'end-state-grid' or 'end-state' in file_id.lower() or 'endstate' in file_id.lower():
            end_state_file = file_entry

    # Download events
    if events_file and (force or not events_exists):
        events_url = events_file.get('fullURL')
        if events_url:
            print(f"  Downloading events from: {events_url}")
            if download_file_with_progress(events_url, events_archive_path):
                events_downloaded = True

                # Extract if requested
                if extract:
                    extract_zip_to_hot(events_archive_path, series_id)
    elif not events_file:
        print(f"  No events file found")

    # Download end state
    if end_state_file and (force or not end_state_exists):
        end_state_url = end_state_file.get('fullURL')
        if end_state_url:
            print(f"  Downloading end_state from: {end_state_url}")
            if download_file_with_progress(end_state_url, end_state_archive_path):
                end_state_downloaded = True

                # Copy to hot cache if extract is enabled
                if extract:
                    hot_dir = os.path.join(GRID_HOT_ROOT, series_id)
                    os.makedirs(hot_dir, exist_ok=True)
                    hot_end_state_path = os.path.join(hot_dir, 'end_state.json')

                    import shutil
                    shutil.copy2(end_state_archive_path, hot_end_state_path)
                    print(f"  Copied to hot cache: {hot_end_state_path}")
    elif not end_state_file:
        print(f"  No end_state file found")

    time.sleep(REQUEST_DELAY)  # Rate limiting

    return (events_downloaded, end_state_downloaded)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Bulk download GRID events and end state files for tournament series.',
        epilog='Examples:\n'
               '  npm run grid:download -- 3          # Download first 3 series\n'
               '  python %(prog)s --max-series 5      # Download first 5 series\n'
               '  python %(prog)s --extract --force   # Download all, extract, and force re-download',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        'max_series',
        nargs='?',
        type=int,
        help='Maximum number of series to download (positional, recommended for npm)'
    )
    parser.add_argument(
        '--extract',
        action='store_true',
        help='Extract downloaded zip files to hot cache'
    )
    parser.add_argument(
        '--force',
        action='store_true',
        help='Re-download files even if they already exist'
    )
    parser.add_argument(
        '--max-series',
        type=int,
        dest='max_series_flag',
        help='Maximum number of series to process (flag form)'
    )

    args = parser.parse_args()

    # Resolve max_series from: positional arg > --max-series flag > MAX_SERIES env > None
    max_series = args.max_series or args.max_series_flag
    if max_series is None:
        max_series_env = os.getenv('MAX_SERIES')
        if max_series_env:
            try:
                max_series = int(max_series_env)
            except ValueError:
                pass

    print("=" * 70)
    print("GRID Bulk Downloader")
    print("=" * 70)
    print()

    validate_config()

    if max_series:
        print(f"Max series limit: {max_series}\n")
    else:
        print("Max series limit: None (downloading all)\n")

    # Fetch series with optional titleId filter
    all_series = fetch_series_ids_for_tournaments(
        GRID_TOURNAMENT_IDS,
        title_id=GRID_TITLE_ID if GRID_TITLE_ID else None,
        max_series=max_series
    )

    if not all_series:
        print("No series found for configured tournaments.")
        print("\nTroubleshooting:")
        print("  - Check that GRID_TOURNAMENT_IDS contains valid tournament IDs")
        print("  - Verify GRID_API_KEY is correct")
        print("  - Check GraphQL errors above for details")
        return

    # Download counters
    total_series = len(all_series)
    events_downloaded = 0
    end_state_downloaded = 0
    skipped = 0
    failed = 0

    print(f"Processing {total_series} series...\n")

    for i, series in enumerate(all_series, 1):
        series_id = series['id']
        tournament_name = series.get('tournamentName', 'Unknown')

        print(f"[{i}/{total_series}] Series {series_id} ({tournament_name})")

        try:
            events_dl, end_state_dl = download_series_files(series, args.force, args.extract)

            if events_dl:
                events_downloaded += 1
            if end_state_dl:
                end_state_downloaded += 1
            if not events_dl and not end_state_dl:
                skipped += 1

        except Exception as e:
            print(f"  ERROR: {e}")
            failed += 1

        print()

    # Summary
    print("=" * 70)
    print("DOWNLOAD SUMMARY")
    print("=" * 70)
    print(f"Total series found:       {total_series}")
    print(f"Events downloaded:        {events_downloaded}")
    print(f"End states downloaded:    {end_state_downloaded}")
    print(f"Skipped (already exist):  {skipped}")
    print(f"Failed:                   {failed}")
    print()

    if args.extract:
        print(f"Files extracted to: {GRID_HOT_ROOT}")
    print(f"Archive location: {GRID_ARCHIVE_ROOT}")
    print()


if __name__ == '__main__':
    main()
