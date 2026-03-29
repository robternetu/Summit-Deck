r"""
Bulk download GRID tournament series data.

Downloads events.jsonl and end_state.json for all series in specified tournaments.
Organizes files into: F:\GRID-ARCHIVE\{year}\tournaments\{tournamentId}\series\{seriesId}\

Based on GRID File Download API OpenAPI spec:
- Base URL: https://api.grid.gg/file-download
- List files: GET /list/{series_id}
- Download events: GET /events/grid/series/{series_id} (returns zip)
- Download end state: GET /end-state/grid/series/{series_id} (returns JSON)

File statuses: match-not-started, match-in-progress, processing, ready, file-not-available
File IDs: events-grid-compressed, state-grid, events-riot-compressed, state-riot-compressed, etc.
"""
import argparse
import json
import os
import shutil
import sys
import time
import zipfile
from io import BytesIO
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

try:
    from rate_limiter import RateLimiter
except ImportError:
    # Inline rate limiter if module not available
    class RateLimiter:
        """Rate limiter that enforces minimum delay between calls."""

        def __init__(self, min_delay_seconds: float, name: str = "RateLimiter"):
            self.min_delay = min_delay_seconds
            self.name = name
            self.last_call: Optional[float] = None

        def wait(self):
            """Wait if necessary to enforce rate limit."""
            if self.last_call is None:
                self.last_call = time.time()
                return

            elapsed = time.time() - self.last_call
            if elapsed < self.min_delay:
                sleep_time = self.min_delay - elapsed
                time.sleep(sleep_time)

            self.last_call = time.time()


# Tournament IDs to process (Valorant tournaments with matches)
TOURNAMENT_IDS = [
    "757073", "757074", "757101", "757234", "757235", "757321", "757628", "757629", "758114",
    "774784", "774785", "774787", "775518", "800677", "800678", "800680", "826662", "826663", "826992",
]


# GraphQL query for fetching series with pagination
SERIES_QUERY = """
query GetSeries($tournamentId: [ID!]!, $after: Cursor) {
  allSeries(
    filter: {
      tournamentIds: { in: $tournamentId }
      titleId: "6"
    }
    first: 50
    after: $after
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
        teams {
          baseInfo {
            id
            name
          }
        }
      }
    }
  }
}
"""

# GraphQL query for fetching a single series by ID
SINGLE_SERIES_QUERY = """
query GetSeriesById($seriesId: ID!) {
  series(id: $seriesId) {
    id
    startTimeScheduled
    tournament {
      id
      name
    }
    teams {
      baseInfo {
        id
        name
      }
    }
  }
}
"""


