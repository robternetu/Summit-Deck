"""
Advanced metrics computation for Summit Deck.

Implements:
- Hero Buy Efficiency
- Bait & Switch Index
"""

import math
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


def hero_buy_efficiency(
    buys_df: pd.DataFrame,
    events_df: pd.DataFrame,
    winners_df: pd.DataFrame,
    team_id: str
) -> Dict:
    """
    Compute Hero Buy Efficiency metric.

    A "hero buy" is when one player has significantly higher loadout than teammates
    (std_dev > 1500, max >= 3900, at least 3 teammates with loadout <= 800).

    Returns dict with attempts, successes, successRate, averageScore, and round details.
    """
    team_id_str = str(team_id)

    # Filter buys for the team
    team_buys = buys_df[buys_df["team_id"].astype(str) == team_id_str].copy()

    if team_buys.empty:
        return {
            "attempts": 0,
            "successes": 0,
            "successRate": 0.0,
            "averageScore": 0.0,
            "rounds": [],
        }

    # Get unique rounds for this team
    rounds = team_buys["round_number"].unique()

    # Build winners lookup
    winners_lookup = {}
    if not winners_df.empty:
        for _, row in winners_df.iterrows():
            winners_lookup[row["round_number"]] = str(row["winner_team_id"])

    # Get kill events (player-killed-player)
    kill_events = events_df[events_df["event_type"] == "player-killed-player"].copy()

    hero_rounds: List[Dict] = []
    attempts = 0
    successes = 0
    total_score = 0

    for round_num in sorted(rounds):
        round_buys = team_buys[team_buys["round_number"] == round_num]

        if round_buys.empty or len(round_buys) < 2:
            continue

        loadout_values = round_buys["loadout_value"].values
        std_dev = float(np.std(loadout_values))
        max_loadout = int(np.max(loadout_values))
        low_buy_count = int(np.sum(loadout_values <= 800))

        # Check if this is a hero buy round
        is_hero_buy = (
            std_dev > 1500 and
            max_loadout >= 3900 and
            low_buy_count >= 3
        )

        if not is_hero_buy:
            continue

        attempts += 1

        # Find hero player (max loadout)
        hero_row = round_buys[round_buys["loadout_value"] == max_loadout].iloc[0]
        hero_player_id = str(hero_row["player_id"])
        hero_player_name = hero_row["player_name"]
        hero_loadout_value = int(hero_row["loadout_value"])

        # Count hero kills in this round
        round_kills = kill_events[
            (kill_events["round_number"] == round_num) &
            (kill_events["actor_id"].astype(str) == hero_player_id)
        ]
        hero_kills = len(round_kills)

        # Did team win this round?
        did_win = winners_lookup.get(round_num) == team_id_str

        # Calculate score
        score = (hero_kills * 50) + (100 if did_win else 0)
        total_score += score

        # Success means did_win OR hero_kills >= 2
        is_success = did_win or hero_kills >= 2
        if is_success:
            successes += 1

        # Handle potential NaN in round_num
        try:
            round_val = int(round_num) if not pd.isna(round_num) else 0
        except (ValueError, TypeError):
            round_val = 0

        hero_rounds.append({
            "round": round_val,
            "heroPlayerId": hero_player_id,
            "heroPlayerName": hero_player_name,
            "stdDev": round(std_dev, 2),
            "heroLoadoutValue": hero_loadout_value,
            "teamLowBuys": low_buy_count,
            "heroKills": hero_kills,
            "wonRound": did_win,
            "score": score,
        })

    success_rate = (successes / attempts) if attempts > 0 else 0.0
    average_score = (total_score / attempts) if attempts > 0 else 0.0

    return {
        "attempts": attempts,
        "successes": successes,
        "successRate": round(success_rate, 3),
        "averageScore": round(average_score, 2),
        "rounds": hero_rounds,
    }


