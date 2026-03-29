"""
GRID events JSONL parser - builds pandas DataFrames from event data.
"""

import json
from datetime import datetime
from typing import Dict, Iterator, List, Optional, Tuple

import pandas as pd


def iter_jsonl(path: str) -> Iterator[Dict]:
    """
    Yield parsed dict per line from a JSONL file.
    """
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def extract_round_number(series_state: Dict) -> Optional[int]:
    """
    Extract round number from seriesState.

    Computes round number from team scores (sum + 1 for current round).
    Falls back to segments[0].sequenceNumber if scores unavailable.
    """
    if not series_state:
        return None

    games = series_state.get("games", [])
    if not games:
        return None

    game = games[0]

    # Try to compute from team scores
    teams = game.get("teams", [])
    if teams:
        total_score = 0
        for team in teams:
            score = team.get("score", 0)
            if isinstance(score, int):
                total_score += score
            elif isinstance(score, dict):
                # Sometimes score is a dict with various fields
                total_score += score.get("main", 0) or 0
        if total_score >= 0:
            return total_score + 1  # Current round = total completed rounds + 1

    # Fallback to segment sequenceNumber
    segments = game.get("segments", [])
    if not segments:
        return None

    return segments[0].get("sequenceNumber")


def _parse_position(pos) -> Tuple[Optional[float], Optional[float]]:
    """Extract x, y from position dict or return None."""
    if not pos or not isinstance(pos, dict):
        return None, None
    return pos.get("x"), pos.get("y")


def _parse_datetime(ts_str: Optional[str]) -> Optional[datetime]:
    """Parse ISO timestamp string to datetime."""
    if not ts_str:
        return None
    try:
        # Handle various ISO formats
        ts_str = ts_str.replace("Z", "+00:00")
        return datetime.fromisoformat(ts_str)
    except (ValueError, TypeError):
        return None