class GridDownloader:
    """Handles GRID API interactions and file downloads."""

    def __init__(self, api_key: str, central_data_url: str, file_download_base: str,
                 archive_root: str, hot_root: str):
        self.api_key = api_key
        self.central_data_url = central_data_url
        self.file_download_base = file_download_base.rstrip('/')
        self.archive_root = Path(archive_root)
        self.hot_root = Path(hot_root)

        # Rate limiters (increased delays to avoid 429 errors)
        self.central_data_limiter = RateLimiter(3.5, "CentralData")
        self.file_download_limiter = RateLimiter(2.0, "FileDownload")  # Increased from 0.5 to 2.0 seconds

        # Stats
        self.stats = {
            "downloaded": 0,
            "skipped": 0,
            "failed": 0,
        }

    def _get_headers(self) -> Dict[str, str]:
        """Get standard headers for API requests."""
        return {
            "Content-Type": "application/json",
            "x-api-key": self.api_key,
        }

    def _graphql_request_with_retry(self, query: str, variables: Dict, max_retries: int = 3) -> Optional[Dict]:
        """
        Make a GraphQL request with retry logic for rate limits.

        Args:
            query: GraphQL query string
            variables: GraphQL query variables
            max_retries: Maximum number of retry attempts

        Returns:
            Response data or None on failure
        """
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    self.central_data_url,
                    headers=self._get_headers(),
                    json={"query": query, "variables": variables},
                    timeout=30,
                )

                # Handle rate limit HTTP errors (429)
                if response.status_code == 429:
                    if attempt < max_retries - 1:
                        backoff = (2 ** attempt) * 5  # 5s, 10s, 20s
                        print(f"    ! Rate limited (HTTP 429), retrying in {backoff}s...")
                        time.sleep(backoff)
                        continue
                    else:
                        raise Exception(f"Rate limited after {max_retries} attempts")

                response.raise_for_status()
                data = response.json()

                # Check for GraphQL errors
                if "errors" in data:
                    errors = data["errors"]
                    error_msg = str(errors)
                    if "ENHANCE_YOUR_CALM" in error_msg or "rate limit" in error_msg.lower():
                        if attempt < max_retries - 1:
                            backoff = (2 ** attempt) * 5
                            print(f"    ! Rate limited (GraphQL), retrying in {backoff}s...")
                            time.sleep(backoff)
                            continue
                        else:
                            raise Exception(f"Rate limited after {max_retries} attempts: {errors}")
                    else:
                        raise Exception(f"GraphQL error: {errors}")

                return data

            except requests.exceptions.Timeout:
                if attempt < max_retries - 1:
                    print(f"    ! Request timeout, retrying...")
                    time.sleep(2)
                    continue
                else:
                    raise

            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    print(f"    ! Request failed: {e}, retrying...")
                    time.sleep(2)
                    continue
                else:
                    raise

        return None

    def fetch_all_series(self, tournament_id: str, max_per_tournament: Optional[int] = None) -> List[Dict]:
        """
        Fetch all series for a tournament using pagination.

        Args:
            tournament_id: Tournament ID to query
            max_per_tournament: Optional limit on series per tournament

        Returns:
            List of series data dictionaries
        """
        all_series = []
        cursor = None
        page_num = 0

        print(f"  Fetching series for tournament {tournament_id}...")

        while True:
            page_num += 1
            self.central_data_limiter.wait()

            try:
                data = self._graphql_request_with_retry(SERIES_QUERY, {
                    "tournamentId": [tournament_id],
                    "after": cursor,
                })

                if not data or not data.get("data") or not data["data"].get("allSeries"):
                    print(f"    X Failed to fetch page {page_num}")
                    break

                all_series_data = data["data"]["allSeries"]
                edges = all_series_data.get("edges", [])
                page_info = all_series_data.get("pageInfo", {})

                for edge in edges:
                    if "node" in edge:
                        all_series.append(edge["node"])

                print(f"    Page {page_num}: fetched {len(edges)} series (total: {len(all_series)})")

                if max_per_tournament and len(all_series) >= max_per_tournament:
                    all_series = all_series[:max_per_tournament]
                    print(f"    Reached max-per-tournament limit of {max_per_tournament}")
                    break

                if not page_info.get("hasNextPage"):
                    break

                cursor = page_info.get("endCursor")
                if not cursor:
                    break

            except Exception as e:
                print(f"    X Error fetching page {page_num}: {e}")
                break

        return all_series

    def fetch_series_by_id(self, series_id: str) -> Optional[Dict]:
        """
        Fetch a single series by ID (for smoke testing).

        Args:
            series_id: Series ID

        Returns:
            Series data dictionary or None on error
        """
        print(f"  Fetching series {series_id}...")
        self.central_data_limiter.wait()

        try:
            data = self._graphql_request_with_retry(SINGLE_SERIES_QUERY, {"seriesId": series_id})

            if not data or not data.get("data") or not data["data"].get("series"):
                print(f"    X Series {series_id} not found")
                return None

            return data["data"]["series"]

        except Exception as e:
            print(f"    X Error fetching series {series_id}: {e}")
            return None

    def list_series_files(self, series_id: str) -> Optional[List[Dict]]:
        """
        List available files for a series using the File Download API.

        Endpoint: GET /list/{series_id}
        Returns: { "files": [{ "id", "description", "status", "fileName", "fullURL" }] }

        File IDs (from OpenAPI spec):
        - events-grid-compressed: GRID events JSONL (zipped)
        - state-grid: GRID end state JSON
        - events-riot-compressed: Riot events JSONL (zipped)
        - state-riot-compressed: Riot end state JSON (zipped)

        Status values: match-not-started, match-in-progress, processing, ready, file-not-available

        Args:
            series_id: Series ID

        Returns:
            List of file metadata dictionaries, or None on error
        """
        try:
            url = f"{self.file_download_base}/list/{series_id}"
            response = requests.get(
                url,
                headers={"x-api-key": self.api_key},
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()

            if not isinstance(data, dict) or "files" not in data:
                print(f"      X Unexpected file list format for series {series_id}")
                return None

            files = data["files"]
            if not isinstance(files, list):
                print(f"      X 'files' is not a list for series {series_id}")
                return None

            return files

        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 404:
                print(f"      X No files found for series {series_id}")
            elif e.response.status_code == 403:
                print(f"      X Access forbidden for series {series_id}")
            else:
                print(f"      X HTTP error listing files for series {series_id}: {e}")
            return None
        except Exception as e:
            print(f"      X Error listing files for series {series_id}: {e}")
            return None

    def download_events_direct(self, series_id: str, dest_path: Path, max_retries: int = 3) -> bool:
        """
        Download events file directly using the API endpoint with retry logic.

        Endpoint: GET /events/grid/series/{series_id}
        Returns: application/zip containing events.jsonl

        Args:
            series_id: Series ID
            dest_path: Destination path for events.jsonl
            max_retries: Maximum number of retry attempts for rate limits

        Returns:
            True if successful, False otherwise
        """
        url = f"{self.file_download_base}/events/grid/series/{series_id}"

        for attempt in range(max_retries):
            self.file_download_limiter.wait()

            try:
                response = requests.get(
                    url,
                    headers={"x-api-key": self.api_key},
                    stream=True,
                    timeout=120,
                )

                # Handle rate limiting with retry
                if response.status_code == 429:
                    if attempt < max_retries - 1:
                        backoff = (2 ** attempt) * 5  # 5s, 10s, 20s
                        print(f"      ! Rate limited (429), retrying in {backoff}s... (attempt {attempt + 1}/{max_retries})")
                        time.sleep(backoff)
                        continue
                    else:
                        print(f"      X Events file rate limited after {max_retries} attempts")
                        return False

                response.raise_for_status()

                content_type = response.headers.get('Content-Type', '')

                # Create parent directories
                dest_path.parent.mkdir(parents=True, exist_ok=True)

                # If it's a zip, extract it
                if 'zip' in content_type or response.headers.get('Content-Disposition', '').endswith('.zip'):
                    # Download to memory and extract
                    content = response.content
                    try:
                        with zipfile.ZipFile(BytesIO(content)) as zf:
                            # Find the events file in the zip
                            for name in zf.namelist():
                                if name.endswith('.jsonl') or 'event' in name.lower():
                                    with zf.open(name) as src, open(dest_path, 'wb') as dst:
                                        dst.write(src.read())
                                    return True
                            # If no events file found, extract first file
                            if zf.namelist():
                                first_file = zf.namelist()[0]
                                with zf.open(first_file) as src, open(dest_path, 'wb') as dst:
                                    dst.write(src.read())
                                return True
                    except zipfile.BadZipFile:
                        # Not actually a zip, save raw content
                        with open(dest_path, 'wb') as f:
                            f.write(content)
                        return True
                else:
                    # Save raw content
                    with open(dest_path, 'wb') as f:
                        for chunk in response.iter_content(chunk_size=8192):
                            f.write(chunk)
                    return True

            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 404:
                    print(f"      X Events file not found (404)")
                    return False
                elif e.response.status_code == 403:
                    print(f"      X Events file access forbidden (403)")
                    return False
                else:
                    print(f"      X HTTP error downloading events: {e}")
                    return False
            except Exception as e:
                print(f"      X Error downloading events: {e}")
                return False

        return False

    def download_end_state_direct(self, series_id: str, dest_path: Path, max_retries: int = 3) -> bool:
        """
        Download end state file directly using the API endpoint with retry logic.

        Endpoint: GET /end-state/grid/series/{series_id}
        Returns: application/json

        Args:
            series_id: Series ID
            dest_path: Destination path for end_state.json
            max_retries: Maximum number of retry attempts for rate limits

        Returns:
            True if successful, False otherwise
        """
        url = f"{self.file_download_base}/end-state/grid/series/{series_id}"

        for attempt in range(max_retries):
            self.file_download_limiter.wait()

            try:
                response = requests.get(
                    url,
                    headers={"x-api-key": self.api_key},
                    stream=True,
                    timeout=60,
                )

                # Handle rate limiting with retry
                if response.status_code == 429:
                    if attempt < max_retries - 1:
                        backoff = (2 ** attempt) * 5  # 5s, 10s, 20s
                        print(f"      ! Rate limited (429), retrying in {backoff}s... (attempt {attempt + 1}/{max_retries})")
                        time.sleep(backoff)
                        continue
                    else:
                        print(f"      X End state file rate limited after {max_retries} attempts")
                        return False

                response.raise_for_status()

                # Create parent directories
                dest_path.parent.mkdir(parents=True, exist_ok=True)

                # Save the content
                with open(dest_path, 'wb') as f:
                    for chunk in response.iter_content(chunk_size=8192):
                        f.write(chunk)
                return True

            except requests.exceptions.HTTPError as e:
                if e.response.status_code == 404:
                    print(f"      X End state file not found (404)")
                    return False
                elif e.response.status_code == 403:
                    print(f"      X End state file access forbidden (403)")
                    return False
                else:
                    print(f"      X HTTP error downloading end state: {e}")
                    return False
            except Exception as e:
                print(f"      X Error downloading end state: {e}")
                return False

        return False

    def download_file_from_url(self, file_url: str, dest_path: Path, is_zip: bool = False, max_retries: int = 3) -> bool:
        """
        Download a file from a URL (fullURL from list endpoint) with retry logic.

        Args:
            file_url: URL to download from
            dest_path: Destination file path
            is_zip: Whether to extract from zip
            max_retries: Maximum number of retry attempts for rate limits

        Returns:
            True if successful, False otherwise
        """
        # Create parent directories
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        for attempt in range(max_retries):
            self.file_download_limiter.wait()

            try:
                response = requests.get(
                    file_url,
                    headers={"x-api-key": self.api_key},
                    stream=True,
                    timeout=120,
                )

                # Handle rate limiting with retry
                if response.status_code == 429:
                    if attempt < max_retries - 1:
                        backoff = (2 ** attempt) * 5  # 5s, 10s, 20s
                        print(f"      ! Rate limited (429), retrying in {backoff}s... (attempt {attempt + 1}/{max_retries})")
                        time.sleep(backoff)
                        continue
                    else:
                        print(f"      X Download rate limited after {max_retries} attempts")
                        return False

                response.raise_for_status()

                if is_zip:
                    content = response.content
                    try:
                        with zipfile.ZipFile(BytesIO(content)) as zf:
                            # Extract first relevant file
                            for name in zf.namelist():
                                if name.endswith('.jsonl') or name.endswith('.json'):
                                    with zf.open(name) as src, open(dest_path, 'wb') as dst:
                                        dst.write(src.read())
                                    return True
                            # Fallback to first file
                            if zf.namelist():
                                first_file = zf.namelist()[0]
                                with zf.open(first_file) as src, open(dest_path, 'wb') as dst:
                                    dst.write(src.read())
                                return True
                    except zipfile.BadZipFile:
                        with open(dest_path, 'wb') as f:
                            f.write(content)
                        return True
                else:
                    with open(dest_path, 'wb') as f:
                        for chunk in response.iter_content(chunk_size=8192):
                            f.write(chunk)
                    return True

            except requests.exceptions.HTTPError as e:
                if e.response.status_code in [404, 403]:
                    print(f"      X Download failed (HTTP {e.response.status_code})")
                    return False
                else:
                    print(f"      X HTTP error downloading: {e}")
                    return False
            except Exception as e:
                print(f"      X Download failed: {e}")
                if dest_path.exists():
                    dest_path.unlink()
                return False

        return False

    def process_series(self, series: Dict, force: bool = False, use_list_api: bool = False) -> bool:
        """
        Process a single series: download events and end state files.

        Two approaches available:
        1. Direct API endpoints (default): Use /events/grid/series/{id} and /end-state/grid/series/{id}
        2. List API: Use /list/{id} to get file URLs, then download from fullURL

        Args:
            series: Series data dictionary
            force: Force re-download even if files exist
            use_list_api: Use the list API instead of direct endpoints

        Returns:
            True if successful, False otherwise
        """
        series_id = series.get("id")
        if not series_id:
            print(f"    X Series missing ID: {series}")
            return False

        # Extract year from startTimeScheduled
        year = "unknown-year"
        start_time = series.get("startTimeScheduled")
        if start_time:
            try:
                dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                year = str(dt.year)
            except Exception:
                pass

        # Get tournament info
        tournament = series.get("tournament", {})
        tournament_id = tournament.get("id", "unknown")
        tournament_name = tournament.get("name", "Unknown Tournament")

        # Build output directory
        series_dir = self.archive_root / year / "tournaments" / tournament_id / "series" / series_id
        series_dir.mkdir(parents=True, exist_ok=True)

        print(f"\n  Series {series_id} ({tournament_name})")
        print(f"    -> {series_dir}")

        events_path = series_dir / "events.jsonl"
        end_state_path = series_dir / "end_state.json"

        events_success = False
        end_state_success = False

        if use_list_api:
            # Use list API to get file URLs
            files = self.list_series_files(series_id)
            if files:
                print(f"    Listed {len(files)} files")

                # Find events and end state files by ID
                # Valid IDs from OpenAPI spec: events-grid-compressed, state-grid
                events_file = None
                end_state_file = None

                for file_info in files:
                    file_id = file_info.get("id", "")
                    file_status = file_info.get("status", "")
                    file_url = file_info.get("fullURL")

                    # Only process files with status "ready"
                    if file_status != "ready":
                        continue

                    if not file_url:
                        continue

                    # Match events file (events-grid-compressed)
                    if file_id == "events-grid-compressed":
                        events_file = {"url": file_url, "id": file_id, "is_zip": True}
                    elif file_id == "events-grid":
                        # Fallback if API returns events-grid instead
                        events_file = events_file or {"url": file_url, "id": file_id, "is_zip": False}

                    # Match end state file (state-grid)
                    if file_id == "state-grid":
                        end_state_file = {"url": file_url, "id": file_id, "is_zip": False}

                # Download events
                if events_file:
                    if events_path.exists() and events_path.stat().st_size > 0 and not force:
                        print(f"    o events.jsonl already exists (skipped)")
                        self.stats["skipped"] += 1
                        events_success = True
                    else:
                        print(f"    v Downloading events.jsonl (id: {events_file['id']})...")
                        if self.download_file_from_url(events_file["url"], events_path, events_file.get("is_zip", False)):
                            print(f"    + events.jsonl downloaded")
                            self.stats["downloaded"] += 1
                            events_success = True
                        else:
                            self.stats["failed"] += 1
                else:
                    print(f"    ! No events file found in list (status=ready)")

                # Download end state
                if end_state_file:
                    if end_state_path.exists() and end_state_path.stat().st_size > 0 and not force:
                        print(f"    o end_state.json already exists (skipped)")
                        self.stats["skipped"] += 1
                        end_state_success = True
                    else:
                        print(f"    v Downloading end_state.json (id: {end_state_file['id']})...")
                        if self.download_file_from_url(end_state_file["url"], end_state_path, end_state_file.get("is_zip", False)):
                            print(f"    + end_state.json downloaded")
                            self.stats["downloaded"] += 1
                            end_state_success = True
                        else:
                            self.stats["failed"] += 1
                else:
                    print(f"    ! No end state file found in list (status=ready)")
            else:
                print(f"    ! Could not list files, trying direct endpoints...")
                # Fall through to direct download

        # Use direct API endpoints (default or fallback)
        if not use_list_api or (not events_success and not end_state_success):
            # Download events
            if events_path.exists() and events_path.stat().st_size > 0 and not force:
                print(f"    o events.jsonl already exists (skipped)")
                self.stats["skipped"] += 1
                events_success = True
            else:
                print(f"    v Downloading events.jsonl (direct endpoint)...")
                if self.download_events_direct(series_id, events_path):
                    print(f"    + events.jsonl downloaded ({events_path.stat().st_size} bytes)")
                    self.stats["downloaded"] += 1
                    events_success = True
                else:
                    self.stats["failed"] += 1

            # Download end state
            if end_state_path.exists() and end_state_path.stat().st_size > 0 and not force:
                print(f"    o end_state.json already exists (skipped)")
                self.stats["skipped"] += 1
                end_state_success = True
            else:
                print(f"    v Downloading end_state.json (direct endpoint)...")
                if self.download_end_state_direct(series_id, end_state_path):
                    print(f"    + end_state.json downloaded ({end_state_path.stat().st_size} bytes)")
                    self.stats["downloaded"] += 1
                    end_state_success = True
                else:
                    self.stats["failed"] += 1

        # Create manifest.json
        manifest_path = series_dir / "manifest.json"
        manifest = {
            "seriesId": series_id,
            "tournamentId": tournament_id,
            "tournamentName": tournament_name,
            "year": year,
            "startTimeScheduled": start_time,
            "teams": series.get("teams", []),
            "downloadedAt": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            "files": {
                "events": {
                    "path": str(events_path.name) if events_success else None,
                    "success": events_success,
                },
                "endState": {
                    "path": str(end_state_path.name) if end_state_success else None,
                    "success": end_state_success,
                },
            }
        }

        try:
            with open(manifest_path, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, indent=2, ensure_ascii=False)
            print(f"    + manifest.json created")
        except Exception as e:
            print(f"    X Failed to create manifest: {e}")

        return events_success or end_state_success


def main():
    parser = argparse.ArgumentParser(
        description="Bulk download GRID tournament series data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Smoke test: download a single series
  python bulk_download_tournament_series.py --series-id 2653969

  # Download first 3 series total (for testing)
  python bulk_download_tournament_series.py --max-series 3

  # Download with limit per tournament
  python bulk_download_tournament_series.py --max-per-tournament 5

  # Force re-download existing files
  python bulk_download_tournament_series.py --force

  # Use list API instead of direct endpoints
  python bulk_download_tournament_series.py --use-list-api

  # Download all series from all tournaments
  python bulk_download_tournament_series.py
        """
    )
    parser.add_argument("--series-id", type=str, help="Smoke test: download single series by ID")
    parser.add_argument("--max-series", type=int, help="Maximum total series to process (for testing)")
    parser.add_argument("--max-per-tournament", type=int, help="Maximum series per tournament")
    parser.add_argument("--force", action="store_true", help="Force re-download existing files")
    parser.add_argument("--use-list-api", action="store_true", help="Use /list API instead of direct endpoints")
    parser.add_argument("--extract", action="store_true", help="Extract archives (handled automatically)")

    args = parser.parse_args()

    # Load environment
    load_dotenv(".env.local")

    api_key = os.getenv("GRID_API_KEY")
    if not api_key:
        print("X GRID_API_KEY not found in .env.local")
        sys.exit(1)

    central_data_url = os.getenv("GRID_CENTRAL_DATA_URL", "https://api-op.grid.gg/central-data/graphql")
    file_download_base = os.getenv("GRID_FILE_DOWNLOAD_BASE_URL", "https://api.grid.gg/file-download")
    archive_root = os.getenv("GRID_ARCHIVE_ROOT", "F:\\GRID-ARCHIVE")
    hot_root = os.getenv("GRID_HOT_ROOT", "E:\\grid-cache\\hot")

    print("=" * 80)
    print("GRID Tournament Series Bulk Downloader")
    print("=" * 80)
    print(f"Archive root: {archive_root}")
    print(f"File Download API: {file_download_base}")
    print(f"Central Data API: {central_data_url}")

    # Create downloader
    downloader = GridDownloader(api_key, central_data_url, file_download_base, archive_root, hot_root)

    # Smoke test mode: download single series
    if args.series_id:
        print(f"\nSMOKE TEST MODE: Series ID {args.series_id}")
        print(f"Force re-download: {args.force}")
        print(f"Use list API: {args.use_list_api}")
        print()

        series = downloader.fetch_series_by_id(args.series_id)
        if series:
            print(f"\n{'=' * 80}")
            print(f"Processing single series {args.series_id}")
            print('=' * 80)
            try:
                success = downloader.process_series(series, force=args.force, use_list_api=args.use_list_api)
                print(f"\n{'=' * 80}")
                print("Smoke Test Summary")
                print('=' * 80)
                print(f"Series ID: {args.series_id}")
                print(f"Status: {'Success' if success else 'Failed'}")
                print(f"Files downloaded: {downloader.stats['downloaded']}")
                print(f"Files skipped: {downloader.stats['skipped']}")
                print(f"Files failed: {downloader.stats['failed']}")
                print()
            except Exception as e:
                print(f"X Error processing series: {e}")
                import traceback
                traceback.print_exc()
                sys.exit(1)
        else:
            print(f"X Could not fetch series {args.series_id}")
            sys.exit(1)
        return

    # Normal mode: process tournaments
    print(f"\nTournaments: {len(TOURNAMENT_IDS)}")
    if args.max_series:
        print(f"Max series (total): {args.max_series}")
    if args.max_per_tournament:
        print(f"Max per tournament: {args.max_per_tournament}")
    print(f"Force re-download: {args.force}")
    print(f"Use list API: {args.use_list_api}")
    print()

    total_series_processed = 0

    for tournament_id in TOURNAMENT_IDS:
        print(f"\n{'=' * 80}")
        print(f"Tournament {tournament_id}")
        print('=' * 80)

        try:
            series_list = downloader.fetch_all_series(tournament_id, args.max_per_tournament)
            print(f"  Found {len(series_list)} series")

            if not series_list:
                print(f"  ! No series found for tournament {tournament_id}")
                continue

            for series in series_list:
                if args.max_series and total_series_processed >= args.max_series:
                    print(f"\n+ Reached global max-series limit of {args.max_series}")
                    break

                try:
                    downloader.process_series(series, force=args.force, use_list_api=args.use_list_api)
                    total_series_processed += 1
                except Exception as e:
                    print(f"    X Error processing series: {e}")
                    downloader.stats["failed"] += 1
                    continue

            if args.max_series and total_series_processed >= args.max_series:
                break

        except Exception as e:
            print(f"  X Error processing tournament {tournament_id}: {e}")
            continue

    # Print summary
    print(f"\n{'=' * 80}")
    print("Summary")
    print('=' * 80)
    print(f"Series processed: {total_series_processed}")
    print(f"Files downloaded: {downloader.stats['downloaded']}")
    print(f"Files skipped: {downloader.stats['skipped']}")
    print(f"Files failed: {downloader.stats['failed']}")
    print()


if __name__ == "__main__":
    main()
