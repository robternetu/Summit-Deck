"""
Validate evidence_v1.json files for correctness and consistency.

Performs internal invariant checks and optional cross-checks with end_state.json.
"""
import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any


class ValidationResult:
    """Container for validation results."""

    def __init__(self, file_path: str):
        self.file_path = file_path
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.checks_passed: List[str] = []

    def add_error(self, message: str):
        """Add an error."""
        self.errors.append(message)

    def add_warning(self, message: str):
        """Add a warning."""
        self.warnings.append(message)

    def add_pass(self, message: str):
        """Add a passed check."""
        self.checks_passed.append(message)

    def is_pass(self) -> bool:
        """Check if validation passed (no errors)."""
        return len(self.errors) == 0

    def is_warn(self) -> bool:
        """Check if there are warnings."""
        return len(self.warnings) > 0 and len(self.errors) == 0

    def status(self) -> str:
        """Get status string."""
        if self.errors:
            return "FAIL"
        elif self.warnings:
            return "WARN"
        else:
            return "PASS"

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            "file": self.file_path,
            "status": self.status(),
            "errors": self.errors,
            "warnings": self.warnings,
            "checks_passed": len(self.checks_passed)
        }


def validate_internal(evidence: Dict, result: ValidationResult):
    """
    Validate internal invariants of evidence file.

    Args:
        evidence: Evidence dictionary
        result: ValidationResult to populate
    """
    # Check meta.seriesId exists
    meta = evidence.get("meta", {})
    series_id = meta.get("seriesId")

    if not series_id:
        result.add_error("meta.seriesId is missing")
    else:
        result.add_pass(f"meta.seriesId exists: {series_id}")

    # Check rounds non-empty
    rounds = evidence.get("rounds", [])
    if not rounds:
        result.add_error("rounds array is empty")
    else:
        result.add_pass(f"rounds non-empty: {len(rounds)} rounds")

    # Check games array
    games = evidence.get("games", [])
    if not games:
        result.add_warning("games array is empty")
    else:
        result.add_pass(f"games array has {len(games)} games")

    # Build game ID set
    game_ids_in_games = set(g["gameId"] for g in games if "gameId" in g)

    # Check every rounds[i].gameId exists in games[].gameId
    game_ids_in_rounds = set()
    for i, round_data in enumerate(rounds):
        game_id = round_data.get("gameId")
        if not game_id:
            result.add_error(f"rounds[{i}] missing gameId")
        else:
            game_ids_in_rounds.add(game_id)
            if game_id not in game_ids_in_games:
                result.add_error(f"rounds[{i}].gameId '{game_id}' not found in games array")

    if game_ids_in_rounds:
        result.add_pass(f"All round gameIds found in games array")

    # Check game count equals number of unique gameIds in rounds
    if len(game_ids_in_games) != len(game_ids_in_rounds):
        result.add_error(
            f"Game count mismatch: games array has {len(game_ids_in_games)} games, "
            f"but rounds reference {len(game_ids_in_rounds)} unique gameIds"
        )
    else:
        result.add_pass(f"Game count matches unique gameIds in rounds: {len(game_ids_in_games)}")

    # For each gameId: validate round numbering and winner presence
    rounds_by_game = defaultdict(list)
    for round_data in rounds:
        game_id = round_data.get("gameId")
        if game_id:
            rounds_by_game[game_id].append(round_data)

    for game_id, game_rounds in rounds_by_game.items():
        # Check max(roundNumber) equals number of rounds for this game
        round_numbers = [r.get("roundNumber") for r in game_rounds if r.get("roundNumber") is not None]

        if round_numbers:
            max_round_num = max(round_numbers)
            num_rounds = len(game_rounds)

            # Round numbers should generally be 1-indexed and sequential
            # But some games might have gaps, so we just check if count is reasonable
            if max_round_num > num_rounds * 2:
                result.add_warning(
                    f"Game {game_id[:8]}: max roundNumber ({max_round_num}) "
                    f"seems high compared to round count ({num_rounds})"
                )
            else:
                result.add_pass(
                    f"Game {game_id[:8]}: round numbering reasonable "
                    f"(max={max_round_num}, count={num_rounds})"
                )

        # Check winnerTeamId present for all rounds
        for i, round_data in enumerate(game_rounds):
            winner_id = round_data.get("winnerTeamId")
            if not winner_id:
                result.add_error(
                    f"Game {game_id[:8]}, round {round_data.get('roundNumber')}: "
                    f"missing winnerTeamId"
                )

    if all(r.get("winnerTeamId") for r in rounds):
        result.add_pass("All rounds have winnerTeamId")

    # Validate kills roundNumber exist in game's round set
    kills = evidence.get("kills", [])
    for i, kill in enumerate(kills):
        game_id = kill.get("gameId")
        round_number = kill.get("roundNumber")

        if game_id and round_number is not None:
            # Check if this round exists
            round_exists = any(
                r.get("gameId") == game_id and r.get("roundNumber") == round_number
                for r in rounds
            )

            if not round_exists:
                result.add_error(
                    f"kills[{i}]: references non-existent round "
                    f"(game={game_id[:8]}, round={round_number})"
                )

    if kills:
        result.add_pass(f"Validated {len(kills)} kills against rounds")

    # Validate plants roundNumber exist in game's round set
    plants = evidence.get("plants", [])
    for i, plant in enumerate(plants):
        game_id = plant.get("gameId")
        round_number = plant.get("roundNumber")

        if game_id and round_number is not None:
            round_exists = any(
                r.get("gameId") == game_id and r.get("roundNumber") == round_number
                for r in rounds
            )

            if not round_exists:
                result.add_error(
                    f"plants[{i}]: references non-existent round "
                    f"(game={game_id[:8]}, round={round_number})"
                )

    if plants:
        result.add_pass(f"Validated {len(plants)} plants against rounds")

    # Validate defuses roundNumber exist in game's round set
    defuses = evidence.get("defuses", [])
    for i, defuse in enumerate(defuses):
        game_id = defuse.get("gameId")
        round_number = defuse.get("roundNumber")

        if game_id and round_number is not None:
            round_exists = any(
                r.get("gameId") == game_id and r.get("roundNumber") == round_number
                for r in rounds
            )

            if not round_exists:
                result.add_error(
                    f"defuses[{i}]: references non-existent round "
                    f"(game={game_id[:8]}, round={round_number})"
                )

    if defuses:
        result.add_pass(f"Validated {len(defuses)} defuses against rounds")

    # Validate first blood is actually first kill in round
    for round_data in rounds:
        first_blood = round_data.get("firstBlood")
        if not first_blood:
            continue

        game_id = round_data.get("gameId")
        round_number = round_data.get("roundNumber")
        fb_timestamp = first_blood.get("timestamp")

        # Find all kills in this round
        round_kills = [
            k for k in kills
            if k.get("gameId") == game_id and k.get("roundNumber") == round_number
        ]

        if round_kills:
            # Check if first blood kill is marked correctly
            fb_kills = [k for k in round_kills if k.get("isFirstBlood")]

            if len(fb_kills) == 0:
                result.add_warning(
                    f"Game {game_id[:8]}, round {round_number}: "
                    f"round has firstBlood but no kill marked isFirstBlood=true"
                )
            elif len(fb_kills) > 1:
                result.add_error(
                    f"Game {game_id[:8]}, round {round_number}: "
                    f"multiple kills marked as isFirstBlood ({len(fb_kills)})"
                )

            # Check if the first blood is actually the earliest kill
            if fb_timestamp:
                for kill in round_kills:
                    kill_ts = kill.get("timestamp")
                    if kill_ts and kill_ts < fb_timestamp and not kill.get("isFirstBlood"):
                        result.add_error(
                            f"Game {game_id[:8]}, round {round_number}: "
                            f"kill at {kill_ts} is earlier than firstBlood at {fb_timestamp}"
                        )

    result.add_pass("First blood consistency checks completed")