def _euclidean_distance(x1: float, y1: float, x2: float, y2: float) -> float:
    """Calculate Euclidean distance between two points."""
    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def _nearest_centroid(
    x: float,
    y: float,
    centroid_a: Tuple[float, float],
    centroid_b: Tuple[float, float]
) -> str:
    """Return 'A' or 'B' depending on which centroid is nearest."""
    dist_a = _euclidean_distance(x, y, centroid_a[0], centroid_a[1])
    dist_b = _euclidean_distance(x, y, centroid_b[0], centroid_b[1])
    return "A" if dist_a <= dist_b else "B"


def _count_players_near(
    snapshots_at_seq: pd.DataFrame,
    centroid: Tuple[float, float],
    radius: float,
    side: str,
    team_id: Optional[str] = None,
    exclude_team_id: Optional[str] = None
) -> int:
    """Count players near a centroid at a given snapshot."""
    filtered = snapshots_at_seq[snapshots_at_seq["side"] == side]

    if team_id:
        filtered = filtered[filtered["team_id"].astype(str) == team_id]

    if exclude_team_id:
        filtered = filtered[filtered["team_id"].astype(str) != exclude_team_id]

    count = 0
    for _, row in filtered.iterrows():
        if row["x"] is not None and row["y"] is not None:
            dist = _euclidean_distance(row["x"], row["y"], centroid[0], centroid[1])
            if dist <= radius:
                count += 1

    return count


