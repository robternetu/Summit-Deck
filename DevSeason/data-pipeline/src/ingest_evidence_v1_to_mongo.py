"""
Ingest evidence_v1.json into MongoDB Match documents.

Walks series directories, extracts evidence, validates, and upserts to MongoDB.
"""
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Dict, Any

import pymongo
from pymongo import MongoClient
from bson import ObjectId

# Import extraction and validation functions
from extract_evidence_v1 import extract_evidence
from validate_evidence_v1 import validate_evidence_file, ValidationResult


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


def extract_and_validate(
    series_dir: Path,
    max_lines: Optional[int] = None,
    iso_threshold: float = 2500.0
) -> Dict[str, Any]:
    """
    Extract evidence for a series and validate it.

    Args:
        series_dir: Path to series directory
        max_lines: Optional max lines to process
        iso_threshold: Distance threshold for isolated deaths

    Returns:
        Dict with status, evidence, and any errors
    """
    series_id = series_dir.name
    events_path = series_dir / "events.jsonl"

    result = {
        "seriesId": series_id,
        "seriesDir": str(series_dir),
        "status": "unknown",
        "error": None,
        "evidence": None,
        "tournamentId": series_dir.parent.parent.name if series_dir.parent.parent else None,
    }

    # Extract evidence
    try:
        evidence = extract_evidence(
            events_path,
            series_id,
            max_lines=max_lines,
            iso_threshold=iso_threshold
        )

        # Add extraction timestamp
        evidence["meta"]["extractedAt"] = datetime.now(timezone.utc).isoformat()

        result["evidence"] = evidence
        result["status"] = "extracted"

    except Exception as e:
        result["status"] = "extraction_failed"
        result["error"] = f"Extraction error: {str(e)}"
        return result

    # Validate evidence (in-memory, no file write needed)
    try:
        # Create a minimal validation result
        val_result = ValidationResult("in-memory")

        # Run basic validation checks
        from validate_evidence_v1 import validate_internal
        validate_internal(evidence, val_result)

        if not val_result.is_pass():
            result["status"] = "validation_failed"
            result["error"] = f"Validation failed: {', '.join(val_result.errors)}"
            return result

        result["status"] = "validated"

    except Exception as e:
        result["status"] = "validation_error"
        result["error"] = f"Validation error: {str(e)}"
        return result

    return result


