"""
Unzip GRID event archives from archive to hot cache for faster processing.

This script:
- Recursively finds all event archives (events.jsonl, events.zip, events*.zip)
- Detects ZIP files by magic bytes (not extension)
- Extracts inner *.jsonl files to hot cache
- Preserves directory structure
- Skips existing files unless --force
- Creates extraction manifest
"""
import argparse
import json
import os
import sys
import zipfile
from pathlib import Path
from typing import List, Dict, Optional, Tuple

from dotenv import load_dotenv


# ZIP magic bytes
ZIP_MAGIC = b'PK\x03\x04'


def is_zip_file(file_path: Path) -> bool:
    """
    Check if file is a ZIP by reading magic bytes.

    Args:
        file_path: Path to file to check

    Returns:
        True if file starts with ZIP magic bytes
    """
    try:
        with open(file_path, 'rb') as f:
            return f.read(4) == ZIP_MAGIC
    except Exception:
        return False


def find_event_archives(archive_root: Path, max_files: Optional[int] = None) -> List[Path]:
    """
    Recursively find all event archive files.

    Looks for files named:
    - events.jsonl
    - events.zip
    - events*.zip

    Args:
        archive_root: Root directory to search
        max_files: Optional limit on number of files to find

    Returns:
        List of paths to event archive files
    """
    archive_files = []

    # Pattern: any file named events.jsonl, events.zip, or events*.zip
    patterns = ['events.jsonl', 'events.zip', 'events*.zip']

    print(f"Scanning {archive_root} for event archives...")

    for root, dirs, files in os.walk(archive_root):
        for file in files:
            file_lower = file.lower()

            # Match patterns
            if (file_lower == 'events.jsonl' or
                file_lower == 'events.zip' or
                (file_lower.startswith('events') and file_lower.endswith('.zip'))):

                file_path = Path(root) / file
                archive_files.append(file_path)

                if max_files and len(archive_files) >= max_files:
                    print(f"Reached max limit of {max_files} files")
                    return archive_files

    print(f"Found {len(archive_files)} event archive files")
    return archive_files


