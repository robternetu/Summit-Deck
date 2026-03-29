"""
Inventory GRID event schemas from hot cache.

Scans events.jsonl files and produces:
- Event type frequency counts
- Top-level keys per event type
- Round number inference hints
- Sample events per type
"""
import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Set, Optional, Any


def find_series_directories(root: Path, max_series: Optional[int] = None) -> List[Path]:
    """
    Find all series directories containing events.jsonl.

    Args:
        root: Root directory to search
        max_series: Maximum number of series to find

    Returns:
        List of series directory paths
    """
    series_dirs = []

    print(f"Scanning {root} for series directories...")

    # Walk through year/tournaments/*/series/* structure
    for events_file in root.rglob("series/*/events.jsonl"):
        series_dir = events_file.parent
        series_dirs.append(series_dir)

        if max_series and len(series_dirs) >= max_series:
            print(f"Reached max-series limit of {max_series}")
            break

    print(f"Found {len(series_dirs)} series directories with events.jsonl")
    return series_dirs


def extract_keys(obj: Any, prefix: str = "") -> Set[str]:
    """
    Recursively extract all keys from a nested object.

    Args:
        obj: Object to extract keys from
        prefix: Key prefix for nested objects

    Returns:
        Set of dot-notation key paths
    """
    keys = set()

    if isinstance(obj, dict):
        for key, value in obj.items():
            full_key = f"{prefix}.{key}" if prefix else key
            keys.add(full_key)

            # Recurse into nested objects (but limit depth)
            if isinstance(value, dict) and prefix.count('.') < 2:
                keys.update(extract_keys(value, full_key))
            elif isinstance(value, list) and value and isinstance(value[0], dict) and prefix.count('.') < 2:
                # Sample first item in array
                keys.update(extract_keys(value[0], f"{full_key}[]"))

    return keys


def check_round_hints(event: Dict, line_obj: Dict) -> Dict[str, bool]:
    """
    Check for round number inference hints in event and line context.

    Args:
        event: Individual event object
        line_obj: Parent line object containing the event

    Returns:
        Dict of hints found
    """
    hints = {
        "has_sequenceNumber": False,
        "has_roundNumber": False,
        "has_gameId": False,
        "has_nested_round": False
    }

    # Check line-level sequenceNumber
    if "sequenceNumber" in line_obj:
        hints["has_sequenceNumber"] = True

    # Check for gameId in various places
    if "seriesStateDelta" in line_obj and isinstance(line_obj["seriesStateDelta"], dict):
        if "gameId" in line_obj["seriesStateDelta"]:
            hints["has_gameId"] = True

    # Check event.target.stateDelta for gameId
    if "target" in event and isinstance(event["target"], dict):
        if "stateDelta" in event["target"] and isinstance(event["target"]["stateDelta"], dict):
            if "gameId" in event["target"]["stateDelta"]:
                hints["has_gameId"] = True

    # Check event.actor.stateDelta for gameId
    if "actor" in event and isinstance(event["actor"], dict):
        if "stateDelta" in event["actor"] and isinstance(event["actor"]["stateDelta"], dict):
            if "gameId" in event["actor"]["stateDelta"]:
                hints["has_gameId"] = True

    # Check for roundNumber in stateDelta
    def check_round_in_dict(d: Dict, key_path: str = ""):
        if isinstance(d, dict):
            for k, v in d.items():
                if k == "roundNumber":
                    hints["has_roundNumber"] = True
                if "round" in k.lower() and isinstance(v, (int, str)):
                    hints["has_nested_round"] = True
                if isinstance(v, dict) and key_path.count('.') < 2:
                    check_round_in_dict(v, f"{key_path}.{k}" if key_path else k)

    check_round_in_dict(event)

    return hints