def validate_with_end_state(evidence: Dict, end_state: Dict, result: ValidationResult):
    """
    Cross-check evidence with end_state.json.

    Args:
        evidence: Evidence dictionary
        end_state: End state dictionary
        result: ValidationResult to populate
    """
    # Extract end_state information
    # Structure might vary, but typically has teams with scores
    end_state_teams = end_state.get("teams", [])

    if not end_state_teams:
        result.add_warning("end_state.json has no teams array, skipping cross-check")
        return

    # Build team score map from end_state
    end_state_scores = {}
    for team in end_state_teams:
        team_id = str(team.get("id", ""))
        score = team.get("score", 0)
        if team_id:
            end_state_scores[team_id] = score

    # Build team score map from evidence rounds
    evidence_scores = defaultdict(int)
    rounds = evidence.get("rounds", [])

    for round_data in rounds:
        winner_id = round_data.get("winnerTeamId")
        if winner_id:
            evidence_scores[str(winner_id)] += 1

    # Compare scores
    for team_id, end_score in end_state_scores.items():
        evidence_score = evidence_scores.get(team_id, 0)

        if evidence_score != end_score:
            result.add_error(
                f"Score mismatch for team {team_id}: "
                f"end_state shows {end_score} rounds won, "
                f"evidence shows {evidence_score}"
            )
        else:
            result.add_pass(f"Team {team_id} score matches: {evidence_score}")

    # Check total rounds
    total_rounds_evidence = len(rounds)
    total_rounds_end_state = sum(end_state_scores.values())

    if total_rounds_evidence != total_rounds_end_state:
        result.add_warning(
            f"Total rounds mismatch: evidence has {total_rounds_evidence}, "
            f"end_state total is {total_rounds_end_state}"
        )

    # Check player stats if available
    end_state_players = end_state.get("players", [])
    evidence_players = evidence.get("players", [])

    if end_state_players and evidence_players:
        # Build player stat maps
        end_state_player_stats = {}
        for player in end_state_players:
            player_id = str(player.get("id", ""))
            if player_id:
                end_state_player_stats[player_id] = {
                    "kills": player.get("kills", 0),
                    "deaths": player.get("deaths", 0)
                }

        evidence_player_stats = {}
        for player in evidence_players:
            player_id = str(player.get("playerId", ""))
            if player_id:
                evidence_player_stats[player_id] = {
                    "kills": player.get("kills", 0),
                    "deaths": player.get("deaths", 0)
                }

        # Compare
        for player_id, end_stats in end_state_player_stats.items():
            evidence_stats = evidence_player_stats.get(player_id)

            if not evidence_stats:
                result.add_warning(f"Player {player_id} in end_state but not in evidence")
                continue

            if evidence_stats["kills"] != end_stats["kills"]:
                result.add_warning(
                    f"Player {player_id} kills mismatch: "
                    f"end_state={end_stats['kills']}, evidence={evidence_stats['kills']}"
                )

            if evidence_stats["deaths"] != end_stats["deaths"]:
                result.add_warning(
                    f"Player {player_id} deaths mismatch: "
                    f"end_state={end_stats['deaths']}, evidence={evidence_stats['deaths']}"
                )


