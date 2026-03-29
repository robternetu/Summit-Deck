"""
Batch extract evidence_v1.json from multiple GRID series.

Walks series directories under GRID_HOT_ROOT, extracts evidence for each,
and validates the results.
"""
import argparse
import json
import sys
import subprocess
from pathlib import Path
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone


def find_series_directories(
    root: Path,
    max_series: Optional[int] = None,
    years: Optional[List[str]] = None,
    tournament_ids: Optional[List[str]] = None
) -> List[Path]:
    """
    Find series directories containing events.jsonl.

    Args:
        root: Root directory to search
        max_series: Maximum number of series to find
        years: Filter by year directories (e.g., ["2024"])
        tournament_ids: Filter by tournament IDs

    Returns:
        List of series directory paths
    """
    series_dirs = []

    print(f"Scanning {root} for series directories...")

    # Determine which year directories to search
    if years:
        year_dirs = [root / year for year in years if (root / year).exists()]
    else:
        # Search all year directories (assume 4-digit year format)
        year_dirs = [d for d in root.iterdir() if d.is_dir() and d.name.isdigit() and len(d.name) == 4]

    # Walk through year/tournaments/*/series/* structure
    for year_dir in year_dirs:
        tournaments_dir = year_dir / "tournaments"

        if not tournaments_dir.exists():
            continue

        # Get tournament directories
        if tournament_ids:
            tournament_dirs = [
                tournaments_dir / tid
                for tid in tournament_ids
                if (tournaments_dir / tid).exists()
            ]
        else:
            tournament_dirs = [d for d in tournaments_dir.iterdir() if d.is_dir()]

        # Find series in each tournament
        for tournament_dir in tournament_dirs:
            series_base_dir = tournament_dir / "series"

            if not series_base_dir.exists():
                continue

            for series_dir in series_base_dir.iterdir():
                if not series_dir.is_dir():
                    continue

                events_file = series_dir / "events.jsonl"
                if events_file.exists():
                    series_dirs.append(series_dir)

                    if max_series and len(series_dirs) >= max_series:
                        print(f"Reached max-series limit of {max_series}")
                        return series_dirs

    print(f"Found {len(series_dirs)} series directories with events.jsonl")
    return series_dirs


def extract_series(
    series_dir: Path,
    out_dir: Path,
    max_lines: Optional[int] = None,
    iso_threshold: float = 2500.0
) -> Dict[str, Any]:
    """
    Extract evidence for a single series.

    Args:
        series_dir: Path to series directory
        out_dir: Output directory for evidence files
        max_lines: Optional max lines to process
        iso_threshold: Distance threshold for isolated deaths

    Returns:
        Dict with extraction results
    """
    series_id = series_dir.name

    result = {
        "seriesId": series_id,
        "seriesDir": str(series_dir),
        "status": "unknown",
        "error": None,
        "evidenceFile": None,
        "stats": {}
    }

    # Build command
    cmd = [
        "python",
        "scripts/py/extract_evidence_v1.py",
        "--series-dir", str(series_dir),
        "--out-dir", str(out_dir)
    ]

    if max_lines:
        cmd.extend(["--max-lines", str(max_lines)])

    if iso_threshold != 2500.0:
        cmd.extend(["--iso-threshold", str(iso_threshold)])

    # Run extraction
    try:
        proc_result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120  # 2 minute timeout per series
        )

        if proc_result.returncode == 0:
            result["status"] = "success"

            # Parse output to get stats
            output_lines = proc_result.stdout.strip().split('\n')
            for line in output_lines:
                if line.startswith("Games:"):
                    result["stats"]["games"] = int(line.split(":")[1].strip())
                elif line.startswith("Rounds:"):
                    result["stats"]["rounds"] = int(line.split(":")[1].strip())
                elif line.startswith("Kills:"):
                    result["stats"]["kills"] = int(line.split(":")[1].strip())
                elif line.startswith("Plants:"):
                    result["stats"]["plants"] = int(line.split(":")[1].strip())
                elif line.startswith("Players:"):
                    result["stats"]["players"] = int(line.split(":")[1].strip())

            result["evidenceFile"] = str(out_dir / f"{series_id}_evidence_v1.json")
        else:
            result["status"] = "error"
            result["error"] = f"Extraction failed: {proc_result.stderr[:200]}"

    except subprocess.TimeoutExpired:
        result["status"] = "timeout"
        result["error"] = "Extraction timed out after 120 seconds"
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"Extraction error: {str(e)}"

    return result


