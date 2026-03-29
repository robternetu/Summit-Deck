"""
Generate a complete report of all unique GRID event types across Valorant events.jsonl files.

Outputs:
- all_event_types.txt: Sorted list of unique event types
- event_types_global.csv: Global event type counts and series counts
- event_types_by_series.csv: Per-series event type counts
- run_summary.json: Run metadata and statistics
"""
import argparse
import csv
import json
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Set, Optional, Tuple


def parse_series_path(series_path: Path, root: Path) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Extract year, tournamentId, and seriesId from series path.

    Expected structure: {root}/{year}/tournaments/{tournamentId}/series/{seriesId}

    Args:
        series_path: Path to series directory
        root: Root directory

    Returns:
        Tuple of (year, tournamentId, seriesId) or (None, None, None) if parsing fails
    """
    try:
        rel_path = series_path.relative_to(root)
        parts = rel_path.parts

        # Expected: year/tournaments/tournamentId/series/seriesId
        if len(parts) >= 5 and parts[1] == "tournaments" and parts[3] == "series":
            year = parts[0]
            tournament_id = parts[2]
            series_id = parts[4]
            return (year, tournament_id, series_id)
    except (ValueError, IndexError):
        pass

    return (None, None, None)


def find_series_directories(
    root: Path,
    years_filter: Optional[Set[str]] = None,
    max_series: int = 0
) -> List[Path]:
    """
    Find all series directories containing events.jsonl.

    Args:
        root: Root directory to search
        years_filter: Set of year strings to filter by (e.g., {"2024", "2025"})
        max_series: Maximum number of series to find (0 = no limit)

    Returns:
        List of series directory paths
    """
    series_dirs = []

    print(f"Scanning {root} for series directories...")
    if years_filter:
        print(f"Filtering by years: {sorted(years_filter)}")

    # Walk through year/tournaments/*/series/* structure
    for events_file in root.rglob("series/*/events.jsonl"):
        series_dir = events_file.parent

        # Apply year filter if specified
        if years_filter:
            year, _, _ = parse_series_path(series_dir, root)
            if year not in years_filter:
                continue

        series_dirs.append(series_dir)

        if max_series > 0 and len(series_dirs) >= max_series:
            print(f"Reached max-series limit of {max_series}")
            break

    print(f"Found {len(series_dirs)} series directories with events.jsonl")
    return series_dirs


def process_series(
    series_dir: Path,
    root: Path,
    max_lines: int = 0,
    max_events_remaining: Optional[int] = None
) -> Optional[Dict]:
    """
    Process a single series directory and extract event types.

    Args:
        series_dir: Path to series directory
        root: Root directory
        max_lines: Maximum lines to process (0 = no limit)
        max_events_remaining: Maximum events still allowed to process (None = no limit)

    Returns:
        Dictionary with metadata and event type counts, or None if error
    """
    events_file = series_dir / "events.jsonl"

    if not events_file.exists():
        return None

    # Parse series path components
    year, tournament_id, series_id = parse_series_path(series_dir, root)

    # Initialize collectors
    event_type_counts = defaultdict(int)
    lines_processed = 0
    events_processed = 0

    try:
        with open(events_file, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                # Check line limit
                if max_lines > 0 and lines_processed >= max_lines:
                    break

                # Check global events limit
                if max_events_remaining is not None and max_events_remaining <= 0:
                    break

                line = line.strip()
                if not line:
                    continue

                try:
                    line_obj = json.loads(line)

                    # Each line has an events[] array
                    if "events" not in line_obj or not isinstance(line_obj["events"], list):
                        continue

                    for event in line_obj["events"]:
                        # Check global events limit
                        if max_events_remaining is not None and max_events_remaining <= 0:
                            break

                        if not isinstance(event, dict) or "type" not in event:
                            continue

                        event_type = event["type"]
                        event_type_counts[event_type] += 1
                        events_processed += 1

                        if max_events_remaining is not None:
                            max_events_remaining -= 1

                except json.JSONDecodeError as e:
                    print(f"  Warning: JSON decode error on line {line_num}: {e}")
                    continue

                lines_processed += 1

    except Exception as e:
        print(f"  Error processing {events_file}: {e}")
        return None

    return {
        "series_dir": str(series_dir),
        "year": year,
        "tournament_id": tournament_id,
        "series_id": series_id,
        "lines_processed": lines_processed,
        "events_processed": events_processed,
        "event_type_counts": dict(event_type_counts)
    }


def aggregate_results(results: List[Dict]) -> Tuple[Dict, Dict, Set]:
    """
    Aggregate results from all series.

    Args:
        results: List of per-series results

    Returns:
        Tuple of (global_counts, series_counts, all_types)
        - global_counts: {event_type: total_count}
        - series_counts: {event_type: set of series_ids}
        - all_types: set of all unique event types
    """
    global_counts = defaultdict(int)
    series_counts = defaultdict(set)
    all_types = set()

    for result in results:
        if not result:
            continue

        series_id = result.get("series_id", "unknown")

        for event_type, count in result["event_type_counts"].items():
            global_counts[event_type] += count
            series_counts[event_type].add(series_id)
            all_types.add(event_type)

    return global_counts, series_counts, all_types


def write_outputs(
    results: List[Dict],
    global_counts: Dict[str, int],
    series_counts: Dict[str, Set[str]],
    all_types: Set[str],
    out_dir: Path,
    run_config: Dict
) -> None:
    """
    Write all output files.

    Args:
        results: List of per-series results
        global_counts: Global event type counts
        series_counts: Series counts per event type
        all_types: Set of all unique event types
        out_dir: Output directory
        run_config: Run configuration for summary
    """
    # 1. all_event_types.txt
    types_file = out_dir / "all_event_types.txt"
    with open(types_file, 'w', encoding='utf-8') as f:
        for event_type in sorted(all_types):
            f.write(f"{event_type}\n")
    print(f"Wrote: {types_file}")

    # 2. event_types_global.csv
    global_csv = out_dir / "event_types_global.csv"
    with open(global_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["eventType", "totalCount", "seriesCount"])

        # Sort by totalCount descending
        sorted_types = sorted(
            global_counts.items(),
            key=lambda x: x[1],
            reverse=True
        )

        for event_type, total_count in sorted_types:
            series_count = len(series_counts[event_type])
            writer.writerow([event_type, total_count, series_count])

    print(f"Wrote: {global_csv}")

    # 3. event_types_by_series.csv
    series_csv = out_dir / "event_types_by_series.csv"
    with open(series_csv, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["year", "tournamentId", "seriesId", "eventType", "count"])

        # Write one row per (seriesId, eventType)
        for result in results:
            if not result:
                continue

            year = result.get("year", "")
            tournament_id = result.get("tournament_id", "")
            series_id = result.get("series_id", "")

            for event_type, count in sorted(result["event_type_counts"].items()):
                writer.writerow([year, tournament_id, series_id, event_type, count])

    print(f"Wrote: {series_csv}")

    # 4. run_summary.json
    total_lines = sum(r["lines_processed"] for r in results if r)
    total_events = sum(r["events_processed"] for r in results if r)

    series_scanned = [
        {
            "year": r.get("year", ""),
            "tournament_id": r.get("tournament_id", ""),
            "series_id": r.get("series_id", ""),
            "lines_processed": r["lines_processed"],
            "events_processed": r["events_processed"]
        }
        for r in results if r
    ]

    summary = {
        "run_config": run_config,
        "series_scanned": series_scanned,
        "total_series": len(series_scanned),
        "total_lines_processed": total_lines,
        "total_events_processed": total_events,
        "unique_event_types_count": len(all_types)
    }

    summary_file = out_dir / "run_summary.json"
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)

    print(f"Wrote: {summary_file}")


def print_console_summary(
    global_counts: Dict[str, int],
    all_types: Set[str],
    total_series: int,
    total_events: int
) -> None:
    """
    Print summary to console.

    Args:
        global_counts: Global event type counts
        all_types: Set of all unique event types
        total_series: Total series scanned
        total_events: Total events processed
    """
    print()
    print("=" * 80)
    print("RUN SUMMARY")
    print("=" * 80)
    print(f"Series scanned: {total_series}")
    print(f"Total events processed: {total_events:,}")
    print(f"Unique event types: {len(all_types)}")
    print()

    # Sort by count
    sorted_types = sorted(
        global_counts.items(),
        key=lambda x: x[1],
        reverse=True
    )

    # Top 15
    print("=" * 80)
    print("TOP 15 EVENT TYPES")
    print("=" * 80)
    for i, (event_type, count) in enumerate(sorted_types[:15], 1):
        print(f"{i:2d}. {event_type:50s} {count:12,d}")

    print()

    # Bottom 15
    print("=" * 80)
    print("BOTTOM 15 EVENT TYPES")
    print("=" * 80)
    bottom_15 = sorted_types[-15:] if len(sorted_types) > 15 else sorted_types
    for i, (event_type, count) in enumerate(bottom_15, 1):
        print(f"{i:2d}. {event_type:50s} {count:12,d}")

    print()


def main():
    parser = argparse.ArgumentParser(
        description="Generate complete report of GRID event types",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Test with 5 series from 2024-2025, max 5000 lines per file
  python scripts/py/list_event_types.py --years 2024,2025 --max-series 5 --max-lines-per-file 5000

  # Full analysis of 2024-2025 data
  python scripts/py/list_event_types.py --years 2024,2025

  # Custom root with max events cap
  python scripts/py/list_event_types.py --root /path/to/hot --max-events 100000

  # Print all types to console at end
  python scripts/py/list_event_types.py --years 2024,2025 --print-types
"""
    )

    parser.add_argument(
        "--root",
        type=str,
        default=os.environ.get("GRID_HOT_ROOT"),
        help="Root directory of GRID hot cache (default: GRID_HOT_ROOT env var)"
    )

    parser.add_argument(
        "--out-dir",
        type=str,
        default="scripts/py/out",
        help="Output directory (default: scripts/py/out)"
    )

    parser.add_argument(
        "--years",
        type=str,
        help="Comma-separated list of years to filter (e.g., 2024,2025)"
    )

    parser.add_argument(
        "--max-series",
        type=int,
        default=0,
        help="Maximum number of series to process (default: 0 = no limit)"
    )

    parser.add_argument(
        "--max-lines-per-file",
        type=int,
        default=0,
        help="Maximum lines to read per events.jsonl file (default: 0 = no limit)"
    )

    parser.add_argument(
        "--max-events",
        type=int,
        help="Maximum total events to process across all series"
    )

    parser.add_argument(
        "--print-types",
        action="store_true",
        help="Print all event types to console at end"
    )

    args = parser.parse_args()

    # Validate root
    if not args.root:
        print("ERROR: --root is required (or set GRID_HOT_ROOT environment variable)")
        sys.exit(1)

    root = Path(args.root)
    if not root.exists():
        print(f"ERROR: Root directory does not exist: {root}")
        sys.exit(1)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Parse years filter
    years_filter = None
    if args.years:
        years_filter = set(args.years.split(","))

    # Print configuration
    print("=" * 80)
    print("GRID EVENT TYPE ANALYSIS")
    print("=" * 80)
    print(f"Root: {root}")
    print(f"Output dir: {out_dir}")
    print(f"Years filter: {sorted(years_filter) if years_filter else 'None (all years)'}")
    print(f"Max series: {args.max_series if args.max_series > 0 else 'No limit'}")
    print(f"Max lines per file: {args.max_lines_per_file if args.max_lines_per_file > 0 else 'No limit'}")
    print(f"Max events: {args.max_events if args.max_events else 'No limit'}")
    print()

    # Find series directories
    series_dirs = find_series_directories(root, years_filter, args.max_series)

    if not series_dirs:
        print("No series directories found!")
        sys.exit(1)

    print()
    print("=" * 80)
    print("PROCESSING SERIES")
    print("=" * 80)

    # Process each series
    results = []
    max_events_remaining = args.max_events

    for i, series_dir in enumerate(series_dirs, 1):
        print(f"\n[{i}/{len(series_dirs)}] {series_dir.name}")

        result = process_series(
            series_dir,
            root,
            args.max_lines_per_file,
            max_events_remaining
        )

        if result:
            results.append(result)
            print(f"  Lines: {result['lines_processed']:,}, Events: {result['events_processed']:,}")

            if max_events_remaining is not None:
                max_events_remaining -= result['events_processed']
                if max_events_remaining <= 0:
                    print(f"\nReached max-events limit of {args.max_events}")
                    break
        else:
            print(f"  Skipped (no valid data)")

    if not results:
        print("\nNo valid results!")
        sys.exit(1)

    # Aggregate results
    print()
    print("=" * 80)
    print("AGGREGATING RESULTS")
    print("=" * 80)

    global_counts, series_counts, all_types = aggregate_results(results)

    # Write outputs
    print()
    print("=" * 80)
    print("WRITING OUTPUTS")
    print("=" * 80)

    run_config = {
        "root": str(root),
        "years_filter": sorted(years_filter) if years_filter else None,
        "max_series": args.max_series,
        "max_lines_per_file": args.max_lines_per_file,
        "max_events": args.max_events
    }

    write_outputs(results, global_counts, series_counts, all_types, out_dir, run_config)

    # Print console summary
    total_events = sum(r["events_processed"] for r in results if r)
    print_console_summary(global_counts, all_types, len(results), total_events)

    # Optionally print all types
    if args.print_types:
        print("=" * 80)
        print("ALL EVENT TYPES (A-Z)")
        print("=" * 80)
        for event_type in sorted(all_types):
            print(event_type)
        print()


if __name__ == "__main__":
    main()