def process_series(
    series_dir: Path,
    max_lines: Optional[int] = None
) -> Dict:
    """
    Process a single series directory.

    Args:
        series_dir: Path to series directory
        max_lines: Maximum lines to process per file

    Returns:
        Dictionary with event counts, keys, samples, and hints
    """
    events_file = series_dir / "events.jsonl"

    if not events_file.exists():
        return None

    # Initialize collectors
    event_type_counts = defaultdict(int)
    event_keys_by_type = defaultdict(set)
    samples_by_type = {}
    round_hints_by_type = defaultdict(lambda: defaultdict(int))

    lines_processed = 0
    events_processed = 0

    try:
        with open(events_file, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                if max_lines and lines_processed >= max_lines:
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
                        if not isinstance(event, dict) or "type" not in event:
                            continue

                        event_type = event["type"]
                        event_type_counts[event_type] += 1
                        events_processed += 1

                        # Collect keys
                        keys = extract_keys(event)
                        event_keys_by_type[event_type].update(keys)

                        # Store sample if we don't have one yet
                        if event_type not in samples_by_type:
                            samples_by_type[event_type] = event

                        # Check round hints
                        hints = check_round_hints(event, line_obj)
                        for hint_name, hint_value in hints.items():
                            if hint_value:
                                round_hints_by_type[event_type][hint_name] += 1

                except json.JSONDecodeError as e:
                    print(f"  Warning: JSON decode error on line {line_num}: {e}")
                    continue

                lines_processed += 1

    except Exception as e:
        print(f"  Error processing {events_file}: {e}")
        return None

    return {
        "series_dir": str(series_dir),
        "lines_processed": lines_processed,
        "events_processed": events_processed,
        "event_type_counts": dict(event_type_counts),
        "event_keys_by_type": {k: list(v) for k, v in event_keys_by_type.items()},
        "samples_by_type": samples_by_type,
        "round_hints_by_type": {k: dict(v) for k, v in round_hints_by_type.items()}
    }


def merge_results(results: List[Dict]) -> Dict:
    """
    Merge results from multiple series.

    Args:
        results: List of per-series results

    Returns:
        Merged results dictionary
    """
    merged_counts = defaultdict(int)
    merged_keys = defaultdict(set)
    merged_samples = {}
    merged_hints = defaultdict(lambda: defaultdict(int))

    total_lines = 0
    total_events = 0

    for result in results:
        if not result:
            continue

        total_lines += result["lines_processed"]
        total_events += result["events_processed"]

        # Merge counts
        for event_type, count in result["event_type_counts"].items():
            merged_counts[event_type] += count

        # Merge keys
        for event_type, keys in result["event_keys_by_type"].items():
            merged_keys[event_type].update(keys)

        # Store samples (one per type)
        for event_type, sample in result["samples_by_type"].items():
            if event_type not in merged_samples:
                merged_samples[event_type] = sample

        # Merge hints
        for event_type, hints in result["round_hints_by_type"].items():
            for hint_name, hint_count in hints.items():
                merged_hints[event_type][hint_name] += hint_count

    return {
        "total_lines_processed": total_lines,
        "total_events_processed": total_events,
        "event_type_counts": dict(merged_counts),
        "event_keys_by_type": {k: sorted(list(v)) for k, v in merged_keys.items()},
        "samples_by_type": merged_samples,
        "round_hint_stats": {k: dict(v) for k, v in merged_hints.items()}
    }


def main():
    parser = argparse.ArgumentParser(
        description="Inventory GRID event schemas from hot cache",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Scan 3 series, max 2000 lines each
  python scripts/py/inventory_events.py --max-series 3 --max-lines-per-file 2000

  # Scan 10 series (default)
  python scripts/py/inventory_events.py

  # Scan all series in custom location
  python scripts/py/inventory_events.py --root /path/to/hot --max-series 100
"""
    )

    parser.add_argument(
        "--root",
        type=str,
        default=r"E:\A-c9-StratOS\grid-cache\hot",
        help="Root directory of GRID hot cache"
    )

    parser.add_argument(
        "--max-series",
        type=int,
        default=10,
        help="Maximum number of series to scan"
    )

    parser.add_argument(
        "--max-lines-per-file",
        type=int,
        default=20000,
        help="Maximum lines to read per events.jsonl file"
    )

    parser.add_argument(
        "--out-dir",
        type=str,
        default="scripts/py/out",
        help="Output directory for results"
    )

    args = parser.parse_args()

    root = Path(args.root)
    out_dir = Path(args.out_dir)

    # Validate root exists
    if not root.exists():
        print(f"ERROR: Root directory does not exist: {root}")
        sys.exit(1)

    # Create output directory
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("GRID Events Schema Inventory")
    print("=" * 80)
    print(f"Root: {root}")
    print(f"Max series: {args.max_series}")
    print(f"Max lines per file: {args.max_lines_per_file}")
    print(f"Output dir: {out_dir}")
    print()

    # Find series directories
    series_dirs = find_series_directories(root, args.max_series)

    if not series_dirs:
        print("No series directories found!")
        sys.exit(1)

    print()
    print("=" * 80)
    print("Processing Series")
    print("=" * 80)

    # Process each series
    results = []
    series_scanned = []

    for i, series_dir in enumerate(series_dirs, 1):
        print(f"\n[{i}/{len(series_dirs)}] {series_dir}")

        result = process_series(series_dir, args.max_lines_per_file)

        if result:
            results.append(result)
            series_scanned.append({
                "path": str(series_dir),
                "lines_processed": result["lines_processed"],
                "events_processed": result["events_processed"]
            })
            print(f"  Lines: {result['lines_processed']}, Events: {result['events_processed']}")
        else:
            print(f"  Skipped (no valid data)")

    if not results:
        print("\nNo valid results!")
        sys.exit(1)

    # Merge results
    print()
    print("=" * 80)
    print("Merging Results")
    print("=" * 80)

    merged = merge_results(results)

    print(f"Total lines processed: {merged['total_lines_processed']}")
    print(f"Total events processed: {merged['total_events_processed']}")
    print(f"Unique event types: {len(merged['event_type_counts'])}")

    # Save schema_inventory.json
    inventory_path = out_dir / "schema_inventory.json"
    with open(inventory_path, 'w', encoding='utf-8') as f:
        json.dump(merged, f, indent=2, ensure_ascii=False)
    print(f"\nSaved: {inventory_path}")

    # Save top_event_types.csv
    csv_path = out_dir / "top_event_types.csv"
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(["type", "count"])

        # Sort by count descending
        sorted_types = sorted(
            merged['event_type_counts'].items(),
            key=lambda x: x[1],
            reverse=True
        )

        for event_type, count in sorted_types:
            writer.writerow([event_type, count])

    print(f"Saved: {csv_path}")

    # Save series_scanned.json
    series_path = out_dir / "series_scanned.json"
    with open(series_path, 'w', encoding='utf-8') as f:
        json.dump(series_scanned, f, indent=2, ensure_ascii=False)
    print(f"Saved: {series_path}")

    # Print top event types
    print()
    print("=" * 80)
    print("Top 10 Event Types")
    print("=" * 80)

    for i, (event_type, count) in enumerate(sorted_types[:10], 1):
        print(f"{i:2d}. {event_type:50s} {count:8,d}")

    print()


if __name__ == "__main__":
    main()