def validate_evidence_file(evidence_path: Path, series_dir: Optional[Path] = None) -> Dict[str, Any]:
    """
    Validate an evidence file.

    Args:
        evidence_path: Path to evidence file
        series_dir: Optional series directory for end_state.json

    Returns:
        Dict with validation results
    """
    result = {
        "evidenceFile": str(evidence_path),
        "status": "unknown",
        "errors": 0,
        "warnings": 0
    }

    # Build command
    cmd = [
        "python",
        "scripts/py/validate_evidence_v1.py",
        "--evidence", str(evidence_path)
    ]

    if series_dir:
        cmd.extend(["--series-dir", str(series_dir)])

    # Run validation
    try:
        proc_result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )

        if proc_result.returncode == 0:
            result["status"] = "PASS"
        else:
            # Parse output to count errors and warnings
            output = proc_result.stdout

            if "ERRORS" in output:
                # Try to extract error count
                for line in output.split('\n'):
                    if "ERRORS (" in line:
                        try:
                            count = int(line.split("(")[1].split(")")[0])
                            result["errors"] = count
                        except:
                            result["errors"] = 1

            if "WARNINGS" in output:
                for line in output.split('\n'):
                    if "WARNINGS (" in line:
                        try:
                            count = int(line.split("(")[1].split(")")[0])
                            result["warnings"] = count
                        except:
                            result["warnings"] = 1

            if result["errors"] > 0:
                result["status"] = "FAIL"
            elif result["warnings"] > 0:
                result["status"] = "WARN"
            else:
                result["status"] = "PASS"

    except subprocess.TimeoutExpired:
        result["status"] = "timeout"
    except Exception as e:
        result["status"] = "error"

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Batch extract evidence_v1.json from GRID series",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract from first 5 series
  python scripts/py/batch_extract_evidence_v1.py --root "E:\\grid-cache\\hot" --max-series 5

  # Extract from 2024 only
  python scripts/py/batch_extract_evidence_v1.py --root "E:\\grid-cache\\hot" --years 2024

  # Extract specific tournaments
  python scripts/py/batch_extract_evidence_v1.py --root "E:\\grid-cache\\hot" --tournament-ids 757073 757074

  # Quick test with max lines
  python scripts/py/batch_extract_evidence_v1.py --root "E:\\grid-cache\\hot" --max-series 3 --max-lines 10000