def validate_evidence_file(
    evidence_path: Path,
    series_dir: Optional[Path] = None
) -> ValidationResult:
    """
    Validate a single evidence file.

    Args:
        evidence_path: Path to evidence JSON file
        series_dir: Optional series directory to load end_state.json from

    Returns:
        ValidationResult
    """
    result = ValidationResult(str(evidence_path))

    # Load evidence file
    try:
        with open(evidence_path, 'r', encoding='utf-8') as f:
            evidence = json.load(f)
    except Exception as e:
        result.add_error(f"Failed to load evidence file: {e}")
        return result

    result.add_pass("Evidence file loaded successfully")

    # Run internal validation
    validate_internal(evidence, result)

    # Try to load end_state.json if series_dir provided
    if series_dir:
        end_state_path = series_dir / "end_state.json"

        if end_state_path.exists():
            try:
                with open(end_state_path, 'r', encoding='utf-8') as f:
                    end_state = json.load(f)

                result.add_pass("end_state.json loaded for cross-check")
                validate_with_end_state(evidence, end_state, result)

            except Exception as e:
                result.add_warning(f"Failed to load end_state.json: {e}")
        else:
            result.add_pass("No end_state.json found (optional)")

    return result


def print_validation_result(result: ValidationResult, verbose: bool = False):
    """
    Print validation result to console.

    Args:
        result: ValidationResult to print
        verbose: If True, print all checks
    """
    print(f"\n{'=' * 80}")
    print(f"File: {result.file_path}")
    print(f"Status: {result.status()}")
    print(f"{'=' * 80}")

    if result.errors:
        print(f"\nERRORS ({len(result.errors)}):")
        for error in result.errors:
            print(f"  [X] {error}")

    if result.warnings:
        print(f"\nWARNINGS ({len(result.warnings)}):")
        for warning in result.warnings:
            print(f"  [!] {warning}")

    if verbose and result.checks_passed:
        print(f"\nPASSED ({len(result.checks_passed)}):")
        for check in result.checks_passed[:10]:  # Limit to first 10
            print(f"  [OK] {check}")
        if len(result.checks_passed) > 10:
            print(f"  ... and {len(result.checks_passed) - 10} more")

    if not result.errors and not result.warnings:
        print("\n[OK] All checks passed!")