def build_dataframes(events_jsonl_path: str) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Parse JSONL events and build DataFrames.

    Returns:
        events_df: All events with actor/target info
        snapshots_df: Player position snapshots
        buys_df: Round start loadout data
        winners_df: Round winners
        plants_df: Bomb plant events
    """
    events_rows: List[Dict] = []
    snapshots_rows: List[Dict] = []
    buys_rows: List[Dict] = []
    winners_rows: List[Dict] = []
    plants_rows: List[Dict] = []

    # Use (game_id, round_number) as composite keys for multi-game series
    seen_rounds_buys = set()
    seen_rounds_winners = set()

    for line_data in iter_jsonl(events_jsonl_path):
        occurred_at = line_data.get("occurredAt")
        seq = line_data.get("sequenceNumber", 0)
        ts = _parse_datetime(occurred_at)

        events_list = line_data.get("events", [])

        for event in events_list:
            event_type = event.get("type")
            action = event.get("action")
            actor = event.get("actor", {})
            target = event.get("target", {})
            series_state = event.get("seriesState", {})

            # Extract series_id from seriesState
            series_id = series_state.get("id") if series_state else None

            # Get round number
            round_number = extract_round_number(series_state)

            # Actor info - check both state.game.position and state.position
            actor_id = actor.get("id")
            actor_state = actor.get("state", {})
            actor_team_id = actor_state.get("teamId")
            actor_side = actor_state.get("side")

            # Try to get position from actor.state.game.position first, then actor.state.position
            actor_game = actor_state.get("game", {})
            actor_pos = actor_game.get("position") or actor_state.get("position")
            actor_x, actor_y = _parse_position(actor_pos)

            # Target info
            target_id = target.get("id")
            target_state = target.get("state", {})
            target_team_id = target_state.get("teamId")
            target_side = target_state.get("side")
            target_game = target_state.get("game", {})
            target_pos = target_game.get("position") or target_state.get("position")
            target_x, target_y = _parse_position(target_pos)

            # Build event row
            event_row = {
                "ts": ts,
                "seq": seq,
                "series_id": series_id,
                "round_number": round_number,
                "event_type": event_type,
                "action": action,
                "actor_id": actor_id,
                "actor_team_id": actor_team_id,
                "actor_side": actor_side,
                "actor_x": actor_x,
                "actor_y": actor_y,
                "target_id": target_id,
                "target_team_id": target_team_id,
                "target_side": target_side,
                "target_x": target_x,
                "target_y": target_y,
            }
            events_rows.append(event_row)

            # Build snapshots from seriesState (for every event with seriesState that has player positions)
            if series_state:
                games = series_state.get("games", [])
                if games:
                    game = games[0]
                    teams = game.get("teams", [])
                    for team in teams:
                        team_id = team.get("id")
                        team_side = team.get("side")
                        players = team.get("players", [])
                        for player in players:
                            player_id = player.get("id")
                            # Position is directly on player object in GRID format
                            player_pos = player.get("position")
                            if player_pos:
                                px, py = _parse_position(player_pos)
                                if px is not None and py is not None:
                                    snapshot_row = {
                                        "ts": ts,
                                        "seq": seq,
                                        "round_number": round_number,
                                        "player_id": player_id,
                                        "team_id": team_id,
                                        "side": team_side,
                                        "x": px,
                                        "y": py,
                                    }
                                    snapshots_rows.append(snapshot_row)

            # Extract buys from round-started-freezetime
            # GRID has money/loadoutValue directly on player object
            if event_type == "round-started-freezetime":
                # Extract player loadouts from seriesState
                if series_state:
                    games = series_state.get("games", [])
                    if games:
                        game = games[0]
                        game_id = game.get("id", "")
                        # Use (game_id, round_number) as composite key
                        buy_key = (game_id, round_number)
                        if buy_key not in seen_rounds_buys:
                            seen_rounds_buys.add(buy_key)
                            teams = game.get("teams", [])
                            for team in teams:
                                team_id_buy = team.get("id")
                                players = team.get("players", [])
                                for player in players:
                                    player_id = player.get("id")
                                    player_name = player.get("name", "")
                                    # GRID format: money and loadoutValue are directly on player
                                    money = player.get("money", 0)
                                    loadout_value = player.get("loadoutValue", 0)

                                    buy_row = {
                                        "round_number": round_number,
                                        "team_id": team_id_buy,
                                        "player_id": player_id,
                                        "player_name": player_name,
                                        "money": money,
                                        "loadout_value": loadout_value,
                                    }
                                    buys_rows.append(buy_row)

            # Extract winners from team-won-round
            if event_type == "team-won-round":
                winner_team_id = actor.get("id")
                # Get round number from target.state.sequenceNumber or seriesState
                target_state_for_round = target.get("state", {})
                round_num = target_state_for_round.get("sequenceNumber") or round_number

                # Get game_id for composite key
                game_id_for_winner = ""
                if series_state:
                    games = series_state.get("games", [])
                    if games:
                        game_id_for_winner = games[0].get("id", "")

                winner_key = (game_id_for_winner, round_num)
                if round_num is not None and winner_key not in seen_rounds_winners:
                    seen_rounds_winners.add(winner_key)
                    winners_rows.append({
                        "round_number": round_num,
                        "winner_team_id": winner_team_id,
                    })

            # Extract plants from player-completed-plantBomb
            if event_type == "player-completed-plantBomb":
                planter_team_id = actor_team_id
                plant_x, plant_y = actor_x, actor_y

                plants_rows.append({
                    "ts": ts,
                    "round_number": round_number,
                    "planter_team_id": planter_team_id,
                    "x": plant_x,
                    "y": plant_y,
                })

    # Build DataFrames
    events_df = pd.DataFrame(events_rows)
    snapshots_df = pd.DataFrame(snapshots_rows)
    buys_df = pd.DataFrame(buys_rows)
    winners_df = pd.DataFrame(winners_rows)
    plants_df = pd.DataFrame(plants_rows)

    # Ensure proper dtypes
    if not events_df.empty:
        events_df["seq"] = events_df["seq"].astype(int)

    if not snapshots_df.empty:
        snapshots_df["seq"] = snapshots_df["seq"].astype(int)

    if not buys_df.empty:
        buys_df["round_number"] = buys_df["round_number"].astype(int)
        buys_df["money"] = buys_df["money"].astype(int)
        buys_df["loadout_value"] = buys_df["loadout_value"].astype(int)

    if not winners_df.empty:
        winners_df["round_number"] = winners_df["round_number"].astype(int)

    return events_df, snapshots_df, buys_df, winners_df, plants_df