"""
    )

    parser.add_argument(
        "--root",
        type=str,
        required=True,
        help="Root directory of GRID hot cache (GRID_HOT_ROOT)"
    )

    parser.add_argument(
        "--max-series",
        type=int,
        help="Maximum number of series to extract"
    )

    parser.add_argument(
        "--years",
        type=str,
        nargs="+",
        help="Filter by year directories (e.g., 2024)"
    )

    parser.add_argument(
        "--tournament-ids",
        type=str,
        nargs="+",
        help="Filter by tournament IDs"
    )

    parser.add_argument(
        "--out-dir",
        type=str,
        default="scripts/py/out",
        help="Output directory (default: scripts/py/out)"
    )

    parser.add_argument(
        "--max-lines",
        type=int,
        help="Maximum lines to process per series (for testing)"
    )

    parser.add_argument(
        "--iso-threshold",
        type=float,
        default=2500.0,
        help="Distance threshold for isolated deaths (default: 2500)"
    )

    parser.add_argument(
        "--skip-validation",
        action="store_true",
        help="Skip validation step"
    )

    args = parser.parse_args()

    # Validate root directory
    root = Path(args.root)
    if not root.exists():
        print(f"ERROR: Root directory does not exist: {root}")
        sys.exit(1)

    # Create output directory
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("GRID Batch Evidence Extractor")
    print("=" * 80)
    print(f"Root: {root}")
    if args.max_series:
        print(f"Max series: {args.max_series}")
    if args.years:
        print(f"Years: {', '.join(args.years)}")
    if args.tournament_ids:
        print(f"Tournament IDs: {', '.join(args.tournament_ids)}")
    print(f"Output dir: {out_dir}")
    if args.max_lines:
        print(f"Max lines per series: {args.max_lines}")
    print()

    # Find series directories
    series_dirs = find_series_directories(
        root,
        max_series=args.max_series,
        years=args.years,
        tournament_ids=args.tournament_ids
    )

    if not series_dirs:
        print("No series directories found!")
        sys.exit(0)

    print()
    print("=" * 80)
    print("Extracting Evidence")
    print("=" * 80)

    # Extract each series
    extraction_results = []

    for i, series_dir in enumerate(series_dirs, 1):
        series_id = series_dir.name
        print(f"\n[{i}/{len(series_dirs)}] Series {series_id}")
        print(f"  Path: {series_dir}")

        result = extract_series(
            series_dir,
            out_dir,
            max_lines=args.max_lines,
            iso_threshold=args.iso_threshold
        )

        extraction_results.append(result)

        print(f"  Status: {result['status']}")
        if result['status'] == 'success':
            stats = result.get('stats', {})
            print(f"  Games: {stats.get('games', 'N/A')}, "
                  f"Rounds: {stats.get('rounds', 'N/A')}, "
                  f"Kills: {stats.get('kills', 'N/A')}")
        elif result.get('error'):
            print(f"  Error: {result['error']}")

    # Validate extracted files
    validation_results = []

    if not args.skip_validation:
        print()
        print("=" * 80)
        print("Validating Evidence Files")
        print("=" * 80)

        for i, ext_result in enumerate(extraction_results, 1):
            if ext_result['status'] != 'success' or not ext_result.get('evidenceFile'):
                continue

            evidence_path = Path(ext_result['evidenceFile'])
            if not evidence_path.exists():
                continue

            print(f"\n[{i}/{len(extraction_results)}] Validating {evidence_path.name}")

            # Get series directory for optional end_state.json check
            series_dir = Path(ext_result['seriesDir'])

            val_result = validate_evidence_file(evidence_path, series_dir)
            validation_results.append(val_result)

            print(f"  Status: {val_result['status']}")
            if val_result['errors'] > 0:
                print(f"  Errors: {val_result['errors']}")
            if val_result['warnings'] > 0:
                print(f"  Warnings: {val_result['warnings']}")

    # Write batch report
    batch_report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "root": str(root),
        "totalSeriesFound": len(series_dirs),
        "totalExtracted": sum(1 for r in extraction_results if r['status'] == 'success'),
        "totalFailed": sum(1 for r in extraction_results if r['status'] in ['error', 'timeout']),
        "extractionResults": extraction_results,
        "validationResults": validation_results,
        "validationSummary": {
            "passed": sum(1 for r in validation_results if r['status'] == 'PASS'),
            "warnings": sum(1 for r in validation_results if r['status'] == 'WARN'),
            "failed": sum(1 for r in validation_results if r['status'] == 'FAIL')
        }
    }

    batch_report_path = out_dir / "batch_extraction_report.json"
    with open(batch_report_path, 'w', encoding='utf-8') as f:
        json.dump(batch_report, f, indent=2)

    # Print summary
    print()
    print("=" * 80)
    print("BATCH EXTRACTION SUMMARY")
    print("=" * 80)
    print(f"Total series found: {len(series_dirs)}")
    print(f"Successfully extracted: {batch_report['totalExtracted']}")
    print(f"Failed: {batch_report['totalFailed']}")
    print()

    if validation_results:
        print("Validation Summary:")
        print(f"  Passed: {batch_report['validationSummary']['passed']}")
        print(f"  Warnings: {batch_report['validationSummary']['warnings']}")
        print(f"  Failed: {batch_report['validationSummary']['failed']}")
        print()

    print(f"Batch report written to: {batch_report_path}")
    print()

    # Exit with error if any extractions failed or validations failed
    if batch_report['totalFailed'] > 0:
        print("ERROR: Some extractions failed")
        sys.exit(1)
    elif batch_report['validationSummary']['failed'] > 0:
        print("ERROR: Some validations failed")
        sys.exit(1)
    else:
        print("SUCCESS: All extractions completed and validated")
        sys.exit(0)


if __name__ == "__main__":
    main()
