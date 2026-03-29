"""
GRID File Download API client for downloading series event data.
"""

import os
import requests
from typing import Dict, Optional


GRID_FILE_DOWNLOAD_BASE = "https://api.grid.gg/file-download"


def list_files(series_id: str, api_key: str) -> Dict:
    """
    List available files for a series.

    Calls: GET https://api.grid.gg/file-download/list/{seriesId}
    """
    url = f"{GRID_FILE_DOWNLOAD_BASE}/list/{series_id}"
    headers = {"x-api-key": api_key}

    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()

    return response.json()


def download_file(url: str, api_key: str, out_path: str) -> None:
    """
    Download a file from GRID, following redirects.
    """
    headers = {"x-api-key": api_key}

    response = requests.get(url, headers=headers, allow_redirects=True, timeout=120, stream=True)
    response.raise_for_status()

    # Write content to file
    with open(out_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8192):
            f.write(chunk)


def download_series_files(series_id: str, out_dir: str, api_key: str) -> Dict[str, str]:
    """
    Download end-state and events files for a series.

    Returns dict with paths to downloaded files.
    """
    os.makedirs(out_dir, exist_ok=True)

    # Define URLs and output paths
    end_state_url = f"{GRID_FILE_DOWNLOAD_BASE}/end-state/grid/series/{series_id}"
    events_url = f"{GRID_FILE_DOWNLOAD_BASE}/events/grid/series/{series_id}"

    end_state_path = os.path.join(out_dir, f"end_state_{series_id}_grid.json")
    events_path = os.path.join(out_dir, f"events_{series_id}_grid.jsonl")

    result = {
        "end_state": end_state_path,
        "events": events_path,
    }

    # Download end-state
    if not os.path.exists(end_state_path):
        print(f"Downloading end-state for series {series_id}...")
        download_file(end_state_url, api_key, end_state_path)
        print(f"  Saved to: {end_state_path}")
    else:
        print(f"End-state already exists: {end_state_path}")

    # Download events JSONL
    if not os.path.exists(events_path):
        print(f"Downloading events for series {series_id}...")
        download_file(events_url, api_key, events_path)
        print(f"  Saved to: {events_path}")
    else:
        print(f"Events already exist: {events_path}")

    return result