def extract_relative_path(archive_root: Path, file_path: Path) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract tournamentId and seriesId from file path.

    Expected structure: .../tournaments/<tournamentId>/series/<seriesId>/...

    Args:
        archive_root: Archive root directory
        file_path: Full path to event file

    Returns:
        Tuple of (tournamentId, seriesId) or (None, None) if not found
    """
    try:
        # Get relative path from archive root
        rel_path = file_path.relative_to(archive_root)
        parts = rel_path.parts

        # Find tournaments and series indices
        if 'tournaments' in parts and 'series' in parts:
            tournament_idx = parts.index('tournaments')
            series_idx = parts.index('series')

            if tournament_idx + 1 < len(parts) and series_idx + 1 < len(parts):
                tournament_id = parts[tournament_idx + 1]
                series_id = parts[series_idx + 1]
                return tournament_id, series_id

        return None, None
    except Exception:
        return None, None


def get_destination_path(archive_root: Path, hot_root: Path, src_path: Path) -> Path:
    """
    Calculate destination path in hot cache preserving structure.

    Args:
        archive_root: Archive root directory
        hot_root: Hot cache root directory
        src_path: Source file path

    Returns:
        Destination path for extracted file
    """
    # Get relative path from archive root
    rel_path = src_path.relative_to(archive_root)

    # Replace the filename with events.jsonl (normalize)
    rel_dir = rel_path.parent
    dest_path = hot_root / rel_dir / 'events.jsonl'

    return dest_path


def extract_jsonl_from_zip(zip_path: Path, dest_path: Path, dry_run: bool = False) -> Tuple[bool, Optional[int], Optional[str]]:
    """
    Extract *.jsonl file from ZIP archive.

    Args:
        zip_path: Path to ZIP file
        dest_path: Destination path for extracted file
        dry_run: If True, don't actually extract

    Returns:
        Tuple of (success, bytes_extracted, error_message)
    """
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Find *.jsonl file in archive
            jsonl_files = [name for name in zf.namelist() if name.endswith('.jsonl')]

            if not jsonl_files:
                return False, None, "No .jsonl file found in ZIP"

            # Use first .jsonl file found
            jsonl_name = jsonl_files[0]

            if dry_run:
                # Just get the size
                file_info = zf.getinfo(jsonl_name)
                return True, file_info.file_size, None

            # Create destination directory
            dest_path.parent.mkdir(parents=True, exist_ok=True)

            # Extract file
            with zf.open(jsonl_name) as src:
                with open(dest_path, 'wb') as dst:
                    data = src.read()
                    dst.write(data)
                    return True, len(data), None

    except zipfile.BadZipFile:
        return False, None, "Corrupted ZIP file"
    except Exception as e:
        return False, None, f"Extraction error: {str(e)}"


def copy_jsonl_file(src_path: Path, dest_path: Path, dry_run: bool = False) -> Tuple[bool, Optional[int], Optional[str]]:
    """
    Copy already-extracted .jsonl file.

    Args:
        src_path: Source file path
        dest_path: Destination path
        dry_run: If True, don't actually copy

    Returns:
        Tuple of (success, bytes_copied, error_message)
    """
    try:
        file_size = src_path.stat().st_size

        if dry_run:
            return True, file_size, None

        # Create destination directory
        dest_path.parent.mkdir(parents=True, exist_ok=True)

        # Copy file
        with open(src_path, 'rb') as src:
            with open(dest_path, 'wb') as dst:
                data = src.read()
                dst.write(data)
                return True, len(data), None

    except Exception as e:
        return False, None, f"Copy error: {str(e)}"


def process_archive(
    src_path: Path,
    archive_root: Path,
    hot_root: Path,
    force: bool = False,
    dry_run: bool = False
) -> Dict:
    """
    Process a single event archive file.

    Args:
        src_path: Source archive path
        archive_root: Archive root directory
        hot_root: Hot cache root directory
        force: Force overwrite existing files
        dry_run: Don't actually extract, just simulate

    Returns:
        Dictionary with processing results
    """
    # Extract IDs from path
    tournament_id, series_id = extract_relative_path(archive_root, src_path)

    # Get destination path
    dest_path = get_destination_path(archive_root, hot_root, src_path)

    result = {
        "tournamentId": tournament_id,
        "seriesId": series_id,
        "srcPath": str(src_path),
        "dstPath": str(dest_path),
        "bytes": None,
        "status": None,
        "error": None
    }

    # Check if destination exists and skip if not forcing
    if dest_path.exists() and not force:
        dest_size = dest_path.stat().st_size
        result["bytes"] = dest_size
        result["status"] = "skipped"
        return result

    # Check if source is a ZIP file
    is_zip = is_zip_file(src_path)

    if is_zip:
        # Extract from ZIP
        success, bytes_extracted, error = extract_jsonl_from_zip(src_path, dest_path, dry_run)

        if success:
            result["bytes"] = bytes_extracted
            result["status"] = "extracted" if not dry_run else "would_extract"
        else:
            result["status"] = "error"
            result["error"] = error
    else:
        # Already a plain .jsonl file, just copy
        success, bytes_copied, error = copy_jsonl_file(src_path, dest_path, dry_run)

        if success:
            result["bytes"] = bytes_copied
            result["status"] = "copied" if not dry_run else "would_copy"
        else:
            result["status"] = "error"
            result["error"] = error

    return result


def format_bytes(bytes_count: Optional[int]) -> str:
    """Format bytes as human-readable string."""
    if bytes_count is None:
        return "N/A"

    for unit in ['B', 'KB', 'MB', 'GB']:
        if bytes_count < 1024.0:
            return f"{bytes_count:.1f} {unit}"
        bytes_count /= 1024.0
    return f"{bytes_count:.1f} TB"


def main():
    parser = argparse.ArgumentParser(
        description="Unzip GRID event archives from archive to hot cache",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Dry run with first 5 files
  python scripts/py/unzip_events_to_hot.py --dry-run --max 5

  # Extract all files
  python scripts/py/unzip_events_to_hot.py

  # Force overwrite existing files
  python scripts/py/unzip_events_to_hot.py --force

  # With custom paths
  python scripts/py/unzip_events_to_hot.py --archive-root F:\\custom --hot-root E:\\custom
"""
    )

    parser.add_argument(
        "--archive-root",
        type=str,
        help="Archive root directory (default: from .env.local GRID_ARCHIVE_ROOT)"
    )

    parser.add_argument(
        "--hot-root",
        type=str,
        help="Hot cache root directory (default: from .env.local GRID_HOT_ROOT)"
    )

    parser.add_argument(
        "--force",
        action="store_true",
        help="Force overwrite existing files"
    )

    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate extraction without writing files"
    )

    parser.add_argument(
        "--max",
        type=int,
        help="Maximum number of files to process (for testing)"
    )

    args = parser.parse_args()

    # Load environment variables from .env.local
    load_dotenv(".env.local")

    # Get paths from args or environment
    archive_root_str = args.archive_root or os.getenv("GRID_ARCHIVE_ROOT")
    hot_root_str = args.hot_root or os.getenv("GRID_HOT_ROOT")

    # Validate arguments
    if not archive_root_str:
        print("ERROR: --archive-root is required (or set GRID_ARCHIVE_ROOT in .env.local)")
        sys.exit(1)

    if not hot_root_str:
        print("ERROR: --hot-root is required (or set GRID_HOT_ROOT in .env.local)")
        sys.exit(1)

    archive_root = Path(archive_root_str)
    hot_root = Path(hot_root_str)

    # Validate paths exist
    if not archive_root.exists():
        print(f"ERROR: Archive root does not exist: {archive_root}")
        sys.exit(1)

    # Print configuration
    print("=" * 80)
    print("GRID Event Archive Extractor")
    print("=" * 80)
    print(f"Archive root: {archive_root}")
    print(f"Hot cache root: {hot_root}")
    print(f"Force overwrite: {args.force}")
    print(f"Dry run: {args.dry_run}")
    if args.max:
        print(f"Max files: {args.max}")
    print()

    # Find all event archives
    archive_files = find_event_archives(archive_root, args.max)

    if not archive_files:
        print("No event archive files found!")
        sys.exit(0)

    print()
    print("=" * 80)
    print("Processing Archives")
    print("=" * 80)

    # Process each archive
    results = []
    stats = {
        "extracted": 0,
        "copied": 0,
        "skipped": 0,
        "errors": 0,
        "total_bytes": 0
    }

    for i, src_path in enumerate(archive_files, 1):
        print(f"\n[{i}/{len(archive_files)}] {src_path.name}")
        print(f"  Source: {src_path}")

        result = process_archive(
            src_path,
            archive_root,
            hot_root,
            force=args.force,
            dry_run=args.dry_run
        )

        results.append(result)

        # Update stats
        status = result["status"]
        if status in ["extracted", "would_extract"]:
            stats["extracted"] += 1
        elif status in ["copied", "would_copy"]:
            stats["copied"] += 1
        elif status == "skipped":
            stats["skipped"] += 1
        elif status == "error":
            stats["errors"] += 1

        if result["bytes"]:
            stats["total_bytes"] += result["bytes"]

        # Print result
        print(f"  Destination: {result['dstPath']}")
        print(f"  Status: {status}")
        if result["bytes"]:
            print(f"  Size: {format_bytes(result['bytes'])}")
        if result["error"]:
            print(f"  Error: {result['error']}")

    # Write manifest
    manifest_path = hot_root / "manifest_extracted.json"

    if not args.dry_run:
        hot_root.mkdir(parents=True, exist_ok=True)
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(results, f, indent=2, ensure_ascii=False)
        print(f"\nManifest written to: {manifest_path}")
    else:
        print(f"\n[DRY RUN] Would write manifest to: {manifest_path}")

    # Print summary
    print()
    print("=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"Total files found: {len(archive_files)}")
    print(f"Extracted from ZIP: {stats['extracted']}")
    print(f"Copied (already .jsonl): {stats['copied']}")
    print(f"Skipped (existing): {stats['skipped']}")
    print(f"Errors: {stats['errors']}")
    print(f"Total data: {format_bytes(stats['total_bytes'])}")

    if args.dry_run:
        print("\n[DRY RUN] No files were actually written")

    print()

    # Exit with error code if there were errors
    if stats['errors'] > 0:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
