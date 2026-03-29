"""
Bulk download GRID tournament series data.

Downloads events.jsonl and end_state.json for all series in specified tournaments.
Organizes files into: F:\GRID-ARCHIVE\{year}\tournaments\{tournamentId}\series\{seriesId}\
"""
import argparse
import json
import os
import shutil
import sys
import time
import zipfile
from pathlib import Path
from typing import List, Dict, Optional, Any
from datetime import datetime

import requests
from dotenv import load_dotenv

from rate_limiter import RateLimiter


# Tournament IDs to process
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


class GridDownloader:
    """Handles GRID API interactions and file downloads."""

    def __init__(self, api_key: str, central_data_url: str, file_download_base: str,
                 archive_root: str, hot_root: str, debug: bool = False):
        self.api_key = api_key
        self.central_data_url = central_data_url
        self.file_download_base = file_download_base
        self.archive_root = Path(archive_root)
        self.hot_root = Path(hot_root)
        self.debug = debug

        # Rate limiters
        self.central_data_limiter = RateLimiter(3.2, "CentralData")
        self.file_list_limiter = RateLimiter(0.1, "FileList")  # 0.1s for file listing
        self.file_download_limiter = RateLimiter(3.2, "FileDownload")

        # Stats
        self.stats = {
            "series_processed": 0,
            "list_failures": 0,
            "downloads_attempted": 0,
            "downloads_succeeded": 0,
            "skipped_existing": 0,
            "skipped_status": 0,
            "skipped_missing": 0,
            "failed": 0,
        }

    def _graphql_request_with_retry(self, variables: Dict, max_retries: int = 3) -> Optional[Dict]:
        """
        Make a GraphQL request with retry logic for rate limits.

        Args:
            variables: GraphQL query variables
            max_retries: Maximum number of retry attempts

        Returns:
            Response data or None on failure
        """
        for attempt in range(max_retries):
            try:
                response = requests.post(
                    self.central_data_url,
                    headers={
                        "Content-Type": "application/json",
                        "x-api-key": self.api_key,
                    },
                    json={
                        "query": SERIES_QUERY,
                        "variables": variables,
                    },
                    timeout=30,
                )

                # Handle rate limit HTTP errors (429)
                if response.status_code == 429:
                    if attempt < max_retries - 1:
                        backoff = (2 ** attempt) * 5  # 5s, 10s, 20s
                        print(f"    ⚠ Rate limited (HTTP 429), retrying in {backoff}s...")
                        time.sleep(backoff)
                        continue
                    else:
                        raise Exception(f"Rate limited after {max_retries} attempts")

                response.raise_for_status()
                data = response.json()

                # Check for GraphQL errors
                if "errors" in data:
                    errors = data["errors"]
                    # Check if it's a rate limit error
                    error_msg = str(errors)
                    if "ENHANCE_YOUR_CALM" in error_msg or "rate limit" in error_msg.lower():
                        if attempt < max_retries - 1:
                            backoff = (2 ** attempt) * 5
                            print(f"    ⚠ Rate limited (GraphQL), retrying in {backoff}s...")
                            time.sleep(backoff)
                            continue
                        else:
                            raise Exception(f"Rate limited after {max_retries} attempts: {errors}")
                    else:
                        raise Exception(f"GraphQL error: {errors}")

                if not data.get("data") or not data["data"].get("allSeries"):
                    raise Exception(f"Unexpected response structure: {data}")

                return data

            except requests.exceptions.Timeout:
                if attempt < max_retries - 1:
                    print(f"    ⚠ Request timeout, retrying...")
                    time.sleep(2)
                    continue
                else:
                    raise

            except requests.exceptions.RequestException as e:
                if attempt < max_retries - 1:
                    print(f"    ⚠ Request failed: {e}, retrying...")
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
                # Use retry helper for rate limit handling
                data = self._graphql_request_with_retry({
                    "tournamentId": [tournament_id],
                    "after": cursor,
                })

                if not data:
                    print(f"    ✗ Failed to fetch page {page_num}")
                    break

                all_series_data = data["data"]["allSeries"]
                edges = all_series_data.get("edges", [])
                page_info = all_series_data.get("pageInfo", {})

                # Extract series from edges
                for edge in edges:
                    if "node" in edge:
                        all_series.append(edge["node"])

                print(f"    Page {page_num}: fetched {len(edges)} series (total: {len(all_series)})")

                # Check if we've hit the max limit
                if max_per_tournament and len(all_series) >= max_per_tournament:
                    all_series = all_series[:max_per_tournament]
                    print(f"    Reached max-per-tournament limit of {max_per_tournament}")
                    break

                # Check if there are more pages
                if not page_info.get("hasNextPage"):
                    break

                cursor = page_info.get("endCursor")
                if not cursor:
                    break

            except Exception as e:
                print(f"    ✗ Error fetching page {page_num}: {e}")
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

        # Simple GraphQL query for a single series
        query = """
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

        self.central_data_limiter.wait()

        try:
            response = requests.post(
                self.central_data_url,
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": self.api_key,
                },
                json={
                    "query": query,
                    "variables": {"seriesId": series_id}
                },
                timeout=30,
            )
            response.raise_for_status()
            data = response.json()

            # Check for errors
            if "errors" in data:
                print(f"    ✗ GraphQL error: {data['errors']}")
                return None

            if not data.get("data") or not data["data"].get("series"):
                print(f"    ✗ Series {series_id} not found")
                return None

            return data["data"]["series"]

        except Exception as e:
            print(f"    ✗ Error fetching series {series_id}: {e}")
            return None

    def list_series_files(self, series_id: str) -> Optional[List[Dict]]:
        """
        List available files for a series.

        Args:
            series_id: Series ID

        Returns:
            List of file metadata dictionaries, or None on error
        """
        # Small delay for file listing (0.1s to be polite)
        self.file_list_limiter.wait()

        try:
            # Correct endpoint: /list/{seriesId}
            url = f"{self.file_download_base}/list/{series_id}"

            if self.debug:
                print(f"      [DEBUG] Listing files: {url}")

            response = requests.get(
                url,
                headers={"x-api-key": self.api_key},
                timeout=30,
            )

            # Better error reporting for non-200 responses
            if response.status_code != 200:
                body_preview = response.text[:300] if response.text else "(empty)"
                print(f"      ✗ HTTP {response.status_code} listing files for series {series_id}")
                print(f"         Body preview: {body_preview}")
                self.stats["list_failures"] += 1
                return None

            response.raise_for_status()
            data = response.json()

            # Response structure: { "files": [...] }
            if not isinstance(data, dict) or "files" not in data:
                print(f"      ✗ Unexpected file list format for series {series_id}")
                if self.debug:
                    print(f"         Response: {json.dumps(data, indent=2)[:500]}")
                self.stats["list_failures"] += 1
                return None

            files = data["files"]
            if not isinstance(files, list):
                print(f"      ✗ 'files' is not a list for series {series_id}")
                self.stats["list_failures"] += 1
                return None

            if self.debug:
                print(f"      [DEBUG] Found {len(files)} files")
                for i, f in enumerate(files[:5]):  # Print first 5
                    file_id = f.get("id", "?")
                    status = f.get("status", "?")
                    filename = f.get("fileName") or f.get("filename", "?")
                    has_url = "fullURL" in f or "fullUrl" in f or "full_url" in f
                    print(f"         [{i+1}] id={file_id}, status={status}, fileName={filename}, hasURL={has_url}")

            return files

        except requests.exceptions.HTTPError as e:
            print(f"      ✗ HTTP error listing files for series {series_id}: {e}")
            self.stats["list_failures"] += 1
            return None
        except Exception as e:
            print(f"      ✗ Error listing files for series {series_id}: {e}")
            self.stats["list_failures"] += 1
            return None

    def _extract_from_zip(self, zip_path: Path, dest_path: Path, keep_zip: bool = False) -> bool:
        """
        Extract the target file from a zip archive.

        Args:
            zip_path: Path to the zip file
            dest_path: Destination path for the extracted file
            keep_zip: Whether to keep the zip file after extraction

        Returns:
            True if successful, False otherwise
        """
        try:
            with zipfile.ZipFile(zip_path, 'r') as zf:
                # List files in zip
                files = zf.namelist()

                if self.debug:
                    print(f"         [DEBUG] Zip contains: {files}")

                # Look for .jsonl or .json file
                target_ext = dest_path.suffix  # .jsonl or .json
                target_file = None

                for f in files:
                    if f.endswith(target_ext):
                        target_file = f
                        break

                if not target_file:
                    print(f"      ✗ No {target_ext} file found in zip")
                    return False

                # Extract to destination
                with zf.open(target_file) as source:
                    with open(dest_path, 'wb') as target:
                        shutil.copyfileobj(source, target)

                if self.debug:
                    print(f"         [DEBUG] Extracted {target_file} from zip")

            # Clean up zip file unless keeping
            if not keep_zip and zip_path.exists():
                zip_path.unlink()

            return True

        except Exception as e:
            print(f"      ✗ Zip extraction failed: {e}")
            return False

    def download_file(self, file_url: str, dest_path: Path, actual_filename: str = "",
                     keep_zip: bool = False) -> bool:
        """
        Download a file from GRID to destination path.

        Args:
            file_url: URL to download from
            dest_path: Destination file path
            actual_filename: The actual filename from API (for zip detection)
            keep_zip: Whether to keep zip files after extraction

        Returns:
            True if successful, False otherwise
        """
        self.file_download_limiter.wait()
        self.stats["downloads_attempted"] += 1

        # Create parent directories
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        # Download to temp file in hot dir
        is_zip = actual_filename.lower().endswith('.zip')
        temp_name = f"{dest_path.name}.part"
        if is_zip:
            temp_name = f"{dest_path.stem}.zip.part"

        temp_path = self.hot_root / temp_name
        temp_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if self.debug:
                print(f"         [DEBUG] Downloading from: {file_url[:100]}...")

            response = requests.get(
                file_url,
                headers={"x-api-key": self.api_key},
                stream=True,
                timeout=60,
            )
            response.raise_for_status()

            # Write to temp file
            with open(temp_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            # If it's a zip, extract it
            if is_zip:
                zip_path = self.hot_root / f"{dest_path.stem}.zip"
                shutil.move(str(temp_path), str(zip_path))

                if self._extract_from_zip(zip_path, dest_path, keep_zip):
                    self.stats["downloads_succeeded"] += 1
                    return True
                else:
                    self.stats["failed"] += 1
                    return False
            else:
                # Move to final destination
                shutil.move(str(temp_path), str(dest_path))
                self.stats["downloads_succeeded"] += 1
                return True

        except Exception as e:
            print(f"      ✗ Download failed: {e}")
            self.stats["failed"] += 1
            # Clean up temp file
            if temp_path.exists():
                temp_path.unlink()
            return False

    def process_series(self, series: Dict, force: bool = False, keep_zip: bool = False) -> bool:
        """
        Process a single series: list files, download events and end state.

        Args:
            series: Series data dictionary
            force: Force re-download even if files exist
            keep_zip: Keep zip files after extraction

        Returns:
            True if successful, False otherwise
        """
        self.stats["series_processed"] += 1
        series_id = series.get("id")
        if not series_id:
            print(f"    ✗ Series missing ID: {series}")
            return False

        # Extract year from startTimeScheduled
        year = "unknown-year"
        start_time = series.get("startTimeScheduled")
        if start_time:
            try:
                # Parse ISO 8601 timestamp
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
        print(f"    → {series_dir}")

        # List files
        files = self.list_series_files(series_id)
        if not files:
            print(f"    ✗ Could not list files")
            return False

        # Find events and end state files
        events_file = None
        end_state_file = None

        print(f"    Listed {len(files)} files")

        # Look for events and end_state files with flexible field name handling
        for file_info in files:
            file_id = file_info.get("id", "")
            # Support both fileName and filename
            file_name = file_info.get("fileName") or file_info.get("filename", "")
            file_name_lower = file_name.lower()
            # Support fullURL, fullUrl, and full_url
            file_url = file_info.get("fullURL") or file_info.get("fullUrl") or file_info.get("full_url")
            file_status = file_info.get("status", "")
            file_description = file_info.get("description", "")

            # Accept both "ready" and "available" status
            is_downloadable = file_status in ["ready", "available"]

            if not file_url:
                if self.debug:
                    print(f"      [DEBUG] Skipping file {file_id} - no URL")
                continue

            if not is_downloadable:
                if self.debug or True:  # Always log status skips to debug "0 downloads"
                    print(f"      ⊘ Skipping {file_name} (status: {file_status})")
                self.stats["skipped_status"] += 1
                continue

            # Match events file
            # Priority 1: id == "events-grid"
            # Priority 2: description contains "Series Events"
            # Priority 3: filename contains "events_" or ends with events.jsonl/events.zip
            is_events = (
                file_id == "events-grid" or
                "series events" in file_description.lower() or
                "events_" in file_name_lower or
                (file_name_lower.endswith("events.jsonl") or file_name_lower.endswith("events.zip"))
            )

            if is_events:
                # Always prefer events-grid by ID
                if file_id == "events-grid" or not events_file:
                    events_file = {"url": file_url, "name": file_name, "id": file_id, "status": file_status}
                    if self.debug:
                        print(f"      [DEBUG] Found events candidate: id={file_id}, file={file_name}")

            # Match end state file
            # Priority 1: id == "state-grid"
            # Priority 2: description contains "Post Series State"
            # Priority 3: filename contains "end_state" or "end state"
            is_end_state = (
                file_id == "state-grid" or
                "post series state" in file_description.lower() or
                "end_state" in file_name_lower or
                "end state" in file_name_lower or
                (file_name_lower.endswith("end_state.json") or file_name_lower.endswith("end_state.zip"))
            )

            if is_end_state:
                # Always prefer state-grid by ID
                if file_id == "state-grid" or not end_state_file:
                    end_state_file = {"url": file_url, "name": file_name, "id": file_id, "status": file_status}
                    if self.debug:
                        print(f"      [DEBUG] Found end_state candidate: id={file_id}, file={file_name}")

        if not events_file:
            print(f"    ⚠ No events file found")
            self.stats["skipped_missing"] += 1

        if not end_state_file:
            print(f"    ⚠ No end state file found")
            self.stats["skipped_missing"] += 1

        if not events_file and not end_state_file:
            return False

        # Download files
        success = True

        # Download events.jsonl
        if events_file:
            events_path = series_dir / "events.jsonl"
            if events_path.exists() and events_path.stat().st_size > 0 and not force:
                print(f"    ○ events.jsonl already exists (skipped)")
                self.stats["skipped_existing"] += 1
            else:
                print(f"    ↓ Downloading events (id: {events_file['id']}, file: {events_file['name']})...")
                if self.download_file(events_file["url"], events_path,
                                     actual_filename=events_file['name'], keep_zip=keep_zip):
                    print(f"    ✓ events.jsonl saved → {events_path}")
                    # Success already counted in download_file
                else:
                    success = False
                    # Failure already counted in download_file

        # Download end_state.json
        if end_state_file:
            end_state_path = series_dir / "end_state.json"
            if end_state_path.exists() and end_state_path.stat().st_size > 0 and not force:
                print(f"    ○ end_state.json already exists (skipped)")
                self.stats["skipped_existing"] += 1
            else:
                print(f"    ↓ Downloading end_state (id: {end_state_file['id']}, file: {end_state_file['name']})...")
                if self.download_file(end_state_file["url"], end_state_path,
                                     actual_filename=end_state_file['name'], keep_zip=keep_zip):
                    print(f"    ✓ end_state.json saved → {end_state_path}")
                    # Success already counted in download_file
                else:
                    success = False
                    # Failure already counted in download_file

        # Create manifest.json
        manifest_path = series_dir / "manifest.json"
        manifest = {
            "seriesId": series_id,
            "tournamentId": tournament_id,
            "tournamentName": tournament_name,
            "year": year,
            "startTimeScheduled": start_time,
            "teams": series.get("teams", []),
            "downloadedAt": datetime.utcnow().isoformat() + "Z",
            "files": {
                "events": {
                    "id": events_file.get("id"),
                    "filename": events_file.get("name")
                } if events_file else None,
                "endState": {
                    "id": end_state_file.get("id"),
                    "filename": end_state_file.get("name")
                } if end_state_file else None,
            }
        }

        try:
            with open(manifest_path, 'w', encoding='utf-8') as f:
                json.dump(manifest, f, indent=2, ensure_ascii=False)
            print(f"    ✓ manifest.json created")
        except Exception as e:
            print(f"    ✗ Failed to create manifest: {e}")

        return success


def main():
    parser = argparse.ArgumentParser(
        description="Bulk download GRID tournament series data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Smoke test: download a single series
  python scripts/py/bulk_download_tournament_series.py --series-id 2653969

  # Download first 3 series total (for testing)
  python scripts/py/bulk_download_tournament_series.py --max-series 3

  # Download with limit per tournament
  python scripts/py/bulk_download_tournament_series.py --max-per-tournament 5

  # Force re-download existing files
  python scripts/py/bulk_download_tournament_series.py --force

  # Download all series from all tournaments
  python scripts/py/bulk_download_tournament_series.py
        """
    )
    parser.add_argument("--series-id", type=str, help="Smoke test: download single series by ID")
    parser.add_argument("--max-series", type=int, help="Maximum total series to process (for testing)")
    parser.add_argument("--max-per-tournament", type=int, help="Maximum series per tournament")
    parser.add_argument("--force", action="store_true", help="Force re-download existing files")
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")
    parser.add_argument("--keep-zip", action="store_true", help="Keep zip files after extraction")
    parser.add_argument("--extract", action="store_true", help="Extract archives (deprecated, zips auto-extract)")

    args = parser.parse_args()

    # Load environment
    load_dotenv(".env.local")

    api_key = os.getenv("GRID_API_KEY")
    if not api_key:
        print("✗ GRID_API_KEY not found in .env.local")
        sys.exit(1)

    central_data_url = os.getenv("GRID_CENTRAL_DATA_URL", "https://api-op.grid.gg/central-data/graphql")
    file_download_base = os.getenv("GRID_FILE_DOWNLOAD_BASE", "https://api.grid.gg/file-download")
    archive_root = os.getenv("GRID_ARCHIVE_ROOT", "F:\\GRID-ARCHIVE")
    hot_root = os.getenv("GRID_HOT_ROOT", "E:\\grid-cache\\hot")

    print("=" * 80)
    print("GRID Tournament Series Bulk Downloader")
    print("=" * 80)
    print(f"Archive root: {archive_root}")
    print(f"Hot cache: {hot_root}")
    if args.debug:
        print(f"Debug mode: ENABLED")
    if args.keep_zip:
        print(f"Keep zip files: YES")

    # Create downloader
    downloader = GridDownloader(api_key, central_data_url, file_download_base,
                                archive_root, hot_root, debug=args.debug)

    # Smoke test mode: download single series
    if args.series_id:
        print(f"SMOKE TEST MODE: Series ID {args.series_id}")
        print(f"Force re-download: {args.force}")
        print()

        series = downloader.fetch_series_by_id(args.series_id)
        if series:
            print(f"\n{'=' * 80}")
            print(f"Processing single series {args.series_id}")
            print('=' * 80)
            try:
                success = downloader.process_series(series, force=args.force, keep_zip=args.keep_zip)
                print(f"\n{'=' * 80}")
                print("Smoke Test Summary")
                print('=' * 80)
                print(f"Series ID: {args.series_id}")
                print(f"Status: {'Success' if success else 'Failed'}")
                print(f"Series processed: {downloader.stats['series_processed']}")
                print(f"List failures: {downloader.stats['list_failures']}")
                print(f"Downloads attempted: {downloader.stats['downloads_attempted']}")
                print(f"Downloads succeeded: {downloader.stats['downloads_succeeded']}")
                print(f"Skipped (existing): {downloader.stats['skipped_existing']}")
                print(f"Skipped (status): {downloader.stats['skipped_status']}")
                print(f"Skipped (missing): {downloader.stats['skipped_missing']}")
                print(f"Failed: {downloader.stats['failed']}")
                print()
            except Exception as e:
                print(f"✗ Error processing series: {e}")
                import traceback
                traceback.print_exc()
                sys.exit(1)
        else:
            print(f"✗ Could not fetch series {args.series_id}")
            sys.exit(1)
        return

    # Normal mode: process tournaments
    print(f"Tournaments: {len(TOURNAMENT_IDS)}")
    if args.max_series:
        print(f"Max series (total): {args.max_series}")
    if args.max_per_tournament:
        print(f"Max per tournament: {args.max_per_tournament}")
    print(f"Force re-download: {args.force}")
    print()

    total_series_processed = 0

    for tournament_id in TOURNAMENT_IDS:
        print(f"\n{'=' * 80}")
        print(f"Tournament {tournament_id}")
        print('=' * 80)

        # Fetch all series for tournament
        try:
            series_list = downloader.fetch_all_series(tournament_id, args.max_per_tournament)
            print(f"  Found {len(series_list)} series")

            if not series_list:
                print(f"  ⚠ No series found for tournament {tournament_id}")
                continue

            # Process each series
            for series in series_list:
                # Check global max series limit
                if args.max_series and total_series_processed >= args.max_series:
                    print(f"\n✓ Reached global max-series limit of {args.max_series}")
                    break

                try:
                    downloader.process_series(series, force=args.force, keep_zip=args.keep_zip)
                    total_series_processed += 1
                except Exception as e:
                    print(f"    ✗ Error processing series: {e}")
                    if args.debug:
                        import traceback
                        traceback.print_exc()
                    downloader.stats["failed"] += 1
                    continue

            # Check if we hit global limit
            if args.max_series and total_series_processed >= args.max_series:
                break

        except Exception as e:
            print(f"  ✗ Error processing tournament {tournament_id}: {e}")
            continue

    # Print summary
    print(f"\n{'=' * 80}")
    print("Summary")
    print('=' * 80)
    print(f"Series processed: {downloader.stats['series_processed']}")
    print(f"List failures: {downloader.stats['list_failures']}")
    print(f"Downloads attempted: {downloader.stats['downloads_attempted']}")
    print(f"Downloads succeeded: {downloader.stats['downloads_succeeded']}")
    print(f"Skipped (existing files): {downloader.stats['skipped_existing']}")
    print(f"Skipped (wrong status): {downloader.stats['skipped_status']}")
    print(f"Skipped (missing targets): {downloader.stats['skipped_missing']}")
    print(f"Failed: {downloader.stats['failed']}")
    print()


if __name__ == "__main__":
    main()