def main():
    parser = argparse.ArgumentParser(
        description="Validate evidence_v1.json files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Validate single file
  python scripts/py/validate_evidence_v1.py --evidence scripts/py/out/2629390_evidence_v1.json

  # Validate with series directory for end_state.json cross-check
  python scripts/py/validate_evidence_v1.py --evidence scripts/py/out/2629390_evidence_v1.json --series-dir "E:\\grid-cache\\hot\\...\\2629390"

  # Validate all files in output directory
  python scripts/py/validate_evidence_v1.py --out-dir scripts/py/out

  # Fail on warnings
  python scripts/py/validate_evidence_v1.py --evidence scripts/py/out/2629390_evidence_v1.json --fail-on-warn
"""
    )

    parser.add_argument(
        "--evidence",
        type=str,
        help="Path to single evidence file to validate"
    )

    parser.add_argument(
        "--out-dir",
        type=str,
        help="Directory containing evidence files to validate"
    )

    parser.add_argument(
        "--series-dir",
        type=str,
        help="Series directory for end_state.json cross-check (optional)"
    )

    parser.add_argument(
        "--fail-on-warn",
        action="store_true",
        help="Exit with code 1 if warnings found"
    )

    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print all passed checks"
    )

    args = parser.parse_args()

    # Validate arguments
    if not args.evidence and not args.out_dir:
        print("ERROR: Must provide either --evidence or --out-dir")
        sys.exit(1)

    if args.evidence and args.out_dir:
        print("ERROR: Cannot provide both --evidence and --out-dir")
        sys.exit(1)

    # Get series directory if provided
    series_dir = Path(args.series_dir) if args.series_dir else None

    # Collect evidence files to validate
    evidence_files = []

    if args.evidence:
        evidence_path = Path(args.evidence)
        if not evidence_path.exists():
            print(f"ERROR: Evidence file not found: {evidence_path}")
            sys.exit(1)
        evidence_files.append(evidence_path)

    elif args.out_dir:
        out_dir = Path(args.out_dir)
        if not out_dir.exists():
            print(f"ERROR: Output directory not found: {out_dir}")
            sys.exit(1)

        evidence_files = sorted(out_dir.glob("*_evidence_v1.json"))

        if not evidence_files:
            print(f"WARNING: No evidence files found in {out_dir}")
            sys.exit(0)

        print(f"Found {len(evidence_files)} evidence file(s) to validate")

    # Validate each file
    results = []

    for evidence_path in evidence_files:
        result = validate_evidence_file(evidence_path, series_dir)
        results.append(result)
        print_validation_result(result, verbose=args.verbose)

    # Write validation report
    if args.out_dir:
        report_path = Path(args.out_dir) / "validation_report.json"
        report = {
            "total_files": len(results),
            "passed": sum(1 for r in results if r.is_pass() and not r.is_warn()),
            "warnings": sum(1 for r in results if r.is_warn()),
            "failed": sum(1 for r in results if not r.is_pass()),
            "results": [r.to_dict() for r in results]
        }

        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, indent=2)

        print(f"\n{'=' * 80}")
        print(f"Validation report written to: {report_path}")
        print(f"{'=' * 80}")

    # Print summary
    print(f"\n{'=' * 80}")
    print("SUMMARY")
    print(f"{'=' * 80}")
    print(f"Total files: {len(results)}")
    print(f"Passed: {sum(1 for r in results if r.is_pass() and not r.is_warn())}")
    print(f"Warnings: {sum(1 for r in results if r.is_warn())}")
    print(f"Failed: {sum(1 for r in results if not r.is_pass())}")

    # Determine exit code
    has_errors = any(not r.is_pass() for r in results)
    has_warnings = any(r.is_warn() for r in results)

    if has_errors:
        sys.exit(1)
    elif args.fail_on_warn and has_warnings:
        sys.exit(1)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