def upsert_to_mongo(
    db: Any,
    series_id: str,
    tournament_id: Optional[str],
    evidence: Dict[str, Any],
    team_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Upsert evidence to MongoDB Match collection.

    Args:
        db: MongoDB database instance
        series_id: Series ID
        tournament_id: Tournament ID
        evidence: Evidence dictionary
        team_id: Optional team ID

    Returns:
        Dict with upsert result
    """
    result = {
        "seriesId": series_id,
        "status": "unknown",
        "matchId": None,
        "operation": None,
    }

    try:
        # Use lowercase 'matches' to match Mongoose auto-pluralization
        matches_collection = db.matches

        # Try to find existing match by gridSeriesId
        existing_match = matches_collection.find_one({"gridSeriesId": series_id})

        # Build analytics object
        analytics = {
            "evidence_v1": evidence,
            "evidence_v1_meta": {
                "extractedAt": evidence["meta"]["extractedAt"],
                "version": evidence["meta"]["version"],
                "extractor": "python/ingest_evidence_v1_to_mongo.py",
            }
        }

        if existing_match:
            # Update existing match
            match_id = existing_match["_id"]

            # Build players array from evidence
            players = []
            if evidence.get("players"):
                for p in evidence["players"]:
                    players.append({
                        "playerId": p["playerId"],
                        "playerName": p.get("playerName", f"Player {p['playerId']}"),
                        "kills": p["kills"],
                        "deaths": p["deaths"],
                    })

            update_result = matches_collection.update_one(
                {"_id": match_id},
                {
                    "$set": {
                        "analytics": analytics,
                        "players": players,
                        "tournamentId": tournament_id,
                        "updatedAt": datetime.now(timezone.utc),
                    }
                }
            )

            result["matchId"] = str(match_id)
            result["operation"] = "updated"
            result["status"] = "success"

        else:
            # Create new match document
            # Use first game's map name if available
            map_name = "Unknown"
            if evidence.get("games") and len(evidence["games"]) > 0:
                map_name = evidence["games"][0].get("mapName", "Unknown")

            # Use derived team names from evidence if available
            team_name = "Summit"
            opponent_name = "Unknown"

            if evidence.get("derived", {}).get("firstBloodStats"):
                fb_stats = evidence["derived"]["firstBloodStats"]
                if len(fb_stats) >= 2:
                    team_name = fb_stats[0].get("teamName", "Summit")
                    opponent_name = fb_stats[1].get("teamName", "Unknown")
                elif len(fb_stats) == 1:
                    team_name = fb_stats[0].get("teamName", "Summit")

            # Create a placeholder gridMatchId
            grid_match_id = f"grid_series_{series_id}"

            # Use provided team_id or create a placeholder ObjectId
            team_object_id = ObjectId(team_id) if team_id else ObjectId()

            new_match = {
                "gridMatchId": grid_match_id,
                "gridSeriesId": series_id,
                "tournamentId": tournament_id,
                "team": team_object_id,
                "opponentName": opponent_name,
                "map": map_name,
                "eventName": "GRID Import",
                "date": datetime.fromisoformat(evidence["meta"]["extractedAt"].replace("Z", "+00:00")),
                "analytics": analytics,
                "createdAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
            }

            # Add player stats if available
            if evidence.get("players"):
                players = []
                for p in evidence["players"]:
                    players.append({
                        "playerId": p["playerId"],
                        "playerName": p.get("playerName", f"Player {p['playerId']}"),
                        "kills": p["kills"],
                        "deaths": p["deaths"],
                    })
                new_match["players"] = players

            # Add round counts from derived stats
            if evidence.get("derived", {}).get("mapsStats"):
                total_rounds_won = {}
                total_rounds = 0

                for map_stat in evidence["derived"]["mapsStats"]:
                    team_id_str = map_stat.get("teamId")
                    rounds_won = map_stat.get("roundsWon", 0)
                    total_rounds = max(total_rounds, map_stat.get("totalRounds", 0))

                    if team_id_str:
                        total_rounds_won[team_id_str] = total_rounds_won.get(team_id_str, 0) + rounds_won

                # Assume first team is "our" team
                if total_rounds_won:
                    first_team_rounds = list(total_rounds_won.values())[0]
                    new_match["teamRoundsWon"] = first_team_rounds
                    new_match["teamRoundsLost"] = total_rounds - first_team_rounds

            insert_result = matches_collection.insert_one(new_match)

            result["matchId"] = str(insert_result.inserted_id)
            result["operation"] = "created"
            result["status"] = "success"

    except Exception as e:
        result["status"] = "error"
        result["error"] = f"MongoDB error: {str(e)}"

    return result


def main():
    parser = argparse.ArgumentParser(
        description="Ingest evidence_v1 into MongoDB",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Environment variables:
  GRID_HOT_ROOT: Root directory of GRID hot cache
  MONGODB_URI: MongoDB connection URI

Examples:
  # Ingest 5 series from 2024
  python scripts/py/ingest_evidence_v1_to_mongo.py --max-series 5 --years 2024

  # Ingest all series from specific tournaments
  python scripts/py/ingest_evidence_v1_to_mongo.py --tournament-ids 757073 757074

  # With environment variables
  $env:GRID_HOT_ROOT="E:\\grid-cache\\hot"
  $env:MONGODB_URI="mongodb://localhost:27017"
  python scripts/py/ingest_evidence_v1_to_mongo.py --max-series 10
"""
    )

    parser.add_argument(
        "--root",
        type=str,
        help="Root directory of GRID hot cache (default: env GRID_HOT_ROOT)"
    )

    parser.add_argument(
        "--max-series",
        type=int,
        help="Maximum number of series to ingest"
    )

    parser.add_argument(
        "--years",
        type=str,
        help="Comma-separated years to filter (e.g., 2024,2025)"
    )

    parser.add_argument(
        "--tournament-ids",
        type=str,
        help="Comma-separated tournament IDs to filter"
    )

    parser.add_argument(
        "--mongo-uri",
        type=str,
        help="MongoDB connection URI (default: env MONGODB_URI)"
    )

    parser.add_argument(
        "--db",
        type=str,
        default="c9-stratos",
        help="Database name (default: c9-stratos)"
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
        "--team-id",
        type=str,
        help="Team ObjectId to use for new matches (default: auto-generate)"
    )

    args = parser.parse_args()

    # Get root directory
    root_str = args.root or os.getenv("GRID_HOT_ROOT")
    if not root_str:
        print("ERROR: --root or GRID_HOT_ROOT environment variable is required")
        sys.exit(1)

    root = Path(root_str)
    if not root.exists():
        print(f"ERROR: Root directory does not exist: {root}")
        sys.exit(1)

    # Get MongoDB URI
    mongo_uri = args.mongo_uri or os.getenv("MONGODB_URI")
    if not mongo_uri:
        print("ERROR: --mongo-uri or MONGODB_URI environment variable is required")
        sys.exit(1)

    # Parse years and tournament IDs
    years = args.years.split(',') if args.years else None
    tournament_ids = args.tournament_ids.split(',') if args.tournament_ids else None

    print("=" * 80)
    print("GRID Evidence MongoDB Ingestion")
    print("=" * 80)
    print(f"Root: {root}")
    print(f"MongoDB: {mongo_uri.split('@')[-1] if '@' in mongo_uri else 'localhost'}")
    print(f"Database: {args.db}")
    if args.max_series:
        print(f"Max series: {args.max_series}")
    if years:
        print(f"Years: {', '.join(years)}")
    if tournament_ids:
        print(f"Tournament IDs: {', '.join(tournament_ids)}")
    print()

    # Connect to MongoDB
    try:
        client = MongoClient(mongo_uri)
        db = client[args.db]
        print(f"Connected to MongoDB database: {args.db}")
    except Exception as e:
        print(f"ERROR: Failed to connect to MongoDB: {e}")
        sys.exit(1)

    # Find series directories
    series_dirs = find_series_directories(
        root,
        max_series=args.max_series,
        years=years,
        tournament_ids=tournament_ids
    )

    if not series_dirs:
        print("No series directories found!")
        client.close()
        sys.exit(0)

    print()
    print("=" * 80)
    print("Processing Series")
    print("=" * 80)

    # Process each series
    extraction_results = []
    upsert_results = []

    for i, series_dir in enumerate(series_dirs, 1):
        series_id = series_dir.name
        print(f"\n[{i}/{len(series_dirs)}] Series {series_id}")

        # Extract and validate
        ext_result = extract_and_validate(
            series_dir,
            max_lines=args.max_lines,
            iso_threshold=args.iso_threshold
        )

        extraction_results.append(ext_result)

        print(f"  Extraction: {ext_result['status']}")

        if ext_result['status'] == 'validated' and ext_result['evidence']:
            # Upsert to MongoDB
            upsert_result = upsert_to_mongo(
                db,
                series_id,
                ext_result['tournamentId'],
                ext_result['evidence'],
                team_id=args.team_id
            )

            upsert_results.append(upsert_result)

            print(f"  MongoDB: {upsert_result['status']} ({upsert_result.get('operation', 'N/A')})")
            if upsert_result.get('matchId'):
                print(f"  Match ID: {upsert_result['matchId']}")
        else:
            print(f"  Error: {ext_result.get('error', 'Unknown error')}")

    # Close MongoDB connection
    client.close()

    # Print summary
    print()
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total series found: {len(series_dirs)}")
    print(f"Extracted: {sum(1 for r in extraction_results if r['status'] == 'validated')}")
    print(f"Failed: {sum(1 for r in extraction_results if 'failed' in r['status'] or 'error' in r['status'])}")

    if upsert_results:
        print(f"\nMongoDB Operations:")
        print(f"  Created: {sum(1 for r in upsert_results if r.get('operation') == 'created')}")
        print(f"  Updated: {sum(1 for r in upsert_results if r.get('operation') == 'updated')}")
        print(f"  Errors: {sum(1 for r in upsert_results if r['status'] == 'error')}")

    print()

    # Exit with appropriate code
    if any(r['status'] == 'error' for r in upsert_results):
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