def bait_and_switch_index(
    events_df: pd.DataFrame,
    snapshots_df: pd.DataFrame,
    plants_df: pd.DataFrame,
    team_id: str
) -> Dict:
    """
    Compute Bait & Switch Index metric.

    Detects fake site takes by measuring defender rotation in response to
    ability usage at one site while attackers are actually focused elsewhere.

    Returns dict with triggers, successes, successRate, and examples.
    """
    team_id_str = str(team_id)
    RADIUS = 900
    WINDOW_SECONDS = 8

    # Build site centroids
    centroid_a: Tuple[float, float]
    centroid_b: Tuple[float, float]

    if not plants_df.empty and len(plants_df) >= 4:
        # Use plant positions to determine sites
        plants_with_pos = plants_df.dropna(subset=["x", "y"])
        if len(plants_with_pos) >= 4:
            median_x = plants_with_pos["x"].median()
            left_plants = plants_with_pos[plants_with_pos["x"] <= median_x]
            right_plants = plants_with_pos[plants_with_pos["x"] > median_x]

            if not left_plants.empty and not right_plants.empty:
                centroid_a = (left_plants["x"].mean(), left_plants["y"].mean())
                centroid_b = (right_plants["x"].mean(), right_plants["y"].mean())
            else:
                # Fallback
                centroid_a = (plants_with_pos["x"].min(), plants_with_pos["y"].mean())
                centroid_b = (plants_with_pos["x"].max(), plants_with_pos["y"].mean())
        else:
            # Fallback to snapshot bounds
            if not snapshots_df.empty:
                min_x = snapshots_df["x"].min()
                max_x = snapshots_df["x"].max()
                mean_y = snapshots_df["y"].mean()
                centroid_a = (min_x + (max_x - min_x) * 0.25, mean_y)
                centroid_b = (min_x + (max_x - min_x) * 0.75, mean_y)
            else:
                return {
                    "triggers": 0,
                    "successes": 0,
                    "successRate": 0.0,
                    "examples": [],
                }
    else:
        # Fallback: use map bounds from snapshots
        if not snapshots_df.empty:
            min_x = snapshots_df["x"].min()
            max_x = snapshots_df["x"].max()
            mean_y = snapshots_df["y"].mean()
            centroid_a = (min_x + (max_x - min_x) * 0.25, mean_y)
            centroid_b = (min_x + (max_x - min_x) * 0.75, mean_y)
        else:
            return {
                "triggers": 0,
                "successes": 0,
                "successRate": 0.0,
                "examples": [],
            }

    # Find ability usage triggers
    ability_events = events_df[
        (events_df["event_type"] == "player-used-ability") &
        (events_df["actor_team_id"].astype(str) == team_id_str) &
        (events_df["actor_side"] == "attacker") &
        (events_df["actor_x"].notna()) &
        (events_df["actor_y"].notna())
    ].copy()

    if ability_events.empty or snapshots_df.empty:
        return {
            "triggers": 0,
            "successes": 0,
            "successRate": 0.0,
            "examples": [],
        }

    # Sort snapshots by ts for later lookup
    snapshots_sorted = snapshots_df.sort_values("ts").copy()
    snapshot_seqs = snapshots_sorted["seq"].unique()

    triggers = 0
    successes = 0
    examples: List[Dict] = []

    for _, event in ability_events.iterrows():
        trigger_x = event["actor_x"]
        trigger_y = event["actor_y"]
        trigger_seq = event["seq"]
        trigger_ts = event["ts"]
        round_number = event["round_number"]

        if trigger_x is None or trigger_y is None:
            continue

        # Determine trigger site
        trigger_site = _nearest_centroid(trigger_x, trigger_y, centroid_a, centroid_b)

        # Count attackers near trigger site at this seq
        snapshots_at_seq = snapshots_df[snapshots_df["seq"] == trigger_seq]
        trigger_centroid = centroid_a if trigger_site == "A" else centroid_b

        attacker_count_near = _count_players_near(
            snapshots_at_seq,
            trigger_centroid,
            RADIUS,
            side="attacker",
            team_id=team_id_str
        )

        # Only keep triggers where attackerCountNear < 3
        if attacker_count_near >= 3:
            continue

        triggers += 1

        # Opposite site
        opposite_site = "B" if trigger_site == "A" else "A"
        opposite_centroid = centroid_b if trigger_site == "A" else centroid_a

        # Count defenders near opposite site at trigger time
        defenders_start = _count_players_near(
            snapshots_at_seq,
            opposite_centroid,
            RADIUS,
            side="defender",
            exclude_team_id=team_id_str
        )

        # Find snapshot ~8 seconds later
        if trigger_ts is not None:
            target_ts = trigger_ts.timestamp() + WINDOW_SECONDS
            later_snapshots = snapshots_sorted[
                snapshots_sorted["ts"].apply(
                    lambda t: t.timestamp() if t is not None else 0
                ) >= target_ts
            ]

            if not later_snapshots.empty:
                later_seq = later_snapshots.iloc[0]["seq"]
            else:
                # Use last available seq
                later_seq = snapshots_sorted.iloc[-1]["seq"] if not snapshots_sorted.empty else trigger_seq
        else:
            # Fallback: use next few sequences
            later_seqs = [s for s in snapshot_seqs if s > trigger_seq]
            later_seq = later_seqs[min(5, len(later_seqs) - 1)] if later_seqs else trigger_seq

        snapshots_at_later = snapshots_df[snapshots_df["seq"] == later_seq]
        defenders_end = _count_players_near(
            snapshots_at_later,
            opposite_centroid,
            RADIUS,
            side="defender",
            exclude_team_id=team_id_str
        )

        # Success if defenders rotated away
        is_success = defenders_end < defenders_start
        if is_success:
            successes += 1

        # Add to examples (max 20)
        if len(examples) < 20:
            # Handle NaN values in round_number
            try:
                round_val = int(round_number) if round_number is not None and not pd.isna(round_number) else 0
            except (ValueError, TypeError):
                round_val = 0

            examples.append({
                "round": round_val,
                "triggerTs": str(trigger_ts) if trigger_ts else "",
                "triggerSite": trigger_site,
                "defendersStart": defenders_start,
                "defendersEnd": defenders_end,
                "windowSeconds": WINDOW_SECONDS,
            })

    success_rate = (successes / triggers) if triggers > 0 else 0.0

    return {
        "triggers": triggers,
        "successes": successes,
        "successRate": round(success_rate, 3),
        "examples": examples,
    }
