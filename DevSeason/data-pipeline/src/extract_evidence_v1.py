"""
Extract evidence_v1.json from GRID series events.

Reads one series events file and produces stable evidence_v1.json
for later storage in Mongo and feeding to /api/coach/match.
"""
import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

from grid_events_reader import iter_messages

# Sprint 6: Import analytics module
try:
    from sprint6_analytics import compute_sprint6_stats
    SPRINT6_AVAILABLE = True
except ImportError:
    SPRINT6_AVAILABLE = False
    def compute_sprint6_stats(*args, **kwargs):
        return {}


# Economy tier constants for Valorant buy phases
ECONOMY_TIERS = {
    'full_buy': 3900,      # >= 3900 avg (rifles + full armor + abilities)
    'half_buy': 2600,      # >= 2600 avg (specters/marshals + armor)
    'eco': 1500,           # >= 1500 avg (light buy)
    'save': 0              # < 1500 avg (pistols/no armor)
}

# Trade kill time window in seconds
# In pro Valorant, a trade is typically within 3 seconds
TRADE_WINDOW_SECONDS = 3.0

# Weapon classification for kill analysis
WEAPON_CATEGORIES = {
    'rifle': ['vandal', 'phantom', 'bulldog', 'guardian'],
    'smg': ['spectre', 'stinger'],
    'sniper': ['operator', 'outlaw', 'marshal'],
    'shotgun': ['judge', 'bucky'],
    'sidearm': ['classic', 'shorty', 'frenzy', 'ghost', 'sheriff'],
    'heavy': ['odin', 'ares'],
    'melee': ['knife', 'melee'],
}

# Engagement range thresholds (GRID uses ~100 units per meter)
ENGAGEMENT_RANGES = {
    'close': 1000,      # < 1000 units (~10m) - Shotgun/SMG range
    'medium': 2500,     # 1000-2500 units (~10-25m) - Rifle optimal
    'long': float('inf')  # > 2500 units (~25m+) - Operator/holding angles
}

# Tempo classification thresholds (seconds from round start)
TEMPO_THRESHOLDS = {
    'fast': 60,     # Fast execute < 60s
    'standard': 90, # Standard play 60-90s
    'slow': float('inf')  # Slow play > 90s
}


def classify_weapon(weapon_name: str) -> str:
    """
    Classify weapon into category.

    Args:
        weapon_name: Weapon name from GRID (lowercase)

    Returns:
        Category: 'rifle', 'smg', 'sniper', 'shotgun', 'sidearm', 'heavy', 'melee', or 'ability'
    """
    if not weapon_name:
        return 'unknown'

    weapon_lower = weapon_name.lower()

    for category, weapons in WEAPON_CATEGORIES.items():
        if weapon_lower in weapons:
            return category

    # If not in weapon lists, it's likely an ability kill
    return 'ability'


def classify_engagement_range(distance: float) -> str:
    """
    Classify engagement into range category.

    Args:
        distance: Distance between killer and victim in game units

    Returns:
        Range category: 'close', 'medium', or 'long'
    """
    if distance is None or distance == float('inf'):
        return 'unknown'

    if distance < ENGAGEMENT_RANGES['close']:
        return 'close'
    elif distance < ENGAGEMENT_RANGES['medium']:
        return 'medium'
    else:
        return 'long'


def classify_tempo(time_to_resolve: float) -> str:
    """
    Classify round tempo based on time to resolve.

    Args:
        time_to_resolve: Seconds from round start to round end

    Returns:
        Tempo category: 'fast', 'standard', or 'slow'
    """
    if time_to_resolve is None:
        return 'unknown'

    if time_to_resolve < TEMPO_THRESHOLDS['fast']:
        return 'fast'
    elif time_to_resolve < TEMPO_THRESHOLDS['standard']:
        return 'standard'
    else:
        return 'slow'


def classify_economy(avg_loadout_value: int) -> str:
    """
    Classify economy tier based on average loadout value.

    Args:
        avg_loadout_value: Average team loadout value

    Returns:
        Economy tier: 'full_buy', 'half_buy', 'eco', or 'save'
    """
    if avg_loadout_value >= 3900:
        return 'full_buy'
    elif avg_loadout_value >= 2600:
        return 'half_buy'
    elif avg_loadout_value >= 1500:
        return 'eco'
    else:
        return 'save'


# Site boundary constants for mapping plant positions to sites
# These boundaries are derived from actual GRID API coordinate data analysis
# across 7,000+ plant events from 212 professional matches.
#
# IMPORTANT: GRID uses a coordinate system where:
# - X increases roughly East/Right on minimap
# - Y can be positive or negative depending on map region
#
# Boundaries are intentionally generous (+/- 1000 units) to catch edge cases
SITE_BOUNDARIES = {
    'bind': {
        # Bind has 2 sites: A (Showers/Bath side), B (Hookah/Garden side)
        # A site cluster: x=9-12, y=1-4 (197 plants observed)
        'A': {'minX': 9000, 'maxX': 13000, 'minY': 0, 'maxY': 5000},
        # B site cluster: x=10-12, y=-6 to -4 (116 plants observed)
        'B': {'minX': 9000, 'maxX': 13000, 'minY': -7000, 'maxY': -3000},
    },
    'split': {
        # Split has 2 sites: A (Screens/Ramps), B (Garage/Back site)
        # A site cluster: x=-3 to 0, y=-8 to -5 (126 plants observed)
        'A': {'minX': -4000, 'maxX': 1000, 'minY': -9000, 'maxY': -5000},
        # B site cluster: x=6-9, y=-8 to -6 (147 plants observed)
        'B': {'minX': 5000, 'maxX': 10000, 'minY': -9500, 'maxY': -5500},
    },
    'haven': {
        # Haven has 3 sites: A (Long), B (Mid/Garage), C (Short/Window)
        # A site cluster: x=-4 to -2, y=-10 to -6 (125 plants observed)
        'A': {'minX': -5000, 'maxX': -1000, 'minY': -10500, 'maxY': -5500},
        # B site cluster: EXPANDED to include x=1-3, y=-10 to -9 (40+ additional plants)
        # Original: x=5-8, y=-10 to -6 + New: x=1-3, y=-10 to -8
        'B': {'minX': 1000, 'maxX': 9000, 'minY': -10500, 'maxY': -6000},
        # C site cluster: x=7-9, y=3-7 (54 plants observed)
        'C': {'minX': 6000, 'maxX': 12000, 'minY': 2000, 'maxY': 8000},
    },
    'lotus': {
        # Lotus has 3 sites with rotating doors (highest plant count: 1931)
        # A site cluster: x=5-7, y=-6 to -3 (348 plants observed)
        'A': {'minX': 4000, 'maxX': 8000, 'minY': -7000, 'maxY': -2500},
        # B site cluster: x=6-8, y=-1 to 2 (160 plants observed)
        'B': {'minX': 5500, 'maxX': 9000, 'minY': -2000, 'maxY': 3000},
        # C site cluster: x=7-9, y=4-8 (280 plants observed)
        'C': {'minX': 6500, 'maxX': 10000, 'minY': 3500, 'maxY': 8500},
    },
    'ascent': {
        # Ascent has 2 sites: A (Wine/Generator), B (Market/Boathouse)
        # A site cluster: x=5-7, y=-9 to -6 (84 plants observed)
        'A': {'minX': 4000, 'maxX': 8000, 'minY': -9500, 'maxY': -6000},
        # B site cluster: x=-5 to -3, y=-8 to -6 (66 plants observed)
        'B': {'minX': -6000, 'maxX': -2000, 'minY': -9500, 'maxY': -6000},
    },
    'sunset': {
        # Sunset has 2 sites: A, B
        # A site cluster: x=0-2, y=-6 to -3 (97 plants observed)
        'A': {'minX': -1000, 'maxX': 3000, 'minY': -7000, 'maxY': -2500},
        # B site cluster: x=1-3, y=2-5 (61 plants observed)
        'B': {'minX': 0, 'maxX': 4000, 'minY': 1500, 'maxY': 6000},
    },
    'breeze': {
        # Breeze has 2 sites: A (Pyramid), B (Hall)
        # A site cluster: x=4-6, y=5-7 (24 plants observed)
        'A': {'minX': 3000, 'maxX': 7000, 'minY': 4000, 'maxY': 8000},
        # B site cluster: x=6-8, y=-8 to -3 (expanded to catch edge plants)
        'B': {'minX': 5000, 'maxX': 9000, 'minY': -8500, 'maxY': -3000},
    },
    'icebox': {
        # Icebox has 2 sites: A (Rafters/Pipes), B (Snowman/Kitchen)
        # A site cluster: x=-8 to -6, y=2-5 (117 plants observed)
        'A': {'minX': -9000, 'maxX': -5500, 'minY': 1500, 'maxY': 6000},
        # B site cluster: x=0-3, y=0-4 (119 plants observed)
        'B': {'minX': -500, 'maxX': 4000, 'minY': -1000, 'maxY': 5000},
    },
    'fracture': {
        # Fracture has 2 sites with attackers spawning on both sides
        # A site cluster: x=7-9, y=3-5 (40 plants observed)
        'A': {'minX': 6500, 'maxX': 10500, 'minY': 2500, 'maxY': 6000},
        # B site cluster: x=7-9, y=-7 to -4 (45 plants observed)
        'B': {'minX': 6500, 'maxX': 10500, 'minY': -8000, 'maxY': -4000},
    },
    'pearl': {
        # Pearl has 2 sites: A (Art), B (Site)
        # A site cluster: x=-3 to -2, y=-10 to -8 (29 plants observed)
        'A': {'minX': -4500, 'maxX': -1000, 'minY': -10500, 'maxY': -7500},
        # B site has TWO plant zones: x=6-7, y=-5 to -4 AND x=7-9, y=4-6
        # Expanding to cover both zones
        'B': {'minX': 5000, 'maxX': 10000, 'minY': -6000, 'maxY': 7000},
    },
    'abyss': {
        # Abyss has 2 sites
        # A site cluster: x=-7 to -4, y=-2 to 0 (51 plants observed)
        'A': {'minX': -8000, 'maxX': -3500, 'minY': -3000, 'maxY': 1000},
        # B site cluster: x=4-6, y=-1 to 1 (34 plants observed)
        'B': {'minX': 3000, 'maxX': 7000, 'minY': -2000, 'maxY': 2000},
    },
    'corrode': {
        # Corrode - actual data shows two main clusters
        # A site cluster: x=3-5, y=-3 to -1 (70 plants at x=4,y=-2)
        'A': {'minX': 2500, 'maxX': 6000, 'minY': -3500, 'maxY': 0},
        # B site cluster: x=-5 to -3, y=-3 to -1 (35 plants at x=-4,y=-2)
        'B': {'minX': -5500, 'maxX': -2500, 'minY': -3500, 'maxY': 0},
    },
}


def compute_distance(pos1: Dict, pos2: Dict) -> float:
    """
    Compute Euclidean distance between two positions.

    Args:
        pos1: Position dict with x, y keys
        pos2: Position dict with x, y keys

    Returns:
        Distance as float, or inf if positions invalid
    """
    if not pos1 or not pos2:
        return float('inf')

    x1 = pos1.get('x')
    y1 = pos1.get('y')
    x2 = pos2.get('x')
    y2 = pos2.get('y')

    if x1 is None or y1 is None or x2 is None or y2 is None:
        return float('inf')

    return math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)


def infer_plant_site(position: Dict, map_name: str) -> str:
    """
    Infer which site a plant occurred on based on position.

    Args:
        position: Position dict with x, y keys
        map_name: Name of the map

    Returns:
        Site identifier ('A', 'B', 'C', or 'unknown')
    """
    if not position or not map_name:
        return 'unknown'

    x = position.get('x')
    y = position.get('y')

    if x is None or y is None:
        return 'unknown'

    map_lower = map_name.lower()
    if map_lower not in SITE_BOUNDARIES:
        return 'unknown'

    for site, bounds in SITE_BOUNDARIES[map_lower].items():
        if (bounds['minX'] <= x <= bounds['maxX'] and
            bounds['minY'] <= y <= bounds['maxY']):
            return site

    # Log unmatched for boundary refinement
    print(f"[WARN] Unmatched plant position on {map_name}: ({x}, {y})")
    return 'unknown'


def extract_round_number_from_state(series_state: Dict) -> Optional[int]:
    """
    Extract round number from seriesState.

    Uses seriesStateDelta.games[0].segments[0].sequenceNumber if available.
    Falls back to computing from team scores.

    Args:
        series_state: seriesState or seriesStateDelta dict

    Returns:
        Round number or None
    """
    if not series_state:
        return None

    games = series_state.get("games", [])
    if not games:
        return None

    game = games[0]

    # Try segments first (more reliable for round number)
    segments = game.get("segments", [])
    if segments and segments[0].get("sequenceNumber") is not None:
        return segments[0].get("sequenceNumber")

    # Fallback to team scores
    teams = game.get("teams", [])
    if teams:
        total_score = 0
        for team in teams:
            score = team.get("score", 0)
            if isinstance(score, int):
                total_score += score
            elif isinstance(score, dict):
                total_score += score.get("main", 0) or 0
        if total_score >= 0:
            return total_score + 1

    return None


def build_team_map(events_path: Path, max_lines: int = None) -> Dict[str, Dict]:
    """
    Build team map from first includesFullState event.

    Args:
        events_path: Path to events.jsonl file
        max_lines: Optional max lines to scan

    Returns:
        Dict mapping team_id -> {name, abbreviation, ...}
    """
    team_map = {}

    for message in iter_messages(events_path, max_lines):
        events_list = message.get("events", [])

        for event in events_list:
            # Check if this event includes full state
            if not event.get("includesFullState"):
                continue

            # Extract teams from actor.state.teams (for series-started-game events)
            actor_state = event.get("actor", {}).get("state", {})
            teams = actor_state.get("teams", [])

            if teams:
                for team in teams:
                    team_id = team.get("id")
                    if team_id and team_id not in team_map:
                        team_map[team_id] = {
                            "id": team_id,
                            "name": team.get("name", ""),
                            "abbreviation": team.get("abbreviation", ""),
                            "side": team.get("side", "")
                        }

            # Also check seriesState.games[].teams if available
            series_state = event.get("seriesState", {})
            games = series_state.get("games", [])

            for game in games:
                game_teams = game.get("teams", [])
                for team in game_teams:
                    team_id = team.get("id")
                    if team_id and team_id not in team_map:
                        team_map[team_id] = {
                            "id": team_id,
                            "name": team.get("name", ""),
                            "abbreviation": team.get("abbreviation", ""),
                            "side": team.get("side", "")
                        }

        # Stop after finding teams
        if team_map:
            break

    return team_map


def build_player_map(events_path: Path, max_lines: int = None) -> Dict[str, str]:
    """
    Build player map from series-started events.

    Args:
        events_path: Path to events.jsonl file
        max_lines: Optional max lines to scan

    Returns:
        Dict mapping player_id -> player_name
    """
    player_map = {}

    for message in iter_messages(events_path, max_lines):
        events_list = message.get("events", [])

        for event in events_list:
            # Look for tournament-started-series or series-started-game events
            if event.get("type") not in ["tournament-started-series", "series-started-game"]:
                continue

            # Extract players from seriesState or actor.state
            series_state = event.get("seriesState", {}) or event.get("actor", {}).get("state", {})
            teams = series_state.get("teams", [])

            for team in teams:
                players = team.get("players", [])
                for player in players:
                    player_id = player.get("id")
                    player_name = player.get("name")
                    if player_id and player_name and player_id not in player_map:
                        player_map[player_id] = player_name

            # Also check game teams for player names
            games = series_state.get("games", [])
            for game in games:
                game_teams = game.get("teams", [])
                for team in game_teams:
                    players = team.get("players", [])
                    for player in players:
                        player_id = player.get("id")
                        player_name = player.get("name")
                        if player_id and player_name and player_id not in player_map:
                            player_map[player_id] = player_name

        # Stop after finding players
        if player_map:
            break

    return player_map


def build_game_map(events_path: Path, max_lines: int = None) -> Dict[str, Dict]:
    """
    Build game map from series-started-game events.

    Args:
        events_path: Path to events.jsonl file
        max_lines: Optional max lines to scan

    Returns:
        Dict mapping game_id -> {mapName, sequenceNumber, ...}
    """
    game_map = {}

    for message in iter_messages(events_path, max_lines):
        events_list = message.get("events", [])

        for event in events_list:
            event_type = event.get("type")

            if event_type == "series-started-game":
                # Get game info from target.state (the game that was started)
                target_state = event.get("target", {}).get("state", {})
                game_id = target_state.get("id")

                if game_id and game_id not in game_map:
                    # Map name is in target.state.map.name
                    map_obj = target_state.get("map", {})
                    map_name = map_obj.get("name", "Unknown") if isinstance(map_obj, dict) else "Unknown"

                    game_map[game_id] = {
                        "id": game_id,
                        "mapName": map_name,
                        "sequenceNumber": target_state.get("sequenceNumber", 0)
                    }

    return game_map


def build_agent_compositions(events_path: Path, max_lines: int = None) -> Dict[str, List[Dict]]:
    """
    Extract agent compositions from series-started-game events.

    Args:
        events_path: Path to events.jsonl file
        max_lines: Optional max lines to scan

    Returns:
        Dict mapping game_id -> list of player agent picks
        Each pick: {playerId, playerName, teamId, agent}
    """
    compositions = {}

    for message in iter_messages(events_path, max_lines):
        events_list = message.get("events", [])

        for event in events_list:
            if event.get("type") != "series-started-game":
                continue

            target_state = event.get("target", {}).get("state", {})
            game_id = target_state.get("id")

            if not game_id or game_id in compositions:
                continue

            game_picks = []
            for team in target_state.get("teams", []):
                team_id = team.get("id")
                for player in team.get("players", []):
                    character = player.get("character", {})
                    if character:
                        game_picks.append({
                            "playerId": player.get("id"),
                            "playerName": player.get("name"),
                            "teamId": team_id,
                            "agent": character.get("name", "unknown")
                        })

            if game_picks:
                compositions[game_id] = game_picks

    return compositions


def extract_evidence(
    events_path: Path,
    series_id: str,
    max_lines: int = None,
    iso_threshold: float = 2500.0
) -> Dict[str, Any]:
    """
    Extract evidence from series events file.

    Args:
        events_path: Path to events.jsonl file
        series_id: Series ID for metadata
        max_lines: Optional max lines to process
        iso_threshold: Distance threshold for isolated deaths

    Returns:
        Evidence dictionary with meta, games, rounds, kills, players, derived
    """
    # Initialize data structures
    team_map = build_team_map(events_path, max_lines)
    game_map = build_game_map(events_path, max_lines)
    player_map = build_player_map(events_path, max_lines)
    agent_compositions = build_agent_compositions(events_path, max_lines)

    rounds: List[Dict] = []
    kills: List[Dict] = []
    plants: List[Dict] = []
    defuses: List[Dict] = []
    clutch_situations: List[Dict] = []
    economy_rounds: List[Dict] = []
    ability_uses: List[Dict] = []
    spike_pickups: List[Dict] = []  # Sprint 3: Track spike pickups

    # Track per-player stats
    player_stats = defaultdict(lambda: {
        "playerId": None,
        "teamId": None,
        "firstBloods": 0,
        "firstDeaths": 0,
        "kills": 0,
        "deaths": 0,
        "isolatedDeathsCount": 0
    })

    # Track round-level data
    round_first_bloods = {}  # (gameId, roundNumber) -> first kill info
    round_winners = {}  # (gameId, roundNumber) -> winner info
    round_team_sides = {}  # (gameId, roundNumber) -> {teamId: side}
    round_clutches = {}  # (gameId, roundNumber) -> {playerId: {situation, opponentsAlive, teamId}}
    round_deaths_by_team = {}  # (gameId, roundNumber) -> {teamId: [playerIds who died]}
    round_teams = {}  # (gameId, roundNumber) -> {teamId: [all playerIds]}
    player_agents = {}  # (gameId, playerId) -> agent name

    # Sprint 1: Track round timings
    round_timings = {}  # (gameId, roundNumber) -> {roundStartTime, firstKillTime, plantTime, roundEndTime}

    # Process events
    for message in iter_messages(events_path, max_lines):
        occurred_at = message.get("occurredAt")
        events_list = message.get("events", [])

        for event in events_list:
            event_type = event.get("type")
            actor = event.get("actor", {})
            target = event.get("target", {})
            series_state = event.get("seriesState", {})
            series_state_delta = event.get("seriesStateDelta", {})

            # Extract game_id and round_number
            game_id = None
            round_number = None

            # Try to get from seriesStateDelta first
            if series_state_delta:
                delta_games = series_state_delta.get("games", [])
                if delta_games:
                    game_id = delta_games[0].get("id")
                    round_number = extract_round_number_from_state(series_state_delta)

            # Fallback to seriesState
            if not game_id or round_number is None:
                state_games = series_state.get("games", [])
                if state_games:
                    game_id = state_games[0].get("id")
                    round_number = extract_round_number_from_state(series_state)

            round_key = (game_id, round_number)

            # Extract team sides from seriesState if available
            if series_state and game_id and round_number is not None:
                state_games = series_state.get("games", [])
                if state_games and round_key not in round_team_sides:
                    game_teams = state_games[0].get("teams", [])
                    sides = {}
                    for team in game_teams:
                        team_id = team.get("id")
                        side = team.get("side")  # "attack" or "defense"
                        if team_id and side:
                            sides[team_id] = side
                    if sides:
                        round_team_sides[round_key] = sides

            # Process team-won-round events
            if event_type == "team-won-round":
                winner_team_id = actor.get("id")

                # Get win type from actor.state.round.winType or target.state.teams[0].winType
                win_type = None
                actor_state = actor.get("state", {})
                actor_round = actor_state.get("round", {})
                win_type = actor_round.get("winType")

                if not win_type:
                    target_state = target.get("state", {})
                    target_teams = target_state.get("teams", [])
                    if target_teams:
                        win_type = target_teams[0].get("winType")

                round_winners[round_key] = {
                    "gameId": game_id,
                    "roundNumber": round_number,
                    "winnerTeamId": winner_team_id,
                    "winType": win_type,
                    "timestamp": occurred_at
                }

                # Sprint 1: Track round end time for tempo analysis
                if round_key not in round_timings:
                    round_timings[round_key] = {}
                round_timings[round_key]["roundEndTime"] = occurred_at

                # Record clutch situation outcomes
                if round_key in round_clutches:
                    for player_id, clutch_info in round_clutches[round_key].items():
                        won = clutch_info["teamId"] == winner_team_id

                        clutch_situations.append({
                            "gameId": game_id,
                            "roundNumber": round_number,
                            "playerId": clutch_info["playerId"],
                            "playerName": clutch_info["playerName"],
                            "teamId": clutch_info["teamId"],
                            "situation": clutch_info["situation"],
                            "opponentsAlive": clutch_info["opponentsAlive"],
                            "won": won
                        })

            # Process player-killed-player events
            elif event_type == "player-killed-player":
                killer_id = actor.get("id")
                victim_id = target.get("id")
                actor_state = actor.get("state", {})
                target_state = target.get("state", {})
                actor_state_delta = actor.get("stateDelta", {})

                killer_team_id = actor_state.get("teamId")
                victim_team_id = target_state.get("teamId")

                # Get positions
                killer_pos = actor_state.get("game", {}).get("position")
                victim_pos = target_state.get("game", {}).get("position")

                # Extract weapon from stateDelta.round.weaponKills
                weapon_kills = actor_state_delta.get("round", {}).get("weaponKills", {})
                weapon = list(weapon_kills.keys())[0] if weapon_kills else None
                weapon_category = classify_weapon(weapon) if weapon else 'unknown'

                # Compute kill distance
                kill_distance = None
                engagement_range = 'unknown'
                if killer_pos and victim_pos:
                    kill_distance = compute_distance(killer_pos, victim_pos)
                    engagement_range = classify_engagement_range(kill_distance)

                # Check if this is first blood for the round
                is_first_blood = round_key not in round_first_bloods

                if is_first_blood:
                    round_first_bloods[round_key] = {
                        "killerId": killer_id,
                        "victimId": victim_id,
                        "killerTeamId": killer_team_id,
                        "timestamp": occurred_at
                    }

                    # Sprint 1: Track first kill time for tempo analysis
                    if round_key not in round_timings:
                        round_timings[round_key] = {}
                    round_timings[round_key]["firstKillTime"] = occurred_at

                    # Update player stats
                    if killer_id:
                        player_stats[killer_id]["playerId"] = killer_id
                        player_stats[killer_id]["teamId"] = killer_team_id
                        player_stats[killer_id]["firstBloods"] += 1

                    if victim_id:
                        player_stats[victim_id]["playerId"] = victim_id
                        player_stats[victim_id]["teamId"] = victim_team_id
                        player_stats[victim_id]["firstDeaths"] += 1

                # Compute Bad Spot isolation for victim
                nearest_teammate_distance = float('inf')

                if victim_pos and series_state:
                    # Find victim's teammates positions from seriesState
                    state_games = series_state.get("games", [])
                    if state_games:
                        state_teams = state_games[0].get("teams", [])
                        for team in state_teams:
                            if team.get("id") == victim_team_id:
                                players = team.get("players", [])
                                for player in players:
                                    player_id = player.get("id")
                                    # Skip the victim themselves
                                    if player_id == victim_id:
                                        continue

                                    player_pos = player.get("position")
                                    if player_pos:
                                        distance = compute_distance(victim_pos, player_pos)
                                        if distance < nearest_teammate_distance:
                                            nearest_teammate_distance = distance

                # Track isolated death
                is_isolated = nearest_teammate_distance > iso_threshold
                if is_isolated and victim_id:
                    player_stats[victim_id]["isolatedDeathsCount"] += 1

                # Update kill/death counts
                if killer_id:
                    player_stats[killer_id]["playerId"] = killer_id
                    player_stats[killer_id]["teamId"] = killer_team_id
                    player_stats[killer_id]["kills"] += 1

                if victim_id:
                    player_stats[victim_id]["playerId"] = victim_id
                    player_stats[victim_id]["teamId"] = victim_team_id
                    player_stats[victim_id]["deaths"] += 1

                # Record kill event
                kills.append({
                    "gameId": game_id,
                    "roundNumber": round_number,
                    "timestamp": occurred_at,
                    "killerId": killer_id,
                    "victimId": victim_id,
                    "killerTeamId": killer_team_id,
                    "victimTeamId": victim_team_id,
                    "killerPosition": killer_pos,
                    "victimPosition": victim_pos,
                    "nearestTeammateDistance": nearest_teammate_distance if nearest_teammate_distance != float('inf') else None,
                    "isIsolated": is_isolated,
                    "isFirstBlood": is_first_blood,
                    # Sprint 1: Weapon and engagement data
                    "weapon": weapon,
                    "weaponCategory": weapon_category,
                    "killDistance": kill_distance,
                    "engagementRange": engagement_range
                })

                # Track deaths for clutch detection
                if round_key and victim_team_id and victim_id:
                    if round_key not in round_deaths_by_team:
                        round_deaths_by_team[round_key] = {}
                    if victim_team_id not in round_deaths_by_team[round_key]:
                        round_deaths_by_team[round_key][victim_team_id] = []
                    round_deaths_by_team[round_key][victim_team_id].append(victim_id)

                # Track team rosters (get from seriesState if available)
                if series_state and round_key and round_key not in round_teams:
                    state_games = series_state.get("games", [])
                    if state_games:
                        game_teams = state_games[0].get("teams", [])
                        round_teams[round_key] = {}
                        for team in game_teams:
                            team_id = team.get("id")
                            player_ids = [p.get("id") for p in team.get("players", [])]
                            player_names = {p.get("id"): p.get("name") for p in team.get("players", [])}
                            round_teams[round_key][team_id] = {
                                "playerIds": player_ids,
                                "playerNames": player_names
                            }

                # Check for clutch situations
                if round_key in round_teams and round_key in round_deaths_by_team:
                    team_alive_counts = {}
                    team_alive_player = {}

                    for team_id, team_info in round_teams[round_key].items():
                        all_players = set(team_info["playerIds"])
                        dead_players = set(round_deaths_by_team[round_key].get(team_id, []))
                        alive_players = all_players - dead_players
                        alive_count = len(alive_players)

                        team_alive_counts[team_id] = alive_count
                        if alive_count == 1:
                            alive_player_id = list(alive_players)[0]
                            team_alive_player[team_id] = {
                                "id": alive_player_id,
                                "name": team_info["playerNames"].get(alive_player_id, f"Player {alive_player_id}"),
                                "teamId": team_id
                            }

                    # Check if any team has exactly 1 alive player (clutch situation)
                    for team_id, alive_count in team_alive_counts.items():
                        if alive_count == 1 and team_id in team_alive_player:
                            # Get opponent alive count
                            opponent_alive = sum(count for tid, count in team_alive_counts.items() if tid != team_id)

                            if opponent_alive >= 1:
                                # This is a clutch situation!
                                clutch_player = team_alive_player[team_id]

                                # Only record if we haven't seen this clutch before in this round
                                if round_key not in round_clutches:
                                    round_clutches[round_key] = {}

                                if clutch_player["id"] not in round_clutches[round_key]:
                                    situation = f"1v{opponent_alive}"
                                    round_clutches[round_key][clutch_player["id"]] = {
                                        "playerId": clutch_player["id"],
                                        "playerName": clutch_player["name"],
                                        "teamId": clutch_player["teamId"],
                                        "situation": situation,
                                        "opponentsAlive": opponent_alive
                                    }

            # Process plant events
            elif event_type == "player-completed-plantBomb":
                planter_id = actor.get("id")
                actor_state = actor.get("state", {})
                planter_team_id = actor_state.get("teamId")
                plant_pos = actor_state.get("game", {}).get("position")

                # Infer site from plant position
                map_name = game_map.get(game_id, {}).get("mapName", "")
                site = infer_plant_site(plant_pos, map_name)

                plants.append({
                    "gameId": game_id,
                    "roundNumber": round_number,
                    "timestamp": occurred_at,
                    "planterId": planter_id,
                    "planterTeamId": planter_team_id,
                    "position": plant_pos,
                    "site": site
                })

                # Sprint 1: Track plant time for tempo analysis
                if round_key not in round_timings:
                    round_timings[round_key] = {}
                round_timings[round_key]["plantTime"] = occurred_at

            # Process defuse events
            elif event_type == "player-completed-defuseBomb":
                defuser_id = actor.get("id")
                actor_state = actor.get("state", {})
                defuser_team_id = actor_state.get("teamId")
                defuse_pos = actor_state.get("game", {}).get("position")

                defuses.append({
                    "gameId": game_id,
                    "roundNumber": round_number,
                    "timestamp": occurred_at,
                    "defuserId": defuser_id,
                    "defuserTeamId": defuser_team_id,
                    "position": defuse_pos
                })

            # Sprint 3: Process spike pickup events
            elif event_type == "player-pickedUp-item":
                target_item = target.get("id", "")
                if target_item == "spike":
                    picker_id = actor.get("id")
                    actor_state = actor.get("state", {})
                    picker_team_id = actor_state.get("teamId")
                    picker_pos = actor_state.get("game", {}).get("position")

                    spike_pickups.append({
                        "gameId": game_id,
                        "roundNumber": round_number,
                        "timestamp": occurred_at,
                        "playerId": picker_id,
                        "teamId": picker_team_id,
                        "position": picker_pos
                    })

            # Process economy data from round-ended-freezetime
            elif event_type == "round-ended-freezetime":
                # Extract economy data from seriesState
                if series_state:
                    state_games = series_state.get("games", [])
                    if state_games and game_id and round_number is not None:
                        game = state_games[0]
                        game_teams = game.get("teams", [])

                        for team in game_teams:
                            team_id = team.get("id")
                            team_name = team.get("name", "Unknown")
                            team_loadout = team.get("loadoutValue", 0)

                            # Get player loadouts
                            players = team.get("players", [])
                            player_count = len(players) if players else 5  # Default to 5 if not available

                            # Calculate average loadout value
                            avg_loadout = team_loadout / player_count if player_count > 0 else 0

                            # Classify economy tier
                            economy_tier = classify_economy(avg_loadout)

                            # Determine if previous round was won (will be filled in later during derived stats)
                            # For now, we'll set it to None and compute it in post-processing

                            # Build player loadouts list
                            player_loadouts = [
                                {
                                    "playerId": player.get("id"),
                                    "loadoutValue": player.get("loadoutValue", 0)
                                }
                                for player in players
                            ] if players else []

                            economy_rounds.append({
                                "gameId": game_id,
                                "roundNumber": round_number,
                                "teamId": team_id,
                                "teamName": team_name,
                                "avgLoadoutValue": int(avg_loadout),
                                "totalLoadoutValue": team_loadout,
                                "economyTier": economy_tier,
                                "previousRoundWon": None,  # Will be computed later
                                "roundWon": None,  # Will be filled when round ends
                                "playerLoadouts": player_loadouts
                            })

                        # Sprint 1: Track round start time (freezetime end = round active start)
                        if round_key not in round_timings:
                            round_timings[round_key] = {}
                        round_timings[round_key]["roundStartTime"] = occurred_at

            # Process ability usage events
            elif event_type == "player-used-ability":
                player_id = actor.get("id")
                actor_state = actor.get("state", {})
                target_data = target.get("state", {}) or target.get("stateDelta", {})

                player_team_id = actor_state.get("teamId")
                player_pos = actor_state.get("game", {}).get("position")

                ability_id = target_data.get("id")
                ability_name = target_data.get("name", "unknown")

                # Get agent name from player_agents mapping or agent_compositions
                agent_name = "unknown"
                agent_key = (game_id, player_id)

                # First check if we already have it cached
                if agent_key in player_agents:
                    agent_name = player_agents[agent_key]
                # Try to get from agent_compositions
                elif game_id in agent_compositions:
                    for pick in agent_compositions[game_id]:
                        if pick.get("playerId") == player_id:
                            agent_name = pick.get("agent", "unknown")
                            player_agents[agent_key] = agent_name
                            break

                ability_uses.append({
                    "gameId": game_id,
                    "roundNumber": round_number,
                    "timestamp": occurred_at,
                    "playerId": player_id,
                    "teamId": player_team_id,
                    "agent": agent_name,
                    "abilityId": ability_id,
                    "abilityName": ability_name,
                    "position": player_pos
                })

    # Build rounds list from round_winners
    for round_key, round_info in sorted(round_winners.items(), key=lambda x: (x[0][0] or "", x[0][1] or 0)):
        game_id, round_number = round_key
        first_blood_info = round_first_bloods.get(round_key)
        round_plants = [p for p in plants if p["gameId"] == game_id and p["roundNumber"] == round_number]
        round_defuses = [d for d in defuses if d["gameId"] == game_id and d["roundNumber"] == round_number]

        # Determine winner's side
        winner_team_id = round_info["winnerTeamId"]
        winner_side = None
        sides = round_team_sides.get(round_key, {})
        if winner_team_id in sides:
            raw_side = sides[winner_team_id]
            # Normalize GRID's "attacker"/"defender" to "attack"/"defense"
            if raw_side == "attacker":
                winner_side = "attack"
            elif raw_side == "defender":
                winner_side = "defense"
            else:
                winner_side = raw_side  # Keep as-is if unexpected value

        rounds.append({
            "gameId": game_id,
            "roundNumber": round_number,
            "winnerTeamId": round_info["winnerTeamId"],
            "winType": round_info["winType"],
            "winnerSide": winner_side,
            "firstBlood": first_blood_info,
            "hadPlant": len(round_plants) > 0,
            "hadDefuse": len(round_defuses) > 0
        })

    # Post-process economy rounds to fill in roundWon and previousRoundWon
    # First, build a map of round winners for quick lookup
    round_winner_map = {(r["gameId"], r["roundNumber"]): r["winnerTeamId"] for r in rounds}

    for eco_round in economy_rounds:
        game_id = eco_round["gameId"]
        round_num = eco_round["roundNumber"]
        team_id = eco_round["teamId"]

        # Fill in roundWon
        winner = round_winner_map.get((game_id, round_num))
        eco_round["roundWon"] = (winner == team_id) if winner else False

        # Fill in previousRoundWon
        # Pistol rounds (1, 13) have no previous round
        if round_num == 1 or round_num == 13:
            eco_round["previousRoundWon"] = None
        else:
            prev_winner = round_winner_map.get((game_id, round_num - 1))
            eco_round["previousRoundWon"] = (prev_winner == team_id) if prev_winner else None

    # Build players list
    players = [
        {
            "playerId": stats["playerId"],
            "playerName": player_map.get(stats["playerId"], f"Player {stats['playerId']}"),
            "teamId": stats["teamId"],
            "firstBloods": stats["firstBloods"],
            "firstDeaths": stats["firstDeaths"],
            "kills": stats["kills"],
            "deaths": stats["deaths"],
            "kd": stats["kills"] / stats["deaths"] if stats["deaths"] > 0 else stats["kills"],
            "isolatedDeathsCount": stats["isolatedDeathsCount"]
        }
        for player_id, stats in sorted(player_stats.items())
        if stats["playerId"]
    ]

    # Compute derived stats (pass round_timings for Sprint 1 tempo analysis, game_map for Sprint 2 post-plant stats)
    # Sprint 3: Pass additional params for new analytics
    derived = compute_derived_stats(
        rounds, plants, clutch_situations, economy_rounds, ability_uses, kills,
        team_map, player_map, round_timings, game_map,
        defuses=defuses, spike_pickups=spike_pickups, round_team_sides=round_team_sides
    )

    # Sprint 4: Populate composition stats (requires evidence structure)
    # Build temporary evidence dict for composition extraction
    temp_evidence = {
        'games': [
            {'gameId': g_id, 'mapName': g_info.get('mapName', 'Unknown')}
            for g_id, g_info in game_map.items()
        ],
        'rounds': rounds,
        'agentCompositions': agent_compositions
    }
    composition_data = extract_composition_data(temp_evidence)
    derived['compositionStats'] = compute_composition_stats(composition_data, team_map)

    # Filter games to only include those that have rounds
    # This handles cases where a game was started but had no rounds (technical issues, remakes, etc.)
    game_ids_with_rounds = set(r["gameId"] for r in rounds if r.get("gameId"))
    filtered_games = [
        game_info for game_id, game_info in game_map.items()
        if game_id in game_ids_with_rounds
    ]

    # Build final evidence structure
    evidence = {
        "meta": {
            "seriesId": series_id,
            "extractedAt": None,  # Will be set by caller
            "version": "v1",
            "maxLinesProcessed": max_lines,
            "isoThreshold": iso_threshold
        },
        "games": [
            {
                "gameId": game_info["id"],
                "mapName": game_info["mapName"],
                "sequenceNumber": game_info["sequenceNumber"]
            }
            for game_info in sorted(filtered_games, key=lambda x: x["sequenceNumber"])
        ],
        "rounds": rounds,
        "kills": kills,
        "plants": plants,
        "defuses": defuses,
        "clutchSituations": clutch_situations,
        "economyRounds": economy_rounds,
        "abilityUses": ability_uses,
        "players": players,
        "derived": derived,
        "agentCompositions": {
            game_id: picks for game_id, picks in agent_compositions.items()
            if game_id in game_ids_with_rounds
        }
    }

    # Sprint 5: Compute advanced intelligence stats (require full evidence)
    # Compute round states for win probability
    streaks = detect_round_streaks(rounds, team_map)
    round_states = [
        compute_round_state(r, kills, economy_rounds, plants, streaks, team_map)
        for r in rounds
    ]
    round_states = [rs for rs in round_states if rs]  # Filter empty states

    # Win probability factors and stats
    probability_factors = compute_win_probability_factors(round_states, team_map)
    evidence['derived']['winProbabilityStats'] = compute_win_probability_stats(
        round_states, probability_factors, team_map
    )

    # Scenario analysis
    evidence['derived']['scenarioAnalysis'] = compute_scenario_analysis(
        round_states, probability_factors, team_map
    )

    # Coaching recommendations
    evidence['derived']['coachingRecommendations'] = compute_coaching_recommendation_stats(
        evidence, team_map
    )

    # Scouting reports
    evidence['derived']['scoutingReports'] = compute_scouting_report_stats(
        evidence, team_map, player_map
    )

    # Performance benchmarks
    evidence['derived']['benchmarkStats'] = compute_benchmark_stats(
        evidence, team_map, player_map
    )

    # Coaching reports (comprehensive)
    evidence['derived']['coachingReports'] = compose_coaching_report(
        evidence, team_map, player_map
    )

    # Sprint 6: Compute ADR, KAST, ACS, highlights, and significance filtering
    if SPRINT6_AVAILABLE:
        try:
            # Gather derived stats needed for Sprint 6
            trade_stats = evidence['derived'].get('tradeStats', [])
            multi_kill_stats = evidence['derived'].get('multiKillStats', [])
            first_blood_stats = evidence['derived'].get('firstBloodStats', [])

            sprint6_stats = compute_sprint6_stats(
                rounds=rounds,
                kills=kills,
                plants=plants,
                clutch_situations=clutch_situations,
                economy_rounds=economy_rounds,
                first_blood_stats=first_blood_stats,
                multi_kill_stats=multi_kill_stats,
                trade_stats=trade_stats,
                player_map=player_map,
                team_map=team_map
            )

            # Add Sprint 6 stats to derived
            if sprint6_stats.get('playerDamageStats'):
                evidence['derived']['playerDamageStats'] = sprint6_stats['playerDamageStats']
            if sprint6_stats.get('kastStats'):
                evidence['derived']['kastStats'] = sprint6_stats['kastStats']
            if sprint6_stats.get('acsStats'):
                evidence['derived']['acsStats'] = sprint6_stats['acsStats']
            if sprint6_stats.get('highlightStats'):
                evidence['derived']['highlightStats'] = sprint6_stats['highlightStats']
            if sprint6_stats.get('significanceFilters'):
                evidence['derived']['significanceFilters'] = sprint6_stats['significanceFilters']

        except Exception as e:
            print(f"Warning: Sprint 6 analytics failed: {e}")

    return evidence


def build_site_stats_by_team(site_attack_stats: Dict, site_defense_stats: Dict, team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Build site stats split by attack/defense for each team.

    Args:
        site_attack_stats: Dict mapping (site, team_id) -> attack stats
        site_defense_stats: Dict mapping (site, team_id) -> defense stats
        team_map: Team ID to team info mapping

    Returns:
        List of site stats with attack/defense breakdown
    """
    # Group by site
    sites = set()
    for (site, team_id) in site_attack_stats.keys():
        sites.add(site)
    for (site, team_id) in site_defense_stats.keys():
        sites.add(site)

    site_stats_list = []
    for site in sorted(sites):
        # Build attack stats for this site
        attack_stats_by_team = {}
        for (s, team_id), stats in site_attack_stats.items():
            if s == site:
                team_info = team_map.get(team_id, {})
                plants = stats['plants']
                wins = stats['postPlantWins']
                attack_stats_by_team[team_id] = {
                    'teamId': team_id,
                    'teamName': team_info.get('name', 'Unknown'),
                    'plants': plants,
                    'postPlantWins': wins,
                    'postPlantWinRate': wins / plants if plants > 0 else 0
                }

        # Build defense stats for this site
        defense_stats_by_team = {}
        for (s, team_id), stats in site_defense_stats.items():
            if s == site:
                team_info = team_map.get(team_id, {})
                attempts = stats['defenseAttempts']
                wins = stats['defenseWins']
                defense_stats_by_team[team_id] = {
                    'teamId': team_id,
                    'teamName': team_info.get('name', 'Unknown'),
                    'defenseAttempts': attempts,
                    'defenseWins': wins,
                    'defenseWinRate': wins / attempts if attempts > 0 else 0
                }

        # Build combined site stat entry
        site_stat = {
            'site': site,
            'attackStats': attack_stats_by_team,
            'defenseStats': defense_stats_by_team
        }
        site_stats_list.append(site_stat)

    return site_stats_list


def compute_derived_stats(
    rounds: List[Dict],
    plants: List[Dict],
    clutch_situations: List[Dict],
    economy_rounds: List[Dict],
    ability_uses: List[Dict],
    kills: List[Dict],
    team_map: Dict[str, Dict],
    player_map: Dict[str, Dict],
    round_timings: Dict = None,
    game_map: Dict[str, Dict] = None,
    defuses: List[Dict] = None,
    spike_pickups: List[Dict] = None,
    round_team_sides: Dict = None
) -> Dict:
    """
    Compute derived statistics from rounds, plants, clutch situations, economy, ability usage, and kills.

    Args:
        rounds: List of round data
        plants: List of plant events
        clutch_situations: List of clutch situations
        economy_rounds: List of economy round data
        ability_uses: List of ability usage events
        kills: List of kill events
        team_map: Team ID to team info mapping
        player_map: Player ID to player info mapping
        round_timings: Sprint 1 - round timing data for tempo analysis
        game_map: Sprint 2 - game ID to map info mapping for post-plant stats
        defuses: Sprint 3 - defuse events for retake analysis
        spike_pickups: Sprint 3 - spike pickup events for carrier analysis
        round_team_sides: Sprint 3 - round team side mapping for entry analysis

    Returns:
        Derived stats dictionary
    """
    if round_timings is None:
        round_timings = {}
    if game_map is None:
        game_map = {}
    if defuses is None:
        defuses = []
    if spike_pickups is None:
        spike_pickups = []
    if round_team_sides is None:
        round_team_sides = {}
    # Group rounds by game and team
    game_rounds = defaultdict(lambda: defaultdict(list))
    for round_data in rounds:
        game_id = round_data["gameId"]
        winner_id = round_data["winnerTeamId"]
        game_rounds[game_id][winner_id].append(round_data)

    # Compute per-game stats
    maps_stats = []
    for game_id, team_round_map in game_rounds.items():
        total_rounds = sum(len(rounds_list) for rounds_list in team_round_map.values())

        for team_id, team_rounds in team_round_map.items():
            team_info = team_map.get(team_id, {})

            maps_stats.append({
                "gameId": game_id,
                "teamId": team_id,
                "teamName": team_info.get("name", "Unknown"),
                "roundsWon": len(team_rounds),
                "totalRounds": total_rounds
            })

    # First blood conversion
    first_blood_stats = defaultdict(lambda: {"firstBloods": 0, "roundsWon": 0})

    for round_data in rounds:
        first_blood = round_data.get("firstBlood")
        if first_blood:
            killer_team_id = first_blood.get("killerTeamId")
            winner_team_id = round_data.get("winnerTeamId")

            if killer_team_id:
                first_blood_stats[killer_team_id]["firstBloods"] += 1
                if killer_team_id == winner_team_id:
                    first_blood_stats[killer_team_id]["roundsWon"] += 1

    # Plant stats
    plant_stats = defaultdict(lambda: {"plants": 0, "postPlantWins": 0})

    for plant in plants:
        planter_team_id = plant.get("planterTeamId")
        game_id = plant.get("gameId")
        round_number = plant.get("roundNumber")

        if planter_team_id:
            plant_stats[planter_team_id]["plants"] += 1

            # Find if this team won this round
            for round_data in rounds:
                if round_data["gameId"] == game_id and round_data["roundNumber"] == round_number:
                    if round_data["winnerTeamId"] == planter_team_id:
                        plant_stats[planter_team_id]["postPlantWins"] += 1
                    break

    # Site stats - split by attack/defense
    # Track stats by (site, attacking_team_id) for attack-side stats
    # Track stats by (site, defending_team_id) for defense-side stats
    site_attack_stats = defaultdict(lambda: {
        'plants': 0,
        'postPlantWins': 0,
    })
    site_defense_stats = defaultdict(lambda: {
        'defenseAttempts': 0,  # Rounds where this team defended this site
        'defenseWins': 0,      # Successful defenses
    })

    for plant in plants:
        site = plant.get('site', 'unknown')
        if site == 'unknown':
            continue

        game_id = plant.get('gameId')
        round_num = plant.get('roundNumber')
        planter_team = plant.get('planterTeamId')

        # Track attacking team stats (team that planted)
        attack_key = (site, planter_team)
        site_attack_stats[attack_key]['plants'] += 1

        # Find corresponding round outcome
        for r in rounds:
            if r.get('gameId') == game_id and r.get('roundNumber') == round_num:
                winner_team = r.get('winnerTeamId')

                # Post-plant win for attacking team
                if winner_team == planter_team:
                    site_attack_stats[attack_key]['postPlantWins'] += 1

                # Find defending team (all teams that aren't the planter team)
                # Get all teams from first_blood_stats or plant_stats
                all_teams = set(team_id for team_id in first_blood_stats.keys())
                defending_team = None
                for team_id in all_teams:
                    if team_id != planter_team:
                        defending_team = team_id
                        break

                if defending_team:
                    defense_key = (site, defending_team)
                    site_defense_stats[defense_key]['defenseAttempts'] += 1

                    # Successful defense = defender won the round
                    if winner_team == defending_team:
                        site_defense_stats[defense_key]['defenseWins'] += 1

                break

    # Clutch stats
    clutch_stats_by_player = defaultdict(lambda: {
        'clutchAttempts': 0,
        'clutchWins': 0,
        'breakdown': defaultdict(lambda: {'attempts': 0, 'wins': 0})
    })

    for clutch in clutch_situations:
        player_id = clutch.get('playerId')
        situation = clutch.get('situation', 'unknown')
        won = clutch.get('won', False)

        if player_id:
            clutch_stats_by_player[player_id]['clutchAttempts'] += 1
            if won:
                clutch_stats_by_player[player_id]['clutchWins'] += 1

            clutch_stats_by_player[player_id]['breakdown'][situation]['attempts'] += 1
            if won:
                clutch_stats_by_player[player_id]['breakdown'][situation]['wins'] += 1

    # Sprint 2: Compute ability-kill correlations
    ability_correlations = compute_ability_kill_correlation(ability_uses, kills)

    return {
        "mapsStats": maps_stats,
        "firstBloodStats": [
            {
                "teamId": team_id,
                "teamName": team_map.get(team_id, {}).get("name", "Unknown"),
                "firstBloods": stats["firstBloods"],
                "roundsWon": stats["roundsWon"],
                "conversionRate": stats["roundsWon"] / stats["firstBloods"] if stats["firstBloods"] > 0 else 0
            }
            for team_id, stats in sorted(first_blood_stats.items())
        ],
        "plantStats": [
            {
                "teamId": team_id,
                "teamName": team_map.get(team_id, {}).get("name", "Unknown"),
                "plants": stats["plants"],
                "postPlantWins": stats["postPlantWins"],
                "postPlantWinRate": stats["postPlantWins"] / stats["plants"] if stats["plants"] > 0 else 0
            }
            for team_id, stats in sorted(plant_stats.items())
        ],
        "siteStats": build_site_stats_by_team(site_attack_stats, site_defense_stats, team_map),
        "clutchStats": [
            {
                "playerId": player_id,
                "playerName": player_map.get(player_id, f"Player {player_id}"),
                "teamId": next((c.get("teamId") for c in clutch_situations if c.get("playerId") == player_id), "Unknown"),
                "teamName": team_map.get(
                    next((c.get("teamId") for c in clutch_situations if c.get("playerId") == player_id), "Unknown"),
                    {}
                ).get("name", "Unknown"),
                "clutchAttempts": stats["clutchAttempts"],
                "clutchWins": stats["clutchWins"],
                "clutchRate": stats["clutchWins"] / stats["clutchAttempts"] if stats["clutchAttempts"] > 0 else 0,
                "breakdown": {
                    situation: {
                        "attempts": breakdown_stats["attempts"],
                        "wins": breakdown_stats["wins"]
                    }
                    for situation, breakdown_stats in sorted(stats["breakdown"].items())
                }
            }
            for player_id, stats in sorted(clutch_stats_by_player.items(), key=lambda x: x[1]["clutchAttempts"], reverse=True)
        ],
        "economyStats": compute_economy_stats(economy_rounds, team_map),
        "abilityStats": compute_ability_stats(ability_uses, rounds, player_map, team_map),
        "openingDuelStats": compute_opening_duel_stats(rounds, kills, player_map, team_map),
        **compute_multikill_stats(kills, player_map, team_map),
        **compute_trade_stats(kills, player_map, team_map),
        # Sprint 1: New analytics
        "weaponStats": compute_weapon_stats(kills, player_map, team_map),
        "engagementStats": compute_engagement_stats(kills, player_map, team_map),
        "tempoStats": compute_tempo_stats(rounds, plants, round_timings, team_map),
        "saveRoundStats": compute_save_round_stats(economy_rounds, kills, rounds, team_map),
        "antiEcoStats": compute_anti_eco_stats(economy_rounds, rounds, kills, team_map),
        "halfStats": compute_half_stats(rounds, economy_rounds, team_map),
        # Sprint 2: Tactical Depth & Ability Analytics
        "abilityCorrelations": ability_correlations,
        "abilityImpactStats": compute_ability_impact_stats(ability_correlations, ability_uses, player_map, team_map),
        "teamUtilityStats": compute_team_utility_coordination(ability_correlations, ability_uses, team_map),
        "postPlantStats": compute_postplant_position_stats(kills, plants, rounds, game_map, team_map, player_map),
        "matchupStats": compute_matchup_stats(kills, player_map, team_map),
        "mapControlStats": compute_map_control_stats(kills, rounds, game_map, team_map),
        # Sprint 3: Strategic Situational Analytics
        "pistolStats": compute_pistol_stats(
            identify_pistol_and_bonus_rounds(rounds, economy_rounds),
            kills, rounds, player_map, team_map
        ),
        "manAdvantageStats": compute_man_advantage_stats(kills, rounds, player_map, team_map),
        "retakeStats": compute_retake_stats(
            identify_retake_rounds(rounds, plants, kills, defuses, team_map),
            player_map, team_map
        ),
        "entryStats": compute_entry_stats(
            identify_entry_attempts(kills, rounds, ability_uses, round_team_sides),
            player_map, team_map
        ),
        "spikeCarrierStats": compute_spike_carrier_stats(
            plants, kills, rounds, spike_pickups, player_map, team_map
        ),
        # Sprint 4: Pattern Recognition & Predictive Analytics
        "streakStats": compute_momentum_stats(
            detect_round_streaks(rounds, team_map),
            rounds, clutch_situations, economy_rounds, team_map
        ),
        "criticalRounds": compute_critical_round_stats(
            identify_critical_rounds(
                rounds,
                [compute_round_importance(r, {'rounds': rounds, 'games': []}, clutch_situations, economy_rounds,
                                          detect_round_streaks(rounds, team_map)) for r in rounds],
                clutch_situations,
                detect_round_streaks(rounds, team_map),
                team_map
            ),
            rounds, team_map
        ),
        "executePatternStats": compute_execute_pattern_stats(
            cluster_execute_patterns(
                [extract_execute_signature(r, kills, plants, ability_uses, round_team_sides) for r in rounds]
            ),
            team_map
        ),
        "performanceTrendStats": compute_performance_trend_stats(
            [detect_performance_trends(
                compute_round_by_round_performance(
                    [r for r in rounds if r.get('winnerTeamId') == tid or (r.get('winnerTeamId') != tid)],
                    kills, economy_rounds, player_map, tid
                )
            ) for tid in team_map.keys()],
            team_map
        ),
        "compositionStats": compute_composition_stats([], team_map),  # Populated in extract_evidence
        # Sprint 5: Advanced Intelligence & Coaching Automation
        # Note: Win probability and scenario analysis require full evidence dict
        # They are computed in extract_evidence after derived stats are assembled
    }


def compute_economy_stats(economy_rounds: List[Dict], team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute economy statistics by team.

    Args:
        economy_rounds: List of economy round data
        team_map: Team ID to team info mapping

    Returns:
        List of economy stats by team
    """
    # Group economy rounds by team
    team_economy = defaultdict(lambda: {
        'byTier': defaultdict(lambda: {'rounds': 0, 'wins': 0}),
        'afterLoss': defaultdict(lambda: {'rounds': 0, 'wins': 0}),
        'afterWin': defaultdict(lambda: {'rounds': 0, 'wins': 0}),
        'forceAfterPistolLoss': {'attempts': 0, 'wins': 0}
    })

    for eco_round in economy_rounds:
        team_id = eco_round.get('teamId')
        tier = eco_round.get('economyTier', 'unknown')
        won = eco_round.get('roundWon', False)
        prev_won = eco_round.get('previousRoundWon')
        round_num = eco_round.get('roundNumber', 0)

        if not team_id or tier == 'unknown':
            continue

        # Overall by tier
        team_economy[team_id]['byTier'][tier]['rounds'] += 1
        if won:
            team_economy[team_id]['byTier'][tier]['wins'] += 1

        # After loss/win patterns
        if prev_won is not None:
            if prev_won:
                team_economy[team_id]['afterWin'][tier]['rounds'] += 1
                if won:
                    team_economy[team_id]['afterWin'][tier]['wins'] += 1
            else:
                team_economy[team_id]['afterLoss'][tier]['rounds'] += 1
                if won:
                    team_economy[team_id]['afterLoss'][tier]['wins'] += 1

        # Force buy after pistol loss (round 2 or 14 with eco/half_buy after losing pistol)
        if (round_num == 2 or round_num == 14) and prev_won == False:
            if tier in ['eco', 'half_buy']:
                team_economy[team_id]['forceAfterPistolLoss']['attempts'] += 1
                if won:
                    team_economy[team_id]['forceAfterPistolLoss']['wins'] += 1

    # Build output list
    economy_stats = []
    for team_id, stats in sorted(team_economy.items()):
        team_info = team_map.get(team_id, {})

        # Convert defaultdicts to regular dicts with winRate
        by_tier = {}
        for tier, tier_stats in stats['byTier'].items():
            rounds = tier_stats['rounds']
            wins = tier_stats['wins']
            by_tier[tier] = {
                'rounds': rounds,
                'wins': wins,
                'winRate': wins / rounds if rounds > 0 else 0
            }

        after_loss = {}
        for tier, tier_stats in stats['afterLoss'].items():
            rounds = tier_stats['rounds']
            wins = tier_stats['wins']
            after_loss[tier] = {
                'rounds': rounds,
                'wins': wins,
                'winRate': wins / rounds if rounds > 0 else 0
            }

        after_win = {}
        for tier, tier_stats in stats['afterWin'].items():
            rounds = tier_stats['rounds']
            wins = tier_stats['wins']
            after_win[tier] = {
                'rounds': rounds,
                'wins': wins,
                'winRate': wins / rounds if rounds > 0 else 0
            }

        # Force after pistol loss
        force_attempts = stats['forceAfterPistolLoss']['attempts']
        force_wins = stats['forceAfterPistolLoss']['wins']
        force_after_pistol = {
            'attempts': force_attempts,
            'wins': force_wins,
            'winRate': force_wins / force_attempts if force_attempts > 0 else 0
        } if force_attempts > 0 else None

        economy_stat = {
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'byTier': by_tier,
            'afterLoss': after_loss,
            'afterWin': after_win
        }

        if force_after_pistol:
            economy_stat['forceAfterPistolLoss'] = force_after_pistol

        economy_stats.append(economy_stat)

    return economy_stats


def compute_ability_stats(ability_uses: List[Dict], rounds: List[Dict], player_map: Dict[str, str], team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute ability usage statistics per player.

    Args:
        ability_uses: List of ability usage events
        rounds: List of round data
        player_map: Player ID to player name mapping
        team_map: Team ID to team info mapping

    Returns:
        List of player ability stats with per-agent breakdown
    """
    # Group by player -> agent -> ability
    player_ability_stats = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    player_agents = defaultdict(set)
    player_teams = {}
    rounds_played = defaultdict(set)

    for use in ability_uses:
        player_id = use.get("playerId")
        agent = use.get("agent", "unknown")
        ability = use.get("abilityName", "unknown")
        round_key = (use.get("gameId"), use.get("roundNumber"))

        if player_id and agent != "unknown":
            player_ability_stats[player_id][agent][ability] += 1
            player_agents[player_id].add(agent)
            player_teams[player_id] = use.get("teamId")
            rounds_played[player_id].add(round_key)

    # Build output
    stats = []
    for player_id, agent_stats in player_ability_stats.items():
        total_abilities = sum(
            sum(abilities.values())
            for abilities in agent_stats.values()
        )
        rounds_count = len(rounds_played[player_id])

        agent_breakdown = []
        for agent, abilities in agent_stats.items():
            ability_list = [
                {"name": name, "uses": count}
                for name, count in sorted(abilities.items(), key=lambda x: -x[1])
            ]
            agent_breakdown.append({
                "agent": agent,
                "totalUses": sum(abilities.values()),
                "abilities": ability_list
            })

        team_id = player_teams.get(player_id)
        team_info = team_map.get(team_id, {}) if team_id else {}

        stats.append({
            "playerId": player_id,
            "playerName": player_map.get(player_id, f"Player {player_id}"),
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            "totalAbilityUses": total_abilities,
            "roundsPlayed": rounds_count,
            "abilitiesPerRound": round(total_abilities / rounds_count, 2) if rounds_count > 0 else 0,
            "agentBreakdown": sorted(agent_breakdown, key=lambda x: -x["totalUses"])
        })

    return sorted(stats, key=lambda x: -x["totalAbilityUses"])


def compute_trade_stats(kills: List[Dict], player_map: Dict[str, str], team_map: Dict[str, Dict]) -> Dict:
    """
    Compute trade kill statistics from kill events.

    A trade occurs when:
    1. Player A kills Player B
    2. Within TRADE_WINDOW_SECONDS, a teammate of Player B kills Player A

    Args:
        kills: List of kill events with timestamps
        player_map: Player ID to name mapping
        team_map: Team ID to team info mapping

    Returns:
        Dict with tradeKills list and tradeStats per player
    """
    from datetime import datetime

    # Parse timestamps and group kills by round
    round_kills = defaultdict(list)
    for kill in kills:
        ts = kill.get("timestamp")
        if not ts:
            continue

        try:
            # Parse ISO timestamp
            if ts.endswith('Z'):
                ts = ts[:-1] + '+00:00'
            parsed_ts = datetime.fromisoformat(ts)
        except (ValueError, TypeError):
            continue

        round_key = (kill.get("gameId"), kill.get("roundNumber"))
        round_kills[round_key].append({
            **kill,
            "parsedTimestamp": parsed_ts
        })

    # Sort kills within each round by timestamp
    for round_key in round_kills:
        round_kills[round_key].sort(key=lambda k: k["parsedTimestamp"])

    # Detect trades
    trade_kills = []
    traded_deaths = set()  # Track which kills have been traded (by index)

    # Track per-player stats
    player_trade_stats = defaultdict(lambda: {
        "deaths": 0,
        "deathsTraded": 0,
        "tradesGotten": 0,  # Times this player traded for a teammate
        "untradedDeaths": 0
    })

    for round_key, round_kill_list in round_kills.items():
        for i, death in enumerate(round_kill_list):
            victim_id = death.get("victimId")
            victim_team_id = death.get("victimTeamId")
            killer_id = death.get("killerId")
            death_time = death["parsedTimestamp"]

            if not victim_id or not killer_id:
                continue

            player_trade_stats[victim_id]["deaths"] += 1

            # Look for a trade kill (teammate kills the killer within window)
            was_traded = False
            for j, potential_trade in enumerate(round_kill_list[i+1:], start=i+1):
                trade_time = potential_trade["parsedTimestamp"]
                time_diff = (trade_time - death_time).total_seconds()

                # Outside trade window
                if time_diff > TRADE_WINDOW_SECONDS:
                    break

                # Check if this kill is a trade (teammate kills the original killer)
                trade_victim_id = potential_trade.get("victimId")
                trade_killer_id = potential_trade.get("killerId")
                trade_killer_team_id = potential_trade.get("killerTeamId")

                if (trade_victim_id == killer_id and
                    trade_killer_team_id == victim_team_id and
                    trade_killer_id != victim_id):  # Can't trade yourself

                    # This is a trade!
                    was_traded = True
                    player_trade_stats[victim_id]["deathsTraded"] += 1
                    player_trade_stats[trade_killer_id]["tradesGotten"] += 1

                    trade_kills.append({
                        "gameId": death.get("gameId"),
                        "roundNumber": death.get("roundNumber"),
                        "originalKillTimestamp": death.get("timestamp"),
                        "tradeTimestamp": potential_trade.get("timestamp"),
                        "timeDelta": round(time_diff, 2),
                        "originalVictimId": victim_id,
                        "originalKillerId": killer_id,
                        "traderId": trade_killer_id,
                        "traderTeamId": trade_killer_team_id
                    })
                    break

            if not was_traded:
                player_trade_stats[victim_id]["untradedDeaths"] += 1

    # Build player stats output
    trade_stats = []
    for player_id, stats in player_trade_stats.items():
        deaths = stats["deaths"]
        deaths_traded = stats["deathsTraded"]

        team_id = None
        # Find team from kills
        for kill in kills:
            if kill.get("victimId") == player_id:
                team_id = kill.get("victimTeamId")
                break
            if kill.get("killerId") == player_id:
                team_id = kill.get("killerTeamId")
                break

        team_info = team_map.get(team_id, {}) if team_id else {}

        trade_stats.append({
            "playerId": player_id,
            "playerName": player_map.get(player_id, f"Player {player_id}"),
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            "deaths": deaths,
            "deathsTraded": deaths_traded,
            "untradedDeaths": stats["untradedDeaths"],
            "tradedRate": round(deaths_traded / deaths, 3) if deaths > 0 else 0,
            "tradesGotten": stats["tradesGotten"]
        })

    return {
        "tradeKills": trade_kills,
        "tradeStats": sorted(trade_stats, key=lambda x: -x["deaths"])
    }


def compute_opening_duel_stats(rounds: List[Dict], kills: List[Dict], player_map: Dict[str, str], team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute player-level opening duel statistics.

    An opening duel is the first kill of each round. This tracks:
    - Win rate (first bloods / total opening duels participated)
    - Side-specific performance (attack vs defense)
    - Round conversion rate (% of opening kills that lead to round wins)

    Args:
        rounds: List of round data with firstBlood info
        kills: List of kill events (for position data)
        player_map: Player ID to name mapping
        team_map: Team ID to team info mapping

    Returns:
        List of player opening duel stats
    """
    # Track per-player opening duel stats
    player_stats = defaultdict(lambda: {
        "openingKills": 0,
        "openingDeaths": 0,
        "openingKillsOnAttack": 0,
        "openingDeathsOnAttack": 0,
        "openingKillsOnDefense": 0,
        "openingDeathsOnDefense": 0,
        "openingKillsConverted": 0,  # Opening kills that led to round wins
        "openingDeathsConverted": 0,  # Opening deaths where team still won
        "teamId": None
    })

    # Build victim team lookup from kills data
    first_blood_victim_teams = {}  # (gameId, roundNumber) -> victimTeamId
    for kill in kills:
        if kill.get("isFirstBlood"):
            key = (kill.get("gameId"), kill.get("roundNumber"))
            first_blood_victim_teams[key] = kill.get("victimTeamId")

    for round_data in rounds:
        game_id = round_data.get("gameId")
        round_num = round_data.get("roundNumber")
        winner_side = round_data.get("winnerSide")
        winner_team = round_data.get("winnerTeamId")
        first_blood = round_data.get("firstBlood")

        if not first_blood or not winner_side:
            continue

        killer_id = first_blood.get("killerId")
        victim_id = first_blood.get("victimId")
        killer_team_id = first_blood.get("killerTeamId")

        if not killer_id or not victim_id or not killer_team_id:
            continue

        # Get victim's team from kills data
        victim_team_id = first_blood_victim_teams.get((game_id, round_num))
        if not victim_team_id:
            continue

        # Determine sides based on winner_side
        # If killer's team won the round, killer was on winning side
        killer_won_round = (killer_team_id == winner_team)

        # Rounds data is already normalized to "attack"/"defense"
        if killer_won_round:
            killer_side = winner_side
        else:
            # Killer lost, so was on opposite side
            killer_side = "defense" if winner_side == "attack" else "attack"

        victim_side = "defense" if killer_side == "attack" else "attack"

        # Update killer stats
        player_stats[killer_id]["openingKills"] += 1
        player_stats[killer_id]["teamId"] = killer_team_id

        if killer_side == "attack":
            player_stats[killer_id]["openingKillsOnAttack"] += 1
        else:
            player_stats[killer_id]["openingKillsOnDefense"] += 1

        if killer_won_round:
            player_stats[killer_id]["openingKillsConverted"] += 1

        # Update victim stats
        player_stats[victim_id]["openingDeaths"] += 1
        player_stats[victim_id]["teamId"] = victim_team_id

        if victim_side == "attack":
            player_stats[victim_id]["openingDeathsOnAttack"] += 1
        else:
            player_stats[victim_id]["openingDeathsOnDefense"] += 1

        # Check if victim's team still won despite opening death
        victim_won_round = (victim_team_id == winner_team)
        if victim_won_round:
            player_stats[victim_id]["openingDeathsConverted"] += 1

    # Build output
    opening_stats = []
    for player_id, stats in player_stats.items():
        total_duels = stats["openingKills"] + stats["openingDeaths"]
        if total_duels == 0:
            continue

        attack_duels = stats["openingKillsOnAttack"] + stats["openingDeathsOnAttack"]
        defense_duels = stats["openingKillsOnDefense"] + stats["openingDeathsOnDefense"]

        team_id = stats["teamId"]
        team_info = team_map.get(team_id, {}) if team_id else {}

        opening_stats.append({
            "playerId": player_id,
            "playerName": player_map.get(player_id, f"Player {player_id}"),
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            # Overall stats
            "openingKills": stats["openingKills"],
            "openingDeaths": stats["openingDeaths"],
            "openingDuels": total_duels,
            "openingDuelWinRate": round(stats["openingKills"] / total_duels, 3) if total_duels > 0 else 0,
            # Attack stats
            "attackOpeningKills": stats["openingKillsOnAttack"],
            "attackOpeningDeaths": stats["openingDeathsOnAttack"],
            "attackOpeningDuels": attack_duels,
            "attackOpeningWinRate": round(stats["openingKillsOnAttack"] / attack_duels, 3) if attack_duels > 0 else 0,
            # Defense stats
            "defenseOpeningKills": stats["openingKillsOnDefense"],
            "defenseOpeningDeaths": stats["openingDeathsOnDefense"],
            "defenseOpeningDuels": defense_duels,
            "defenseOpeningWinRate": round(stats["openingKillsOnDefense"] / defense_duels, 3) if defense_duels > 0 else 0,
            # Conversion stats
            "openingKillConversion": round(stats["openingKillsConverted"] / stats["openingKills"], 3) if stats["openingKills"] > 0 else 0,
            "openingDeathSurvival": round(stats["openingDeathsConverted"] / stats["openingDeaths"], 3) if stats["openingDeaths"] > 0 else 0
        })

    return sorted(opening_stats, key=lambda x: -x["openingDuels"])


def compute_multikill_stats(kills: List[Dict], player_map: Dict[str, str], team_map: Dict[str, Dict]) -> Dict:
    """
    Compute multi-kill statistics per player.

    Multi-kills:
    - 2k: 2 kills in a round
    - 3k: 3 kills in a round
    - 4k: 4 kills in a round
    - 5k (ace): 5 kills in a round (killed entire enemy team)

    Args:
        kills: List of kill events
        player_map: Mapping of player IDs to names
        team_map: Mapping of team IDs to team info

    Returns:
        Dict with multiKillRounds and multiKillStats
    """
    # Group kills by (gameId, roundNumber, killerId)
    round_kills = defaultdict(lambda: defaultdict(int))
    player_teams = {}

    for kill in kills:
        game_id = kill.get("gameId")
        round_num = kill.get("roundNumber")
        killer_id = kill.get("killerId")
        killer_team = kill.get("killerTeamId")

        if not game_id or round_num is None or not killer_id:
            continue

        round_key = (game_id, round_num)
        round_kills[round_key][killer_id] += 1

        if killer_id and killer_team:
            player_teams[killer_id] = killer_team

    # Collect multi-kill rounds (2+ kills)
    multi_kill_rounds = []

    for (game_id, round_num), killers in round_kills.items():
        for killer_id, kill_count in killers.items():
            if kill_count >= 2:
                team_id = player_teams.get(killer_id)
                team_info = team_map.get(team_id, {}) if team_id else {}

                # Classify multi-kill type
                if kill_count == 2:
                    multikill_type = "2k"
                elif kill_count == 3:
                    multikill_type = "3k"
                elif kill_count == 4:
                    multikill_type = "4k"
                else:  # 5+
                    multikill_type = "ace"

                multi_kill_rounds.append({
                    "gameId": game_id,
                    "roundNumber": round_num,
                    "playerId": killer_id,
                    "playerName": player_map.get(killer_id, f"Player {killer_id}"),
                    "teamId": team_id,
                    "teamName": team_info.get("name", "Unknown"),
                    "kills": kill_count,
                    "type": multikill_type
                })

    # Compute per-player aggregate stats
    player_stats = defaultdict(lambda: {
        "twoKs": 0,
        "threeKs": 0,
        "fourKs": 0,
        "aces": 0,
        "totalMultiKills": 0
    })

    for mk in multi_kill_rounds:
        player_id = mk["playerId"]
        mk_type = mk["type"]

        player_stats[player_id]["totalMultiKills"] += 1

        if mk_type == "2k":
            player_stats[player_id]["twoKs"] += 1
        elif mk_type == "3k":
            player_stats[player_id]["threeKs"] += 1
        elif mk_type == "4k":
            player_stats[player_id]["fourKs"] += 1
        elif mk_type == "ace":
            player_stats[player_id]["aces"] += 1

    # Build output with impact score
    multi_kill_player_stats = []

    for player_id, stats in player_stats.items():
        team_id = player_teams.get(player_id)
        team_info = team_map.get(team_id, {}) if team_id else {}

        # Impact score: 2k=1, 3k=2, 4k=3, ace=5
        impact_score = (
            stats["twoKs"] * 1 +
            stats["threeKs"] * 2 +
            stats["fourKs"] * 3 +
            stats["aces"] * 5
        )

        multi_kill_player_stats.append({
            "playerId": player_id,
            "playerName": player_map.get(player_id, f"Player {player_id}"),
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            "twoKs": stats["twoKs"],
            "threeKs": stats["threeKs"],
            "fourKs": stats["fourKs"],
            "aces": stats["aces"],
            "totalMultiKills": stats["totalMultiKills"],
            "impactScore": impact_score
        })

    return {
        "multiKillRounds": sorted(multi_kill_rounds, key=lambda x: -x["kills"]),
        "multiKillStats": sorted(multi_kill_player_stats, key=lambda x: -x["impactScore"])
    }


# =============================================================================
# Sprint 1: New Analytics Functions
# =============================================================================

def compute_weapon_stats(kills: List[Dict], player_map: Dict[str, str], team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute per-player weapon statistics.

    Args:
        kills: List of kill events with weapon data
        player_map: Player ID to name mapping
        team_map: Team ID to team info mapping

    Returns:
        List of player weapon stats with breakdown by weapon/category
    """
    # Track per-player weapon kills
    player_weapon_stats = defaultdict(lambda: {
        "totalKills": 0,
        "byWeapon": defaultdict(int),
        "byCategory": defaultdict(int),
        "operatorKills": 0,
        "operatorOpeningKills": 0,
        "teamId": None
    })

    for kill in kills:
        killer_id = kill.get("killerId")
        weapon = kill.get("weapon")
        weapon_category = kill.get("weaponCategory", "unknown")
        is_first_blood = kill.get("isFirstBlood", False)

        if not killer_id:
            continue

        stats = player_weapon_stats[killer_id]
        stats["totalKills"] += 1
        stats["teamId"] = kill.get("killerTeamId")

        if weapon:
            stats["byWeapon"][weapon] += 1
            stats["byCategory"][weapon_category] += 1

            # Track operator specifically (sniper category)
            if weapon.lower() == "operator":
                stats["operatorKills"] += 1
                if is_first_blood:
                    stats["operatorOpeningKills"] += 1

    # Build output
    weapon_stats = []
    for player_id, stats in player_weapon_stats.items():
        total_kills = stats["totalKills"]
        team_id = stats["teamId"]
        team_info = team_map.get(team_id, {}) if team_id else {}

        by_weapon = {
            weapon: {
                "kills": count,
                "percentage": round(count / total_kills, 3) if total_kills > 0 else 0
            }
            for weapon, count in stats["byWeapon"].items()
        }

        by_category = {
            category: {
                "kills": count,
                "percentage": round(count / total_kills, 3) if total_kills > 0 else 0
            }
            for category, count in stats["byCategory"].items()
        }

        weapon_stats.append({
            "playerId": player_id,
            "playerName": player_map.get(player_id, f"Player {player_id}"),
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            "totalKills": total_kills,
            "byWeapon": by_weapon,
            "byCategory": by_category,
            "operatorKills": stats["operatorKills"],
            "operatorOpeningKills": stats["operatorOpeningKills"]
        })

    return sorted(weapon_stats, key=lambda x: -x["totalKills"])


def compute_engagement_stats(kills: List[Dict], player_map: Dict[str, str], team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute per-player engagement range statistics.

    Args:
        kills: List of kill events with distance data
        player_map: Player ID to name mapping
        team_map: Team ID to team info mapping

    Returns:
        List of player engagement stats with breakdown by range
    """
    # Track per-player engagement stats
    player_engagement = defaultdict(lambda: {
        "byRange": defaultdict(lambda: {"kills": 0, "deaths": 0}),
        "totalKillDistance": 0,
        "killCount": 0,
        "teamId": None
    })

    for kill in kills:
        killer_id = kill.get("killerId")
        victim_id = kill.get("victimId")
        engagement_range = kill.get("engagementRange", "unknown")
        kill_distance = kill.get("killDistance")

        if killer_id:
            stats = player_engagement[killer_id]
            stats["byRange"][engagement_range]["kills"] += 1
            stats["teamId"] = kill.get("killerTeamId")
            if kill_distance is not None:
                stats["totalKillDistance"] += kill_distance
                stats["killCount"] += 1

        if victim_id:
            stats = player_engagement[victim_id]
            stats["byRange"][engagement_range]["deaths"] += 1
            if not stats["teamId"]:
                stats["teamId"] = kill.get("victimTeamId")

    # Build output
    engagement_stats = []
    for player_id, stats in player_engagement.items():
        team_id = stats["teamId"]
        team_info = team_map.get(team_id, {}) if team_id else {}

        by_range = {}
        total_kills = 0
        total_deaths = 0

        for range_name, range_stats in stats["byRange"].items():
            kills_count = range_stats["kills"]
            deaths_count = range_stats["deaths"]
            total_kills += kills_count
            total_deaths += deaths_count
            total = kills_count + deaths_count
            by_range[range_name] = {
                "kills": kills_count,
                "deaths": deaths_count,
                "winRate": round(kills_count / total, 3) if total > 0 else 0
            }

        # Determine preferred range (most kills)
        preferred_range = max(
            stats["byRange"].items(),
            key=lambda x: x[1]["kills"],
            default=("unknown", {"kills": 0})
        )[0]

        avg_kill_distance = (
            round(stats["totalKillDistance"] / stats["killCount"], 1)
            if stats["killCount"] > 0 else 0
        )

        engagement_stats.append({
            "playerId": player_id,
            "playerName": player_map.get(player_id, f"Player {player_id}"),
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            "byRange": by_range,
            "preferredRange": preferred_range,
            "avgKillDistance": avg_kill_distance
        })

    return sorted(engagement_stats, key=lambda x: -sum(r["kills"] for r in x["byRange"].values()))


def compute_tempo_stats(rounds: List[Dict], plants: List[Dict], round_timings: Dict, team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute team tempo statistics for attack and defense.

    Args:
        rounds: List of round data
        plants: List of plant events
        round_timings: Dict mapping (gameId, roundNumber) -> timing data
        team_map: Team ID to team info mapping

    Returns:
        List of team tempo stats
    """
    from datetime import datetime

    def parse_timestamp(ts):
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except:
            return None

    # Track per-team tempo stats
    team_tempo = defaultdict(lambda: {
        "attackStats": {
            "plantTimes": [],
            "latePlants": 0,  # Plants with <20s remaining
            "latePlantWins": 0,
            "fastExecutes": 0,  # Plants in first 30s
            "fastExecuteWins": 0
        },
        "defenseStats": {
            "firstKillTimes": [],
            "earlyAggression": 0  # Kills in first 30s
        },
        "byTempo": defaultdict(lambda: {"rounds": 0, "wins": 0})
    })

    # Build round winner map
    round_winner_map = {(r["gameId"], r["roundNumber"]): r["winnerTeamId"] for r in rounds}

    # Build plant map
    plant_map = {}
    for plant in plants:
        key = (plant["gameId"], plant["roundNumber"])
        plant_map[key] = plant

    for round_data in rounds:
        game_id = round_data["gameId"]
        round_num = round_data["roundNumber"]
        winner_team = round_data["winnerTeamId"]
        winner_side = round_data.get("winnerSide")
        round_key = (game_id, round_num)

        timing = round_timings.get(round_key, {})
        round_start = parse_timestamp(timing.get("roundStartTime"))
        round_end = parse_timestamp(timing.get("roundEndTime"))
        first_kill_time = parse_timestamp(timing.get("firstKillTime"))
        plant_time = parse_timestamp(timing.get("plantTime"))

        if not round_start or not round_end:
            continue

        round_duration = (round_end - round_start).total_seconds()
        tempo_category = classify_tempo(round_duration)

        # Find which team was attacking this round
        # Note: rounds data is normalized to "attack"/"defense" from GRID's "attacker"/"defender"
        for team_id in team_map.keys():
            # Determine side for this team
            if winner_side == "attack" and winner_team == team_id:
                side = "attack"
            elif winner_side == "defense" and winner_team == team_id:
                side = "defense"
            elif winner_side == "attack" and winner_team != team_id:
                side = "defense"
            elif winner_side == "defense" and winner_team != team_id:
                side = "attack"
            else:
                continue

            won = (winner_team == team_id)
            team_tempo[team_id]["byTempo"][tempo_category]["rounds"] += 1
            if won:
                team_tempo[team_id]["byTempo"][tempo_category]["wins"] += 1

            if side == "attack" and plant_time and round_start:
                time_to_plant = (plant_time - round_start).total_seconds()
                team_tempo[team_id]["attackStats"]["plantTimes"].append(time_to_plant)

                # Standard Valorant round is 100 seconds
                time_remaining = 100 - time_to_plant
                if time_remaining < 20:
                    team_tempo[team_id]["attackStats"]["latePlants"] += 1
                    if won:
                        team_tempo[team_id]["attackStats"]["latePlantWins"] += 1

                if time_to_plant < 30:
                    team_tempo[team_id]["attackStats"]["fastExecutes"] += 1
                    if won:
                        team_tempo[team_id]["attackStats"]["fastExecuteWins"] += 1

            if side == "defense" and first_kill_time and round_start:
                time_to_first_kill = (first_kill_time - round_start).total_seconds()
                team_tempo[team_id]["defenseStats"]["firstKillTimes"].append(time_to_first_kill)

                if time_to_first_kill < 30:
                    team_tempo[team_id]["defenseStats"]["earlyAggression"] += 1

    # Build output
    tempo_stats = []
    for team_id, stats in team_tempo.items():
        team_info = team_map.get(team_id, {})

        attack_stats = stats["attackStats"]
        defense_stats = stats["defenseStats"]

        avg_time_to_plant = (
            round(sum(attack_stats["plantTimes"]) / len(attack_stats["plantTimes"]), 1)
            if attack_stats["plantTimes"] else 0
        )

        late_plant_rate = (
            round(attack_stats["latePlants"] / len(attack_stats["plantTimes"]), 3)
            if attack_stats["plantTimes"] else 0
        )

        late_plant_win_rate = (
            round(attack_stats["latePlantWins"] / attack_stats["latePlants"], 3)
            if attack_stats["latePlants"] > 0 else 0
        )

        fast_execute_win_rate = (
            round(attack_stats["fastExecuteWins"] / attack_stats["fastExecutes"], 3)
            if attack_stats["fastExecutes"] > 0 else 0
        )

        avg_time_to_first_kill = (
            round(sum(defense_stats["firstKillTimes"]) / len(defense_stats["firstKillTimes"]), 1)
            if defense_stats["firstKillTimes"] else 0
        )

        total_defense_rounds = len(defense_stats["firstKillTimes"])
        early_aggression_rate = (
            round(defense_stats["earlyAggression"] / total_defense_rounds, 3)
            if total_defense_rounds > 0 else 0
        )

        by_tempo = {
            tempo: {
                "rounds": data["rounds"],
                "wins": data["wins"],
                "winRate": round(data["wins"] / data["rounds"], 3) if data["rounds"] > 0 else 0
            }
            for tempo, data in stats["byTempo"].items()
        }

        tempo_stats.append({
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            "attackStats": {
                "avgTimeToPlant": avg_time_to_plant,
                "latePlantRate": late_plant_rate,
                "latePlantWinRate": late_plant_win_rate,
                "fastExecuteWinRate": fast_execute_win_rate
            },
            "defenseStats": {
                "avgTimeToFirstKill": avg_time_to_first_kill,
                "earlyAggressionRate": early_aggression_rate
            },
            "byTempo": by_tempo
        })

    return tempo_stats


def compute_save_round_stats(economy_rounds: List[Dict], kills: List[Dict], rounds: List[Dict], team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute save round execution statistics.

    Args:
        economy_rounds: List of economy round data
        kills: List of kill events
        rounds: List of round data
        team_map: Team ID to team info mapping

    Returns:
        List of team save round stats
    """
    # Track per-team save round stats
    team_save_stats = defaultdict(lambda: {
        "saveRounds": 0,
        "exitFragsAttempted": 0,
        "saveRoundWins": 0
    })

    # Build map of round winners
    round_winner_map = {(r["gameId"], r["roundNumber"]): r["winnerTeamId"] for r in rounds}

    # Find save rounds and track stats
    for eco_round in economy_rounds:
        if eco_round.get("economyTier") != "save":
            continue

        team_id = eco_round["teamId"]
        game_id = eco_round["gameId"]
        round_num = eco_round["roundNumber"]
        round_key = (game_id, round_num)

        team_save_stats[team_id]["saveRounds"] += 1

        # Check if team won this save round (unlikely but possible)
        if round_winner_map.get(round_key) == team_id:
            team_save_stats[team_id]["saveRoundWins"] += 1

        # Count exit frags (kills gotten by the saving team)
        for kill in kills:
            if (kill.get("gameId") == game_id and
                kill.get("roundNumber") == round_num and
                kill.get("killerTeamId") == team_id):
                team_save_stats[team_id]["exitFragsAttempted"] += 1

    # Build output
    save_stats = []
    for team_id, stats in team_save_stats.items():
        team_info = team_map.get(team_id, {})

        save_stats.append({
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            "saveRounds": stats["saveRounds"],
            "exitFragsAttempted": stats["exitFragsAttempted"],
            "saveRoundWins": stats["saveRoundWins"],
            "disciplineScore": round(
                (1 - (stats["saveRoundWins"] / stats["saveRounds"])) if stats["saveRounds"] > 0 else 1,
                3
            )  # Higher discipline = fewer forced fights on save
        })

    return save_stats


def compute_anti_eco_stats(economy_rounds: List[Dict], rounds: List[Dict], kills: List[Dict], team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute anti-eco round performance statistics.

    Args:
        economy_rounds: List of economy round data
        rounds: List of round data
        kills: List of kill events
        team_map: Team ID to team info mapping

    Returns:
        List of team anti-eco stats
    """
    # Build economy tier lookup: (gameId, roundNumber, teamId) -> tier
    economy_lookup = {}
    for eco_round in economy_rounds:
        key = (eco_round["gameId"], eco_round["roundNumber"], eco_round["teamId"])
        economy_lookup[key] = eco_round.get("economyTier")

    # Track per-team anti-eco stats
    team_anti_eco = defaultdict(lambda: {
        "antiEcoRounds": 0,
        "antiEcoWins": 0,
        "deathsToEco": 0,
        "deathsToForce": 0,
        "problematicWeapons": defaultdict(int)
    })

    # Build round winner map
    round_winner_map = {(r["gameId"], r["roundNumber"]): r["winnerTeamId"] for r in rounds}

    # Find all teams in each round
    rounds_teams = defaultdict(set)
    for eco_round in economy_rounds:
        key = (eco_round["gameId"], eco_round["roundNumber"])
        rounds_teams[key].add(eco_round["teamId"])

    # Identify anti-eco situations
    for eco_round in economy_rounds:
        game_id = eco_round["gameId"]
        round_num = eco_round["roundNumber"]
        team_id = eco_round["teamId"]
        tier = eco_round.get("economyTier")
        round_key = (game_id, round_num)

        # Check if this team has a buy advantage
        if tier not in ["full_buy", "half_buy"]:
            continue

        # Check opponent's economy
        for other_team in rounds_teams[round_key]:
            if other_team == team_id:
                continue

            other_tier = economy_lookup.get((game_id, round_num, other_team))
            if other_tier in ["eco", "save"]:
                # This is an anti-eco round for team_id
                team_anti_eco[team_id]["antiEcoRounds"] += 1

                # Check if won
                if round_winner_map.get(round_key) == team_id:
                    team_anti_eco[team_id]["antiEcoWins"] += 1
                else:
                    # Track deaths to eco/force weapons
                    for kill in kills:
                        if (kill.get("gameId") == game_id and
                            kill.get("roundNumber") == round_num and
                            kill.get("victimTeamId") == team_id):

                            weapon = kill.get("weapon", "unknown")

                            if other_tier == "eco":
                                team_anti_eco[team_id]["deathsToEco"] += 1
                            else:
                                team_anti_eco[team_id]["deathsToForce"] += 1

                            team_anti_eco[team_id]["problematicWeapons"][weapon] += 1

    # Build output
    anti_eco_stats = []
    for team_id, stats in team_anti_eco.items():
        team_info = team_map.get(team_id, {})

        problematic = sorted(
            [{"weapon": w, "deaths": d} for w, d in stats["problematicWeapons"].items()],
            key=lambda x: -x["deaths"]
        )[:5]  # Top 5 problematic weapons

        anti_eco_stats.append({
            "teamId": team_id,
            "teamName": team_info.get("name", "Unknown"),
            "antiEcoRounds": stats["antiEcoRounds"],
            "antiEcoWins": stats["antiEcoWins"],
            "antiEcoWinRate": round(stats["antiEcoWins"] / stats["antiEcoRounds"], 3) if stats["antiEcoRounds"] > 0 else 0,
            "deathsToEco": stats["deathsToEco"],
            "deathsToForce": stats["deathsToForce"],
            "problematicWeapons": problematic
        })

    return anti_eco_stats


def compute_half_stats(rounds: List[Dict], economy_rounds: List[Dict], team_map: Dict[str, Dict]) -> List[Dict]:
    """
    Compute half-by-half performance statistics.

    Args:
        rounds: List of round data
        economy_rounds: List of economy round data
        team_map: Team ID to team info mapping

    Returns:
        List of team half stats per game
    """
    # Group rounds by game
    game_rounds = defaultdict(list)
    for round_data in rounds:
        game_rounds[round_data["gameId"]].append(round_data)

    half_stats = []

    for game_id, game_round_list in game_rounds.items():
        # Sort by round number
        sorted_rounds = sorted(game_round_list, key=lambda x: x["roundNumber"])

        # Track stats for each team
        team_half_data = defaultdict(lambda: {
            "firstHalf": {"roundsWon": 0, "roundsLost": 0, "side": None, "pistolWon": None},
            "secondHalf": {"roundsWon": 0, "roundsLost": 0, "side": None, "pistolWon": None},
            "overtime": {"roundsWon": 0, "roundsLost": 0}
        })

        # Determine sides from first round
        first_round = sorted_rounds[0] if sorted_rounds else None
        if first_round:
            winner_side = first_round.get("winnerSide")
            winner_team = first_round.get("winnerTeamId")

            # Infer sides for all teams from first round result
            # Note: rounds data is normalized to "attack"/"defense"
            for team_id in team_map.keys():
                if winner_team == team_id and winner_side == "attack":
                    team_half_data[team_id]["firstHalf"]["side"] = "attack"
                    team_half_data[team_id]["secondHalf"]["side"] = "defense"
                elif winner_team == team_id and winner_side == "defense":
                    team_half_data[team_id]["firstHalf"]["side"] = "defense"
                    team_half_data[team_id]["secondHalf"]["side"] = "attack"
                elif winner_team != team_id and winner_side == "attack":
                    team_half_data[team_id]["firstHalf"]["side"] = "defense"
                    team_half_data[team_id]["secondHalf"]["side"] = "attack"
                elif winner_team != team_id and winner_side == "defense":
                    team_half_data[team_id]["firstHalf"]["side"] = "attack"
                    team_half_data[team_id]["secondHalf"]["side"] = "defense"

        for round_data in sorted_rounds:
            round_num = round_data["roundNumber"]
            winner_team = round_data["winnerTeamId"]

            # Determine half
            if round_num <= 12:
                half_key = "firstHalf"
                is_pistol = (round_num == 1)
            elif round_num <= 24:
                half_key = "secondHalf"
                is_pistol = (round_num == 13)
            else:
                half_key = "overtime"
                is_pistol = False

            # Update all teams
            for team_id in team_map.keys():
                if winner_team == team_id:
                    team_half_data[team_id][half_key]["roundsWon"] += 1
                    if is_pistol:
                        team_half_data[team_id][half_key]["pistolWon"] = True
                else:
                    team_half_data[team_id][half_key]["roundsLost"] += 1
                    if is_pistol:
                        team_half_data[team_id][half_key]["pistolWon"] = False

        # Build output for each team
        for team_id, data in team_half_data.items():
            team_info = team_map.get(team_id, {})

            first_half = data["firstHalf"]
            second_half = data["secondHalf"]

            first_total = first_half["roundsWon"] + first_half["roundsLost"]
            second_total = second_half["roundsWon"] + second_half["roundsLost"]

            first_win_rate = round(first_half["roundsWon"] / first_total, 3) if first_total > 0 else 0
            second_win_rate = round(second_half["roundsWon"] / second_total, 3) if second_total > 0 else 0

            half_stats.append({
                "teamId": team_id,
                "teamName": team_info.get("name", "Unknown"),
                "gameId": game_id,
                "firstHalf": {
                    "side": first_half["side"],
                    "roundsWon": first_half["roundsWon"],
                    "roundsLost": first_half["roundsLost"],
                    "winRate": first_win_rate,
                    "pistolWon": first_half["pistolWon"]
                },
                "secondHalf": {
                    "side": second_half["side"],
                    "roundsWon": second_half["roundsWon"],
                    "roundsLost": second_half["roundsLost"],
                    "winRate": second_win_rate,
                    "pistolWon": second_half["pistolWon"]
                },
                "adaptation": {
                    "improved": second_win_rate > first_win_rate,
                    "delta": round(second_win_rate - first_win_rate, 3)
                }
            })

    return half_stats


# =============================================================================
# Sprint 2: Tactical Depth & Ability Analytics
# =============================================================================

# Ability classifications for correlation analysis
FLASH_ABILITIES = {
    'paranoia',          # Omen
    'blindside',         # Phoenix (curveball alt name)
    'flashpoint',        # Breach
    'guiding-light',     # Skye
    'flash-drive',       # KAY/O
    'leer',              # Reyna
    'dizzy',             # Gekko
}

SMOKE_ABILITIES = {
    'dark-cover',        # Omen
    'sky-smoke',         # Brimstone
    'nebula',            # Astra
    'nebula-dissipate',  # Astra
    'poison-cloud',      # Viper
    'toxic-screen',      # Viper
    'cyber-cage',        # Cypher
    'cloudburst',        # Jett
}

DAMAGE_ABILITIES = {
    'paint-shells',      # Raze grenade
    'showstopper',       # Raze ult
    'incendiary',        # Brimstone
    'snake-bite',        # Viper
    'nanoswarm',         # Killjoy
    'orbital-strike',    # Brimstone ult
    'hunter\'s-fury',    # Sova ult
    'nova-pulse',        # Breach ult
    'nightfall',         # Fade ult
    'seekers',           # Fade ult alt
    'mosh-pit',          # Gekko
    'viper\'s-pit',      # Viper ult
    'lockdown',          # Killjoy ult (indirect)
}

RECON_ABILITIES = {
    'recon-bolt',        # Sova
    'owl-drone',         # Sova
    'spycam',            # Cypher
    'trapwire',          # Cypher
    'turret',            # Killjoy
    'alarmbot',          # Killjoy
    'haunt',             # Fade
    'prowler',           # Fade
    'trailblazer',       # Skye
    'boom-bot',          # Raze
    'wingman',           # Gekko
    'thrash',            # Gekko ult
}

MOBILITY_ABILITIES = {
    'tailwind',          # Jett dash
    'updraft',           # Jett
    'cloudburst',        # Jett (also smoke)
    'gatecrash',         # Yoru
    'dimensional-drift', # Yoru ult
    'shrouded-step',     # Omen
    'from-the-shadows',  # Omen ult
    'blast-pack',        # Raze
}


def classify_ability(ability_id: str) -> str:
    """Classify an ability into its category."""
    ability_lower = ability_id.lower()

    if ability_lower in FLASH_ABILITIES:
        return 'flash'
    elif ability_lower in SMOKE_ABILITIES:
        return 'smoke'
    elif ability_lower in DAMAGE_ABILITIES:
        return 'damage'
    elif ability_lower in RECON_ABILITIES:
        return 'recon'
    elif ability_lower in MOBILITY_ABILITIES:
        return 'mobility'
    else:
        return 'other'


def compute_ability_kill_correlation(
    ability_uses: List[Dict],
    kills: List[Dict],
    correlation_window_seconds: float = 3.0,
    smoke_window_seconds: float = 5.0
) -> List[Dict]:
    """
    Find kills that occur within X seconds after an ability use.

    Args:
        ability_uses: List of ability use events
        kills: List of kill events
        correlation_window_seconds: Time window for flash/damage abilities
        smoke_window_seconds: Time window for smoke abilities

    Returns:
        List of correlated ability-kill events
    """
    from datetime import datetime

    def parse_timestamp(ts):
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except:
            return None

    correlations = []

    # Group abilities and kills by (gameId, roundNumber)
    abilities_by_round = defaultdict(list)
    kills_by_round = defaultdict(list)

    for ability in ability_uses:
        key = (ability.get('gameId'), ability.get('roundNumber'))
        abilities_by_round[key].append(ability)

    for kill in kills:
        key = (kill.get('gameId'), kill.get('roundNumber'))
        kills_by_round[key].append(kill)

    # For each kill, look back for correlated abilities
    for round_key, round_kills in kills_by_round.items():
        round_abilities = abilities_by_round.get(round_key, [])

        for kill in round_kills:
            kill_time = parse_timestamp(kill.get('timestamp'))
            if not kill_time:
                continue

            killer_id = kill.get('killerId')
            killer_team_id = kill.get('killerTeamId')

            # Check each ability used before this kill
            for ability in round_abilities:
                ability_time = parse_timestamp(ability.get('timestamp'))
                if not ability_time:
                    continue

                # Ability must be before kill
                if ability_time >= kill_time:
                    continue

                time_delta = (kill_time - ability_time).total_seconds()
                ability_category = classify_ability(ability.get('abilityId', ''))

                # Different windows for different ability types
                window = smoke_window_seconds if ability_category == 'smoke' else correlation_window_seconds

                if time_delta > window:
                    continue

                ability_user_id = ability.get('playerId')
                ability_team_id = ability.get('teamId')

                # Only count if ability user is on same team as killer
                if ability_team_id != killer_team_id:
                    continue

                correlations.append({
                    'gameId': round_key[0],
                    'roundNumber': round_key[1],
                    'abilityTimestamp': ability.get('timestamp'),
                    'killTimestamp': kill.get('timestamp'),
                    'timeDelta': round(time_delta, 2),
                    'abilityUserId': ability_user_id,
                    'abilityUserName': ability.get('playerName', ''),
                    'abilityId': ability.get('abilityId', ''),
                    'abilityName': ability.get('abilityName', ''),
                    'abilityCategory': ability_category,
                    'killerId': killer_id,
                    'killerName': kill.get('killerName', ''),
                    'victimId': kill.get('victimId'),
                    'isSamePlayer': ability_user_id == killer_id,
                    'isTeammateKill': ability_user_id != killer_id
                })

    return correlations


def compute_ability_impact_stats(
    ability_correlations: List[Dict],
    ability_uses: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict],
    agent_compositions: Dict[str, List[Dict]] = None
) -> List[Dict]:
    """
    Compute per-player ability impact statistics.

    Args:
        ability_correlations: List of ability-kill correlations
        ability_uses: List of all ability uses
        player_map: Player ID to name mapping
        team_map: Team ID to team info mapping
        agent_compositions: Optional agent compositions by game

    Returns:
        List of per-player ability impact stats
    """
    if agent_compositions is None:
        agent_compositions = {}

    # Track per-player stats
    player_stats = defaultdict(lambda: {
        'totalAbilityUses': 0,
        'flashUses': 0,
        'flashAssists': 0,
        'selfKillsAfterAbility': 0,
        'teammateKillsAfterAbility': 0,
        'teamId': None,
        'abilityBreakdown': defaultdict(lambda: {'uses': 0, 'correlatedKills': 0})
    })

    # Count ability uses by player
    for ability in ability_uses:
        player_id = ability.get('playerId')
        if not player_id:
            continue

        player_stats[player_id]['totalAbilityUses'] += 1
        player_stats[player_id]['teamId'] = ability.get('teamId')

        ability_id = ability.get('abilityId', '')
        ability_category = classify_ability(ability_id)

        if ability_category == 'flash':
            player_stats[player_id]['flashUses'] += 1

        player_stats[player_id]['abilityBreakdown'][ability_id]['uses'] += 1

    # Process correlations
    for corr in ability_correlations:
        ability_user_id = corr.get('abilityUserId')
        ability_id = corr.get('abilityId', '')
        ability_category = corr.get('abilityCategory', '')

        if not ability_user_id:
            continue

        if corr.get('isSamePlayer'):
            player_stats[ability_user_id]['selfKillsAfterAbility'] += 1
        else:
            player_stats[ability_user_id]['teammateKillsAfterAbility'] += 1
            if ability_category == 'flash':
                player_stats[ability_user_id]['flashAssists'] += 1

        player_stats[ability_user_id]['abilityBreakdown'][ability_id]['correlatedKills'] += 1

    # Build output
    impact_stats = []
    for player_id, stats in player_stats.items():
        team_id = stats['teamId']
        team_info = team_map.get(team_id, {}) if team_id else {}

        flash_assist_rate = (
            stats['flashAssists'] / stats['flashUses']
            if stats['flashUses'] > 0 else 0
        )

        # Build ability breakdown
        ability_breakdown = {}
        for ability_id, breakdown in stats['abilityBreakdown'].items():
            if breakdown['uses'] > 0:
                ability_breakdown[ability_id] = {
                    'uses': breakdown['uses'],
                    'correlatedKills': breakdown['correlatedKills'],
                    'effectiveness': round(breakdown['correlatedKills'] / breakdown['uses'], 3)
                }

        impact_stats.append({
            'playerId': player_id,
            'playerName': player_map.get(player_id, f'Player {player_id}'),
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'totalAbilityUses': stats['totalAbilityUses'],
            'flashAssists': stats['flashAssists'],
            'flashAssistRate': round(flash_assist_rate, 3),
            'selfKillsAfterAbility': stats['selfKillsAfterAbility'],
            'teammateKillsAfterAbility': stats['teammateKillsAfterAbility'],
            'utilityKillSetups': stats['flashAssists'] + stats['teammateKillsAfterAbility'],
            'abilityBreakdown': ability_breakdown
        })

    # Sort by flash assists
    impact_stats.sort(key=lambda x: x['flashAssists'], reverse=True)

    return impact_stats


def compute_team_utility_coordination(
    ability_correlations: List[Dict],
    ability_uses: List[Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute team-level utility coordination statistics.

    Args:
        ability_correlations: List of ability-kill correlations
        ability_uses: List of all ability uses
        team_map: Team ID to team info mapping

    Returns:
        List of team utility coordination stats
    """
    team_stats = defaultdict(lambda: {
        'totalAbilityUses': 0,
        'correlatedKills': 0,
        'flashUses': 0,
        'flashAssists': 0,
        'playerFlashAssists': defaultdict(int),
        'abilityKills': defaultdict(int)
    })

    # Count ability uses by team
    for ability in ability_uses:
        team_id = ability.get('teamId')
        if team_id:
            team_stats[team_id]['totalAbilityUses'] += 1
            if classify_ability(ability.get('abilityId', '')) == 'flash':
                team_stats[team_id]['flashUses'] += 1

    # Process correlations
    for corr in ability_correlations:
        team_id = corr.get('abilityUserId')  # Get from ability user's team
        # Find team from ability_uses
        ability_user_id = corr.get('abilityUserId')
        for ability in ability_uses:
            if ability.get('playerId') == ability_user_id:
                team_id = ability.get('teamId')
                break

        if not team_id:
            continue

        team_stats[team_id]['correlatedKills'] += 1

        if corr.get('abilityCategory') == 'flash' and corr.get('isTeammateKill'):
            team_stats[team_id]['flashAssists'] += 1
            team_stats[team_id]['playerFlashAssists'][ability_user_id] += 1

        team_stats[team_id]['abilityKills'][corr.get('abilityId', '')] += 1

    # Build output
    coordination_stats = []
    for team_id, stats in team_stats.items():
        team_info = team_map.get(team_id, {})

        # Find top flash player
        top_flash_player = None
        max_flash_assists = 0
        for player_id, assists in stats['playerFlashAssists'].items():
            if assists > max_flash_assists:
                max_flash_assists = assists
                top_flash_player = player_id

        # Find most effective utility
        most_effective_utility = None
        max_kills = 0
        for ability_id, kills in stats['abilityKills'].items():
            if kills > max_kills:
                max_kills = kills
                most_effective_utility = ability_id

        coordination_score = (
            stats['correlatedKills'] / stats['totalAbilityUses']
            if stats['totalAbilityUses'] > 0 else 0
        )

        coordination_stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'totalAbilityUses': stats['totalAbilityUses'],
            'correlatedKills': stats['correlatedKills'],
            'utilityCoordinationScore': round(coordination_score, 3),
            'flashUses': stats['flashUses'],
            'flashAssists': stats['flashAssists'],
            'topFlashPlayer': top_flash_player,
            'mostEffectiveUtility': most_effective_utility
        })

    return coordination_stats


def compute_postplant_position_stats(
    kills: List[Dict],
    plants: List[Dict],
    rounds: List[Dict],
    game_map: Dict[str, Dict],
    team_map: Dict[str, Dict],
    player_map: Dict[str, str]
) -> Dict:
    """
    Analyze post-plant kill/death positions.

    Args:
        kills: List of kill events
        plants: List of plant events
        rounds: List of round data
        game_map: Game ID to map info mapping
        team_map: Team ID to team info mapping
        player_map: Player ID to name mapping

    Returns:
        Post-plant position statistics
    """
    from datetime import datetime

    def parse_timestamp(ts):
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except:
            return None

    # Build plant map: (gameId, roundNumber) -> plant info
    plant_map = {}
    for plant in plants:
        key = (plant.get('gameId'), plant.get('roundNumber'))
        plant_map[key] = plant

    # Track post-plant stats by (mapName, site)
    site_stats = defaultdict(lambda: {
        'kills': 0,
        'deaths': 0,
        'positions': [],
        'killPositions': [],
        'deathPositions': []
    })

    # Track per-player post-plant performance
    player_postplant = defaultdict(lambda: {
        'kills': 0,
        'deaths': 0,
        'killPositions': [],
        'deathPositions': [],
        'teamId': None
    })

    # Filter kills that happened after plant
    for kill in kills:
        game_id = kill.get('gameId')
        round_num = kill.get('roundNumber')
        round_key = (game_id, round_num)

        plant = plant_map.get(round_key)
        if not plant:
            continue

        # Check if kill happened after plant
        kill_time = parse_timestamp(kill.get('timestamp'))
        plant_time = parse_timestamp(plant.get('timestamp'))

        if not kill_time or not plant_time:
            continue

        if kill_time <= plant_time:
            continue

        # This is a post-plant kill
        map_info = game_map.get(game_id, {})
        map_name = map_info.get('mapName', 'unknown')
        site = plant.get('site', 'unknown')

        site_key = (map_name, site)

        killer_id = kill.get('killerId')
        victim_id = kill.get('victimId')
        killer_pos = kill.get('killerPosition')
        victim_pos = kill.get('victimPosition')

        site_stats[site_key]['kills'] += 1
        site_stats[site_key]['deaths'] += 1

        if killer_pos:
            site_stats[site_key]['killPositions'].append(killer_pos)
        if victim_pos:
            site_stats[site_key]['deathPositions'].append(victim_pos)

        # Update player stats
        if killer_id:
            player_postplant[killer_id]['kills'] += 1
            player_postplant[killer_id]['teamId'] = kill.get('killerTeamId')
            if killer_pos:
                player_postplant[killer_id]['killPositions'].append({
                    'map': map_name,
                    'site': site,
                    **killer_pos
                })

        if victim_id:
            player_postplant[victim_id]['deaths'] += 1
            player_postplant[victim_id]['teamId'] = kill.get('victimTeamId')
            if victim_pos:
                player_postplant[victim_id]['deathPositions'].append({
                    'map': map_name,
                    'site': site,
                    **victim_pos
                })

    # Build site-level stats
    site_postplant_stats = []
    for (map_name, site), stats in site_stats.items():
        kd_ratio = stats['kills'] / stats['deaths'] if stats['deaths'] > 0 else stats['kills']

        site_postplant_stats.append({
            'mapName': map_name,
            'site': site,
            'postPlantKills': stats['kills'],
            'postPlantDeaths': stats['deaths'],
            'kdRatio': round(kd_ratio, 2)
        })

    # Build player-level stats
    player_postplant_stats = []
    for player_id, stats in player_postplant.items():
        team_id = stats['teamId']
        team_info = team_map.get(team_id, {}) if team_id else {}

        kd = stats['kills'] / stats['deaths'] if stats['deaths'] > 0 else stats['kills']

        # Calculate average positions
        avg_kill_pos = None
        if stats['killPositions']:
            avg_x = sum(p.get('x', 0) for p in stats['killPositions']) / len(stats['killPositions'])
            avg_y = sum(p.get('y', 0) for p in stats['killPositions']) / len(stats['killPositions'])
            avg_kill_pos = {'avgX': round(avg_x, 1), 'avgY': round(avg_y, 1)}

        avg_death_pos = None
        if stats['deathPositions']:
            avg_x = sum(p.get('x', 0) for p in stats['deathPositions']) / len(stats['deathPositions'])
            avg_y = sum(p.get('y', 0) for p in stats['deathPositions']) / len(stats['deathPositions'])
            avg_death_pos = {'avgX': round(avg_x, 1), 'avgY': round(avg_y, 1)}

        player_postplant_stats.append({
            'playerId': player_id,
            'playerName': player_map.get(player_id, f'Player {player_id}'),
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'postPlantKills': stats['kills'],
            'postPlantDeaths': stats['deaths'],
            'postPlantKD': round(kd, 2),
            'avgKillPosition': avg_kill_pos,
            'avgDeathPosition': avg_death_pos
        })

    # Sort by post-plant KD
    player_postplant_stats.sort(key=lambda x: x['postPlantKD'], reverse=True)

    return {
        'siteStats': site_postplant_stats,
        'playerStats': player_postplant_stats
    }


def compute_matchup_stats(
    kills: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> Dict:
    """
    Compute player vs player kill matrix.

    Args:
        kills: List of kill events
        player_map: Player ID to name mapping
        team_map: Team ID to team info mapping

    Returns:
        Matchup matrix and player summaries
    """
    # Build kill matrix: {killer_id: {victim_id: count}}
    kill_matrix = defaultdict(lambda: defaultdict(int))
    player_teams = {}

    for kill in kills:
        killer_id = kill.get('killerId')
        victim_id = kill.get('victimId')

        if not killer_id or not victim_id:
            continue

        # Only count kills against opponents (different teams)
        killer_team = kill.get('killerTeamId')
        victim_team = kill.get('victimTeamId')

        if killer_team == victim_team:
            continue  # Skip team kills

        kill_matrix[killer_id][victim_id] += 1
        player_teams[killer_id] = killer_team
        player_teams[victim_id] = victim_team

    # Build matrix output
    matrix = {}
    for killer_id, victims in kill_matrix.items():
        matrix[killer_id] = {}
        for victim_id, kills_count in victims.items():
            deaths = kill_matrix.get(victim_id, {}).get(killer_id, 0)
            matrix[killer_id][victim_id] = {
                'kills': kills_count,
                'deaths': deaths,
                'differential': kills_count - deaths
            }

    # Build player summaries
    player_summaries = []
    all_players = set(kill_matrix.keys())
    for player_id in all_players:
        team_id = player_teams.get(player_id)
        team_info = team_map.get(team_id, {}) if team_id else {}

        # Calculate matchups
        favorable = []
        unfavorable = []

        for opponent_id in all_players:
            if player_teams.get(opponent_id) == team_id:
                continue  # Skip teammates

            my_kills = kill_matrix.get(player_id, {}).get(opponent_id, 0)
            my_deaths = kill_matrix.get(opponent_id, {}).get(player_id, 0)
            diff = my_kills - my_deaths

            if my_kills > 0 or my_deaths > 0:
                matchup = {
                    'opponentId': opponent_id,
                    'opponentName': player_map.get(opponent_id, f'Player {opponent_id}'),
                    'kills': my_kills,
                    'deaths': my_deaths,
                    'differential': diff
                }

                if diff > 0:
                    favorable.append(matchup)
                elif diff < 0:
                    unfavorable.append(matchup)

        # Sort by differential
        favorable.sort(key=lambda x: x['differential'], reverse=True)
        unfavorable.sort(key=lambda x: x['differential'])

        # Find nemesis (worst matchup) and victim (best matchup)
        nemesis = unfavorable[0] if unfavorable else None
        victim = favorable[0] if favorable else None

        player_summaries.append({
            'playerId': player_id,
            'playerName': player_map.get(player_id, f'Player {player_id}'),
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'favorableMatchups': favorable[:3],  # Top 3
            'unfavorableMatchups': unfavorable[:3],  # Worst 3
            'nemesis': nemesis.get('opponentName') if nemesis else None,
            'nemesisDifferential': nemesis.get('differential') if nemesis else 0,
            'victim': victim.get('opponentName') if victim else None,
            'victimDifferential': victim.get('differential') if victim else 0
        })

    return {
        'matrix': matrix,
        'playerSummary': player_summaries
    }


def compute_map_control_stats(
    kills: List[Dict],
    rounds: List[Dict],
    game_map: Dict[str, Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Analyze early-round map control patterns.

    Args:
        kills: List of kill events
        rounds: List of round data
        game_map: Game ID to map info mapping
        team_map: Team ID to team info mapping

    Returns:
        List of map control stats by team
    """
    from datetime import datetime

    def parse_timestamp(ts):
        if not ts:
            return None
        try:
            return datetime.fromisoformat(ts.replace('Z', '+00:00'))
        except:
            return None

    # Track per-team map control patterns
    team_patterns = defaultdict(lambda: {
        'aggressiveOpening': {'rounds': 0, 'wins': 0},
        'standardOpening': {'rounds': 0, 'wins': 0},
        'slowOpening': {'rounds': 0, 'wins': 0},
        'earlyDeaths': 0,
        'earlyKills': 0
    })

    # Build round timing map from round_timings in rounds
    round_info_map = {(r['gameId'], r['roundNumber']): r for r in rounds}

    # Analyze first kill timing in each round
    round_first_kills = {}  # (gameId, roundNumber) -> first kill info

    for kill in kills:
        game_id = kill.get('gameId')
        round_num = kill.get('roundNumber')
        key = (game_id, round_num)

        if key not in round_first_kills:
            round_first_kills[key] = kill
        else:
            # Compare timestamps
            existing_time = parse_timestamp(round_first_kills[key].get('timestamp'))
            new_time = parse_timestamp(kill.get('timestamp'))
            if new_time and existing_time and new_time < existing_time:
                round_first_kills[key] = kill

    # Classify each round's opening based on first kill timing
    for round_data in rounds:
        game_id = round_data['gameId']
        round_num = round_data['roundNumber']
        winner_team = round_data.get('winnerTeamId')
        round_key = (game_id, round_num)

        first_kill = round_first_kills.get(round_key)
        if not first_kill:
            continue

        first_blood = round_data.get('firstBlood', {})
        if not first_blood:
            continue

        killer_team = first_blood.get('killerTeamId')

        if not killer_team:
            continue

        # Determine timing category (we don't have exact freeze time end, estimate)
        # For now, classify based on whether team got first blood
        won = (killer_team == winner_team)

        # Count this as "aggressive" for the killer's team
        team_patterns[killer_team]['aggressiveOpening']['rounds'] += 1
        if won:
            team_patterns[killer_team]['aggressiveOpening']['wins'] += 1
        team_patterns[killer_team]['earlyKills'] += 1

        # Count as death for victim's team
        victim_team = first_blood.get('victimTeamId') or (
            list(team_map.keys())[0] if killer_team == list(team_map.keys())[1] else list(team_map.keys())[1]
            if len(team_map) == 2 else None
        )
        if victim_team:
            team_patterns[victim_team]['earlyDeaths'] += 1

    # Build output
    map_control_stats = []
    for team_id, patterns in team_patterns.items():
        team_info = team_map.get(team_id, {})

        aggressive = patterns['aggressiveOpening']
        aggressive_win_rate = aggressive['wins'] / aggressive['rounds'] if aggressive['rounds'] > 0 else 0

        map_control_stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'aggressiveOpenings': aggressive['rounds'],
            'aggressiveOpeningWins': aggressive['wins'],
            'aggressiveOpeningWinRate': round(aggressive_win_rate, 3),
            'earlyKills': patterns['earlyKills'],
            'earlyDeaths': patterns['earlyDeaths'],
            'earlyKillDifferential': patterns['earlyKills'] - patterns['earlyDeaths']
        })

    return map_control_stats


# =============================================================================
# Sprint 3: Strategic Situational Analytics
# =============================================================================

def identify_pistol_and_bonus_rounds(
    rounds: List[Dict],
    economy_rounds: List[Dict]
) -> Dict:
    """
    Identify pistol rounds (1, 13) and their follow-up bonus rounds (2-3, 14-15).

    Returns:
        Dict with pistolRounds and bonusRounds lists
    """
    pistol_rounds = []
    bonus_rounds = []

    # Build round winner lookup
    round_winners = {}
    for r in rounds:
        key = (r.get('gameId'), r.get('roundNumber'))
        round_winners[key] = {
            'winnerTeamId': r.get('winnerTeamId'),
            'winType': r.get('winType'),
            'winnerSide': r.get('winnerSide')
        }

    # Build economy lookup by (gameId, roundNumber, teamId)
    economy_lookup = {}
    for eco in economy_rounds:
        key = (eco.get('gameId'), eco.get('roundNumber'), eco.get('teamId'))
        economy_lookup[key] = eco

    # Get all unique games
    game_ids = set(r.get('gameId') for r in rounds)

    for game_id in game_ids:
        # Process pistol rounds (1 and 13)
        for pistol_num in [1, 13]:
            key = (game_id, pistol_num)
            if key in round_winners:
                winner_info = round_winners[key]
                winner_team = winner_info['winnerTeamId']

                # Determine loser team
                all_teams = set()
                for r in rounds:
                    if r.get('gameId') == game_id:
                        all_teams.add(r.get('winnerTeamId'))

                loser_team = None
                for team_id in all_teams:
                    if team_id != winner_team:
                        loser_team = team_id
                        break

                pistol_rounds.append({
                    'gameId': game_id,
                    'roundNumber': pistol_num,
                    'half': 'first' if pistol_num == 1 else 'second',
                    'winnerTeamId': winner_team,
                    'loserTeamId': loser_team,
                    'winType': winner_info['winType'],
                    'winnerSide': winner_info['winnerSide']
                })

                # Process bonus rounds (2-3 after pistol 1, 14-15 after pistol 13)
                bonus_start = pistol_num + 1
                bonus_end = pistol_num + 2

                for bonus_num in range(bonus_start, bonus_end + 1):
                    bonus_key = (game_id, bonus_num)
                    if bonus_key in round_winners:
                        bonus_winner = round_winners[bonus_key]

                        # Get loser's economy tier
                        loser_eco = economy_lookup.get((game_id, bonus_num, loser_team))
                        loser_tier = loser_eco.get('economyTier') if loser_eco else 'unknown'

                        # Determine if loser forced
                        was_force = loser_tier in ['eco', 'half_buy']
                        force_successful = was_force and bonus_winner['winnerTeamId'] == loser_team

                        bonus_rounds.append({
                            'gameId': game_id,
                            'roundNumber': bonus_num,
                            'pistolWinnerTeamId': winner_team,
                            'pistolLoserTeamId': loser_team,
                            'winnerTeamId': bonus_winner['winnerTeamId'],
                            'loserEconomyTier': loser_tier,
                            'wasForce': was_force,
                            'forceSuccessful': force_successful
                        })

    return {
        'pistolRounds': pistol_rounds,
        'bonusRounds': bonus_rounds
    }


def compute_pistol_stats(
    pistol_bonus_data: Dict,
    kills: List[Dict],
    rounds: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute pistol and bonus round statistics per team.
    """
    pistol_rounds = pistol_bonus_data.get('pistolRounds', [])
    bonus_rounds = pistol_bonus_data.get('bonusRounds', [])

    # Initialize per-team stats
    team_stats = defaultdict(lambda: {
        'pistolPlayed': 0,
        'pistolWon': 0,
        'firstHalfPistolWon': 0,
        'firstHalfPistolPlayed': 0,
        'secondHalfPistolWon': 0,
        'secondHalfPistolPlayed': 0,
        'attackPistolWon': 0,
        'attackPistolPlayed': 0,
        'defensePistolWon': 0,
        'defensePistolPlayed': 0,
        'bonusPlayed': 0,
        'bonusWon': 0,
        'lostToForce': 0,
        'forceAttempts': 0,
        'forceWins': 0,
        'pistolKills': 0,
        'pistolDeaths': 0
    })

    # Track player pistol performance
    player_pistol_stats = defaultdict(lambda: {'kills': 0, 'deaths': 0})

    # Process pistol rounds
    for pistol in pistol_rounds:
        winner = pistol['winnerTeamId']
        loser = pistol.get('loserTeamId')
        half = pistol['half']
        winner_side = pistol.get('winnerSide')
        game_id = pistol['gameId']
        round_num = pistol['roundNumber']

        # Winner stats
        team_stats[winner]['pistolPlayed'] += 1
        team_stats[winner]['pistolWon'] += 1

        if half == 'first':
            team_stats[winner]['firstHalfPistolPlayed'] += 1
            team_stats[winner]['firstHalfPistolWon'] += 1
        else:
            team_stats[winner]['secondHalfPistolPlayed'] += 1
            team_stats[winner]['secondHalfPistolWon'] += 1

        if winner_side == 'attack':
            team_stats[winner]['attackPistolPlayed'] += 1
            team_stats[winner]['attackPistolWon'] += 1
        elif winner_side == 'defense':
            team_stats[winner]['defensePistolPlayed'] += 1
            team_stats[winner]['defensePistolWon'] += 1

        # Loser stats
        if loser:
            team_stats[loser]['pistolPlayed'] += 1
            if half == 'first':
                team_stats[loser]['firstHalfPistolPlayed'] += 1
            else:
                team_stats[loser]['secondHalfPistolPlayed'] += 1

            # Loser's side is opposite of winner
            if winner_side == 'attack':
                team_stats[loser]['defensePistolPlayed'] += 1
            elif winner_side == 'defense':
                team_stats[loser]['attackPistolPlayed'] += 1

        # Count pistol round kills
        pistol_kills = [k for k in kills if k.get('gameId') == game_id and k.get('roundNumber') == round_num]
        for kill in pistol_kills:
            killer_team = kill.get('killerTeamId')
            victim_team = kill.get('victimTeamId')
            killer_id = kill.get('killerId')
            victim_id = kill.get('victimId')

            if killer_team:
                team_stats[killer_team]['pistolKills'] += 1
            if victim_team:
                team_stats[victim_team]['pistolDeaths'] += 1
            if killer_id:
                player_pistol_stats[killer_id]['kills'] += 1
            if victim_id:
                player_pistol_stats[victim_id]['deaths'] += 1

    # Process bonus rounds (for pistol winners)
    for bonus in bonus_rounds:
        pistol_winner = bonus['pistolWinnerTeamId']
        pistol_loser = bonus['pistolLoserTeamId']
        round_winner = bonus['winnerTeamId']
        was_force = bonus.get('wasForce', False)
        force_successful = bonus.get('forceSuccessful', False)

        # Bonus round for pistol winner
        team_stats[pistol_winner]['bonusPlayed'] += 1
        if round_winner == pistol_winner:
            team_stats[pistol_winner]['bonusWon'] += 1
        else:
            # Lost bonus round
            if was_force:
                team_stats[pistol_winner]['lostToForce'] += 1

        # Force buy for pistol loser
        if pistol_loser and was_force:
            team_stats[pistol_loser]['forceAttempts'] += 1
            if force_successful:
                team_stats[pistol_loser]['forceWins'] += 1

    # Find top pistol fragger per team
    team_top_fraggers = {}
    for player_id, stats in player_pistol_stats.items():
        # Find player's team from kills
        player_team = None
        for kill in kills:
            if kill.get('killerId') == player_id:
                player_team = kill.get('killerTeamId')
                break
            if kill.get('victimId') == player_id:
                player_team = kill.get('victimTeamId')
                break

        if player_team:
            if player_team not in team_top_fraggers:
                team_top_fraggers[player_team] = (player_id, stats)
            elif stats['kills'] > team_top_fraggers[player_team][1]['kills']:
                team_top_fraggers[player_team] = (player_id, stats)

    # Build output
    pistol_stats_list = []
    for team_id, stats in team_stats.items():
        team_info = team_map.get(team_id, {})

        pistol_played = stats['pistolPlayed']
        pistol_won = stats['pistolWon']
        bonus_played = stats['bonusPlayed']
        bonus_won = stats['bonusWon']
        force_attempts = stats['forceAttempts']
        force_wins = stats['forceWins']

        # Get top fragger
        top_fragger = team_top_fraggers.get(team_id)
        top_fragger_info = None
        if top_fragger:
            player_id, p_stats = top_fragger
            pistol_deaths = p_stats['deaths']
            top_fragger_info = {
                'playerId': player_id,
                'playerName': player_map.get(player_id, f'Player {player_id}'),
                'pistolKills': p_stats['kills'],
                'pistolDeaths': pistol_deaths,
                'pistolKD': round(p_stats['kills'] / pistol_deaths, 2) if pistol_deaths > 0 else p_stats['kills']
            }

        pistol_stats_list.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'pistolRounds': {
                'played': pistol_played,
                'won': pistol_won,
                'winRate': round(pistol_won / pistol_played, 3) if pistol_played > 0 else 0,
                'firstHalfWinRate': round(stats['firstHalfPistolWon'] / stats['firstHalfPistolPlayed'], 3) if stats['firstHalfPistolPlayed'] > 0 else 0,
                'secondHalfWinRate': round(stats['secondHalfPistolWon'] / stats['secondHalfPistolPlayed'], 3) if stats['secondHalfPistolPlayed'] > 0 else 0,
                'attackPistolWinRate': round(stats['attackPistolWon'] / stats['attackPistolPlayed'], 3) if stats['attackPistolPlayed'] > 0 else 0,
                'defensePistolWinRate': round(stats['defensePistolWon'] / stats['defensePistolPlayed'], 3) if stats['defensePistolPlayed'] > 0 else 0
            },
            'bonusConversion': {
                'bonusRoundsPlayed': bonus_played,
                'bonusRoundsWon': bonus_won,
                'bonusConversionRate': round(bonus_won / bonus_played, 3) if bonus_played > 0 else 0,
                'lostToForceRate': round(stats['lostToForce'] / bonus_played, 3) if bonus_played > 0 else 0
            },
            'antiBonus': {
                'forceAttempts': force_attempts,
                'forceWins': force_wins,
                'forceWinRate': round(force_wins / force_attempts, 3) if force_attempts > 0 else 0
            },
            'pistolTopFragger': top_fragger_info
        })

    return pistol_stats_list


def get_alive_players_at_time(
    kills: List[Dict],
    timestamp: str,
    team_id: str,
    all_team_players: set,
    game_id: str,
    round_number: int
) -> set:
    """
    Get set of player IDs alive at a given timestamp.
    """
    # Get kills in this round before timestamp
    round_kills = [
        k for k in kills
        if k.get('gameId') == game_id
        and k.get('roundNumber') == round_number
        and k.get('timestamp', '') < timestamp
    ]

    dead_players = {k.get('victimId') for k in round_kills if k.get('victimTeamId') == team_id}
    return all_team_players - dead_players


def build_round_alive_timeline(
    kills: List[Dict],
    game_id: str,
    round_number: int,
    team_a_id: str,
    team_a_players: set,
    team_b_id: str,
    team_b_players: set
) -> List[Dict]:
    """
    Build timeline of alive counts for a round.
    """
    # Get all kills in this round, sorted by timestamp
    round_kills = sorted(
        [k for k in kills if k.get('gameId') == game_id and k.get('roundNumber') == round_number],
        key=lambda k: k.get('timestamp', '')
    )

    # Start with full teams
    timeline = [{
        'timestamp': None,
        'team_a_alive': len(team_a_players),
        'team_b_alive': len(team_b_players),
        'situation': f"{len(team_a_players)}v{len(team_b_players)}"
    }]

    team_a_alive = set(team_a_players)
    team_b_alive = set(team_b_players)

    for kill in round_kills:
        victim_id = kill.get('victimId')
        victim_team = kill.get('victimTeamId')
        timestamp = kill.get('timestamp')

        if victim_team == team_a_id and victim_id in team_a_alive:
            team_a_alive.discard(victim_id)
        elif victim_team == team_b_id and victim_id in team_b_alive:
            team_b_alive.discard(victim_id)

        timeline.append({
            'timestamp': timestamp,
            'team_a_alive': len(team_a_alive),
            'team_b_alive': len(team_b_alive),
            'situation': f"{len(team_a_alive)}v{len(team_b_alive)}"
        })

    return timeline


def identify_advantage_situations(
    round_timeline: List[Dict],
    round_data: Dict,
    team_id: str,
    team_a_id: str
) -> Dict:
    """
    Identify man advantage/disadvantage situations for a team in a round.
    """
    game_id = round_data.get('gameId')
    round_number = round_data.get('roundNumber')
    winner_team = round_data.get('winnerTeamId')
    round_won = (winner_team == team_id)

    # Determine if this team is team_a or team_b
    is_team_a = (team_id == team_a_id)

    max_advantage = 0
    max_advantage_situation = "5v5"
    max_disadvantage = 0
    max_disadvantage_situation = "5v5"
    advantage_timestamp = None

    for state in round_timeline:
        if is_team_a:
            my_alive = state['team_a_alive']
            opp_alive = state['team_b_alive']
        else:
            my_alive = state['team_b_alive']
            opp_alive = state['team_a_alive']

        advantage = my_alive - opp_alive

        if advantage > max_advantage:
            max_advantage = advantage
            max_advantage_situation = f"{my_alive}v{opp_alive}"
            advantage_timestamp = state.get('timestamp')

        if advantage < -max_disadvantage:
            max_disadvantage = -advantage
            max_disadvantage_situation = f"{my_alive}v{opp_alive}"

    # Determine conversion/throw/comeback
    converted = max_advantage >= 1 and round_won
    thrown = max_advantage >= 2 and not round_won
    comeback = max_disadvantage >= 2 and round_won

    return {
        'gameId': game_id,
        'roundNumber': round_number,
        'teamId': team_id,
        'maxAdvantage': max_advantage,
        'maxAdvantageSituation': max_advantage_situation,
        'advantageTimestamp': advantage_timestamp,
        'maxDisadvantage': max_disadvantage,
        'maxDisadvantageSituation': max_disadvantage_situation,
        'roundWon': round_won,
        'converted': converted,
        'thrown': thrown,
        'comeback': comeback,
        'comebackFrom': max_disadvantage_situation if comeback else None
    }


def compute_man_advantage_stats(
    kills: List[Dict],
    rounds: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute man advantage conversion statistics per team.
    """
    # Get all teams
    teams = list(team_map.keys())
    if len(teams) < 2:
        return []

    team_a_id = teams[0]
    team_b_id = teams[1]

    # Build player rosters per team per game
    team_players_by_game = defaultdict(lambda: defaultdict(set))
    for kill in kills:
        game_id = kill.get('gameId')
        killer_team = kill.get('killerTeamId')
        victim_team = kill.get('victimTeamId')
        killer_id = kill.get('killerId')
        victim_id = kill.get('victimId')

        if killer_id and killer_team:
            team_players_by_game[game_id][killer_team].add(killer_id)
        if victim_id and victim_team:
            team_players_by_game[game_id][victim_team].add(victim_id)

    # Process each round
    all_advantage_situations = []

    for round_data in rounds:
        game_id = round_data.get('gameId')
        round_number = round_data.get('roundNumber')

        team_a_players = team_players_by_game[game_id].get(team_a_id, set())
        team_b_players = team_players_by_game[game_id].get(team_b_id, set())

        # Ensure we have 5 players per team (fill if incomplete)
        if len(team_a_players) < 5:
            team_a_players = set(list(team_a_players) + [f'unknown_a_{i}' for i in range(5 - len(team_a_players))])
        if len(team_b_players) < 5:
            team_b_players = set(list(team_b_players) + [f'unknown_b_{i}' for i in range(5 - len(team_b_players))])

        # Build timeline
        timeline = build_round_alive_timeline(
            kills, game_id, round_number,
            team_a_id, team_a_players,
            team_b_id, team_b_players
        )

        # Get advantage situations for each team
        for team_id in [team_a_id, team_b_id]:
            situation = identify_advantage_situations(timeline, round_data, team_id, team_a_id)
            all_advantage_situations.append(situation)

    # Aggregate stats per team
    team_stats = defaultdict(lambda: {
        'byAdvantage': defaultdict(lambda: {'situations': 0, 'converted': 0}),
        'throwRounds': [],
        'comebackRounds': [],
        'situationMatrix': defaultdict(lambda: {'wins': 0, 'losses': 0})
    })

    for situation in all_advantage_situations:
        team_id = situation['teamId']
        max_adv = situation['maxAdvantage']
        round_won = situation['roundWon']
        converted = situation['converted']
        thrown = situation['thrown']
        comeback = situation['comeback']
        adv_situation = situation['maxAdvantageSituation']

        # Track by advantage size
        if max_adv >= 1:
            adv_key = f"{max_adv}_man"
            team_stats[team_id]['byAdvantage'][adv_key]['situations'] += 1
            if converted:
                team_stats[team_id]['byAdvantage'][adv_key]['converted'] += 1

        # Track throws
        if thrown:
            team_stats[team_id]['throwRounds'].append({
                'gameId': situation['gameId'],
                'roundNumber': situation['roundNumber'],
                'situation': adv_situation
            })

        # Track comebacks
        if comeback:
            team_stats[team_id]['comebackRounds'].append({
                'gameId': situation['gameId'],
                'roundNumber': situation['roundNumber'],
                'situation': situation['comebackFrom']
            })

        # Track situation matrix
        if max_adv != 0 or situation['maxDisadvantage'] != 0:
            # Use the max advantage situation
            if round_won:
                team_stats[team_id]['situationMatrix'][adv_situation]['wins'] += 1
            else:
                team_stats[team_id]['situationMatrix'][adv_situation]['losses'] += 1

    # Build output
    man_advantage_stats = []
    for team_id, stats in team_stats.items():
        team_info = team_map.get(team_id, {})

        # Compute by advantage
        by_advantage = {}
        for adv_key, adv_stats in stats['byAdvantage'].items():
            situations = adv_stats['situations']
            converted = adv_stats['converted']
            by_advantage[adv_key] = {
                'situations': situations,
                'converted': converted,
                'conversionRate': round(converted / situations, 3) if situations > 0 else 0
            }

        # Compute throw stats
        throw_rounds = stats['throwRounds']
        total_throws = len(throw_rounds)
        total_advantage_situations = sum(s['situations'] for s in stats['byAdvantage'].values())
        worst_throw = max(throw_rounds, key=lambda x: int(x['situation'].split('v')[0]) - int(x['situation'].split('v')[1])) if throw_rounds else None

        # Compute comeback stats
        comeback_rounds = stats['comebackRounds']
        total_comebacks = len(comeback_rounds)
        best_comeback = max(comeback_rounds, key=lambda x: int(x['situation'].split('v')[1]) - int(x['situation'].split('v')[0])) if comeback_rounds else None

        # Build situation matrix
        situation_matrix = {}
        for sit, sit_stats in stats['situationMatrix'].items():
            wins = sit_stats['wins']
            losses = sit_stats['losses']
            total = wins + losses
            situation_matrix[sit] = {
                'wins': wins,
                'losses': losses,
                'winRate': round(wins / total, 3) if total > 0 else 0
            }

        man_advantage_stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'byAdvantage': by_advantage,
            'throwStats': {
                'totalThrows': total_throws,
                'throwRate': round(total_throws / total_advantage_situations, 3) if total_advantage_situations > 0 else 0,
                'worstThrow': f"Lost from {worst_throw['situation']}" if worst_throw else None,
                'throwRounds': throw_rounds[:5]  # Limit to 5 for review
            },
            'comebackStats': {
                'totalComebacks': total_comebacks,
                'bestComeback': f"Won from {best_comeback['situation']}" if best_comeback else None,
                'comebackRounds': comeback_rounds[:5]  # Limit to 5 for review
            },
            'situationMatrix': situation_matrix
        })

    return man_advantage_stats


def identify_retake_rounds(
    rounds: List[Dict],
    plants: List[Dict],
    kills: List[Dict],
    defuses: List[Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Identify all retake scenarios where defenders attempt to retake after plant.
    """
    retake_rounds = []

    # Get all teams
    teams = list(team_map.keys())
    if len(teams) < 2:
        return []

    # Build plant lookup
    plant_lookup = {}
    for plant in plants:
        key = (plant.get('gameId'), plant.get('roundNumber'))
        plant_lookup[key] = plant

    # Build defuse lookup
    defuse_lookup = {}
    for defuse in defuses:
        key = (defuse.get('gameId'), defuse.get('roundNumber'))
        defuse_lookup[key] = defuse

    # Build player rosters per game
    team_players_by_game = defaultdict(lambda: defaultdict(set))
    for kill in kills:
        game_id = kill.get('gameId')
        killer_team = kill.get('killerTeamId')
        victim_team = kill.get('victimTeamId')
        killer_id = kill.get('killerId')
        victim_id = kill.get('victimId')

        if killer_id and killer_team:
            team_players_by_game[game_id][killer_team].add(killer_id)
        if victim_id and victim_team:
            team_players_by_game[game_id][victim_team].add(victim_id)

    for round_data in rounds:
        game_id = round_data.get('gameId')
        round_number = round_data.get('roundNumber')
        win_type = round_data.get('winType')
        winner_team = round_data.get('winnerTeamId')

        key = (game_id, round_number)
        plant = plant_lookup.get(key)

        # Only retakes happen when there's a plant
        if not plant:
            continue

        attacker_team = plant.get('planterTeamId')
        defender_team = None
        for team_id in teams:
            if team_id != attacker_team:
                defender_team = team_id
                break

        if not defender_team:
            continue

        plant_timestamp = plant.get('timestamp', '')
        site = plant.get('site', 'unknown')

        # Get all players per team
        attacker_players = team_players_by_game[game_id].get(attacker_team, set())
        defender_players = team_players_by_game[game_id].get(defender_team, set())

        # Count alive at plant time
        attackers_alive = len(get_alive_players_at_time(
            kills, plant_timestamp, attacker_team, attacker_players, game_id, round_number
        ))
        defenders_alive = len(get_alive_players_at_time(
            kills, plant_timestamp, defender_team, defender_players, game_id, round_number
        ))

        # Count post-plant kills
        post_plant_kills = [
            k for k in kills
            if k.get('gameId') == game_id
            and k.get('roundNumber') == round_number
            and k.get('timestamp', '') > plant_timestamp
        ]

        defender_post_plant_kills = len([k for k in post_plant_kills if k.get('killerTeamId') == defender_team])
        attacker_post_plant_kills = len([k for k in post_plant_kills if k.get('killerTeamId') == attacker_team])

        # Determine retake success
        retake_successful = (win_type == 'bombDefused' or winner_team == defender_team)

        # Get defuser if successful
        defuse = defuse_lookup.get(key)
        defuser_id = defuse.get('defuserId') if defuse else None

        retake_rounds.append({
            'gameId': game_id,
            'roundNumber': round_number,
            'site': site,
            'plantTimestamp': plant_timestamp,
            'defenderTeamId': defender_team,
            'attackerTeamId': attacker_team,
            'defendersAliveAtPlant': defenders_alive,
            'attackersAliveAtPlant': attackers_alive,
            'situation': f"{defenders_alive}v{attackers_alive}",
            'postPlantDefenderKills': defender_post_plant_kills,
            'postPlantAttackerKills': attacker_post_plant_kills,
            'retakeSuccessful': retake_successful,
            'defuserId': defuser_id,
            'roundWinType': win_type
        })

    return retake_rounds


def compute_retake_stats(
    retake_rounds: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Aggregate retake statistics per team.
    """
    team_stats = defaultdict(lambda: {
        'attempts': 0,
        'successes': 0,
        'bySite': defaultdict(lambda: {'attempts': 0, 'successes': 0}),
        'bySituation': defaultdict(lambda: {'attempts': 0, 'successes': 0}),
        'defusers': defaultdict(int)
    })

    for retake in retake_rounds:
        defender_team = retake['defenderTeamId']
        site = retake['site']
        situation = retake['situation']
        successful = retake['retakeSuccessful']
        defuser_id = retake.get('defuserId')

        team_stats[defender_team]['attempts'] += 1
        if successful:
            team_stats[defender_team]['successes'] += 1

        team_stats[defender_team]['bySite'][site]['attempts'] += 1
        if successful:
            team_stats[defender_team]['bySite'][site]['successes'] += 1

        team_stats[defender_team]['bySituation'][situation]['attempts'] += 1
        if successful:
            team_stats[defender_team]['bySituation'][situation]['successes'] += 1

        # Track clutch defusers (1v1, 1v2, etc.)
        if defuser_id and situation.startswith('1v'):
            team_stats[defender_team]['defusers'][defuser_id] += 1

    # Build output
    retake_stats_list = []
    for team_id, stats in team_stats.items():
        team_info = team_map.get(team_id, {})
        attempts = stats['attempts']
        successes = stats['successes']

        # Build by site
        by_site = {}
        for site, site_stats in stats['bySite'].items():
            s_attempts = site_stats['attempts']
            s_successes = site_stats['successes']
            by_site[site] = {
                'attempts': s_attempts,
                'successes': s_successes,
                'winRate': round(s_successes / s_attempts, 3) if s_attempts > 0 else 0
            }

        # Build by situation
        by_situation = {}
        for situation, sit_stats in stats['bySituation'].items():
            sit_attempts = sit_stats['attempts']
            sit_successes = sit_stats['successes']
            by_situation[situation] = {
                'attempts': sit_attempts,
                'successes': sit_successes,
                'winRate': round(sit_successes / sit_attempts, 3) if sit_attempts > 0 else 0
            }

        # Find top defuser
        top_defuser = None
        defusers = stats['defusers']
        if defusers:
            top_id = max(defusers, key=defusers.get)
            top_defuser = {
                'playerId': top_id,
                'playerName': player_map.get(top_id, f'Player {top_id}'),
                'clutchDefuses': defusers[top_id]
            }

        retake_stats_list.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'totalRetakeAttempts': attempts,
            'retakeSuccesses': successes,
            'retakeWinRate': round(successes / attempts, 3) if attempts > 0 else 0,
            'bySite': by_site,
            'bySituation': by_situation,
            'topDefuser': top_defuser
        })

    return retake_stats_list


def identify_entry_attempts(
    kills: List[Dict],
    rounds: List[Dict],
    ability_uses: List[Dict],
    round_team_sides: Dict
) -> List[Dict]:
    """
    Identify entry attempts - first kills of each round on attack side.
    """
    entry_attempts = []

    # Build first kill per round
    first_kills = {}
    for kill in sorted(kills, key=lambda k: k.get('timestamp', '')):
        key = (kill.get('gameId'), kill.get('roundNumber'))
        if key not in first_kills:
            first_kills[key] = kill

    for round_data in rounds:
        game_id = round_data.get('gameId')
        round_number = round_data.get('roundNumber')
        key = (game_id, round_number)

        first_kill = first_kills.get(key)
        if not first_kill:
            continue

        kill_timestamp = first_kill.get('timestamp', '')
        killer_id = first_kill.get('killerId')
        killer_team = first_kill.get('killerTeamId')
        victim_id = first_kill.get('victimId')
        victim_team = first_kill.get('victimTeamId')
        weapon = first_kill.get('weapon', 'unknown')

        # Determine if killer was on attack
        sides = round_team_sides.get(key, {})
        killer_side = sides.get(killer_team)

        # Normalize side
        if killer_side == 'attacker':
            killer_side = 'attack'
        elif killer_side == 'defender':
            killer_side = 'defense'

        is_attack = (killer_side == 'attack')

        # Entry player is the one who initiated the first duel
        # If attacker got the kill, they're the entry fragger
        # If defender got the kill, the victim was the entry fragger
        if is_attack:
            entry_player_id = killer_id
            entry_team = killer_team
            entry_success = True  # Got the kill
            entry_kill = True
            entry_death = False
        else:
            entry_player_id = victim_id
            entry_team = victim_team
            entry_success = False  # Died on entry
            entry_kill = False
            entry_death = True

        # Check for flash support (flash used within 3s before this kill by entry's team)
        flash_window_start = kill_timestamp  # We'll compare backwards
        had_flash_support = False
        flash_support_player_id = None

        for ability in ability_uses:
            if ability.get('gameId') != game_id or ability.get('roundNumber') != round_number:
                continue
            if ability.get('teamId') != entry_team:
                continue

            ability_name = ability.get('abilityName', '').lower()
            ability_time = ability.get('timestamp', '')

            # Check if it's a flash ability
            flash_abilities = ['blindside', 'flashpoint', 'guiding-light', 'paranoia', 'leer', 'dizzy', 'flash-drive']
            if any(flash in ability_name for flash in flash_abilities):
                # Check if within 3 seconds before kill
                if ability_time and kill_timestamp:
                    # Simple string comparison works for ISO timestamps
                    if ability_time < kill_timestamp:
                        had_flash_support = True
                        flash_support_player_id = ability.get('playerId')
                        break

        # Check if death was traded
        traded_out = False
        trade_time = None
        if entry_death:
            # Look for a kill of the killer within 3 seconds
            for follow_kill in kills:
                if follow_kill.get('gameId') != game_id or follow_kill.get('roundNumber') != round_number:
                    continue
                if follow_kill.get('victimId') == killer_id:
                    follow_time = follow_kill.get('timestamp', '')
                    if follow_time > kill_timestamp:
                        # Calculate time delta (rough estimate)
                        traded_out = True
                        break

        entry_attempts.append({
            'gameId': game_id,
            'roundNumber': round_number,
            'entryPlayerId': entry_player_id,
            'teamId': entry_team,
            'entrySuccess': entry_success,
            'entryKill': entry_kill,
            'entryDeath': entry_death,
            'tradedOut': traded_out,
            'opponentId': victim_id if entry_kill else killer_id,
            'hadFlashSupport': had_flash_support,
            'flashSupportPlayerId': flash_support_player_id,
            'entryWeapon': weapon,
            'timestamp': kill_timestamp
        })

    return entry_attempts


def compute_entry_stats(
    entry_attempts: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute per-player entry statistics.
    """
    player_stats = defaultdict(lambda: {
        'teamId': None,
        'attempts': 0,
        'kills': 0,
        'deaths': 0,
        'deathsTraded': 0,
        'entriesWithFlash': 0,
        'entriesWithoutFlash': 0,
        'flashSupportedWins': 0,
        'dryEntryWins': 0
    })

    for entry in entry_attempts:
        player_id = entry['entryPlayerId']
        team_id = entry['teamId']
        entry_kill = entry['entryKill']
        entry_death = entry['entryDeath']
        traded = entry.get('tradedOut', False)
        had_flash = entry.get('hadFlashSupport', False)
        success = entry['entrySuccess']

        player_stats[player_id]['teamId'] = team_id
        player_stats[player_id]['attempts'] += 1

        if entry_kill:
            player_stats[player_id]['kills'] += 1
        if entry_death:
            player_stats[player_id]['deaths'] += 1
            if traded:
                player_stats[player_id]['deathsTraded'] += 1

        if had_flash:
            player_stats[player_id]['entriesWithFlash'] += 1
            if success:
                player_stats[player_id]['flashSupportedWins'] += 1
        else:
            player_stats[player_id]['entriesWithoutFlash'] += 1
            if success:
                player_stats[player_id]['dryEntryWins'] += 1

    # Build output
    entry_stats_list = []
    for player_id, stats in player_stats.items():
        team_id = stats['teamId']
        team_info = team_map.get(team_id, {})

        attempts = stats['attempts']
        kills = stats['kills']
        deaths = stats['deaths']
        deaths_traded = stats['deathsTraded']
        flash_entries = stats['entriesWithFlash']
        dry_entries = stats['entriesWithoutFlash']
        flash_wins = stats['flashSupportedWins']
        dry_wins = stats['dryEntryWins']

        entry_stats_list.append({
            'playerId': player_id,
            'playerName': player_map.get(player_id, f'Player {player_id}'),
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'entryAttempts': attempts,
            'entryKills': kills,
            'entryDeaths': deaths,
            'entryKillRate': round(kills / attempts, 3) if attempts > 0 else 0,
            'entrySuccessRate': round((kills + (attempts - deaths)) / attempts / 2, 3) if attempts > 0 else 0,
            'deathsTraded': deaths_traded,
            'deathsUntraded': deaths - deaths_traded,
            'tradeRate': round(deaths_traded / deaths, 3) if deaths > 0 else 0,
            'entriesWithFlash': flash_entries,
            'entriesWithoutFlash': dry_entries,
            'flashSupportedWinRate': round(flash_wins / flash_entries, 3) if flash_entries > 0 else 0,
            'dryEntryWinRate': round(dry_wins / dry_entries, 3) if dry_entries > 0 else 0
        })

    return sorted(entry_stats_list, key=lambda x: x['entryAttempts'], reverse=True)


def compute_spike_carrier_stats(
    plants: List[Dict],
    kills: List[Dict],
    rounds: List[Dict],
    spike_pickups: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute spike carrier statistics per team.
    """
    # Build plant lookup by round
    plant_lookup = {}
    for plant in plants:
        key = (plant.get('gameId'), plant.get('roundNumber'))
        plant_lookup[key] = plant

    # Build round winner lookup
    round_winners = {}
    for r in rounds:
        key = (r.get('gameId'), r.get('roundNumber'))
        round_winners[key] = r.get('winnerTeamId')

    # Identify spike carrier fates
    carrier_fates = []

    # Group spike pickups by round
    pickups_by_round = defaultdict(list)
    for pickup in spike_pickups:
        key = (pickup.get('gameId'), pickup.get('roundNumber'))
        pickups_by_round[key].append(pickup)

    for round_data in rounds:
        game_id = round_data.get('gameId')
        round_number = round_data.get('roundNumber')
        key = (game_id, round_number)

        plant = plant_lookup.get(key)
        pickups = pickups_by_round.get(key, [])
        winner = round_winners.get(key)

        # Determine initial carrier
        initial_carrier_id = None
        if pickups:
            # First pickup is initial carrier
            initial_carrier_id = pickups[0].get('playerId')

        # Final carrier is the planter
        final_carrier_id = plant.get('planterId') if plant else None

        # If we have a planter but no initial carrier, use planter
        if final_carrier_id and not initial_carrier_id:
            initial_carrier_id = final_carrier_id

        if not initial_carrier_id:
            continue

        # Determine carrier team
        carrier_team = None
        if plant:
            carrier_team = plant.get('planterTeamId')
        else:
            # Get from kills
            for kill in kills:
                if kill.get('killerId') == initial_carrier_id:
                    carrier_team = kill.get('killerTeamId')
                    break
                if kill.get('victimId') == initial_carrier_id:
                    carrier_team = kill.get('victimTeamId')
                    break

        if not carrier_team:
            continue

        # Determine fate
        if plant:
            fate = 'planted'
            plant_timestamp = plant.get('timestamp')
        else:
            # Check if carrier died before plant
            carrier_died = False
            death_info = None
            for kill in kills:
                if kill.get('gameId') == game_id and kill.get('roundNumber') == round_number:
                    if kill.get('victimId') == initial_carrier_id:
                        carrier_died = True
                        death_info = kill
                        break

            if carrier_died:
                fate = 'died_before_plant'
            else:
                fate = 'survived_no_plant'

        # Check if round was won
        round_won = (winner == carrier_team)

        carrier_fates.append({
            'gameId': game_id,
            'roundNumber': round_number,
            'carrierId': initial_carrier_id,
            'carrierTeamId': carrier_team,
            'finalCarrierId': final_carrier_id,
            'fate': fate,
            'spikeDropped': len(pickups) > 1,
            'roundWon': round_won
        })

    # Aggregate by team
    team_stats = defaultdict(lambda: {
        'totalAttackRounds': 0,
        'successfulPlants': 0,
        'carrierDeaths': 0,
        'byPlayer': defaultdict(lambda: {
            'rounds': 0,
            'plants': 0,
            'deaths': 0
        }),
        'spikeDrops': 0
    })

    for fate in carrier_fates:
        team_id = fate['carrierTeamId']
        carrier_id = fate['carrierId']
        fate_type = fate['fate']
        dropped = fate.get('spikeDropped', False)

        team_stats[team_id]['totalAttackRounds'] += 1
        team_stats[team_id]['byPlayer'][carrier_id]['rounds'] += 1

        if fate_type == 'planted':
            team_stats[team_id]['successfulPlants'] += 1
            team_stats[team_id]['byPlayer'][carrier_id]['plants'] += 1
        elif fate_type == 'died_before_plant':
            team_stats[team_id]['carrierDeaths'] += 1
            team_stats[team_id]['byPlayer'][carrier_id]['deaths'] += 1

        if dropped:
            team_stats[team_id]['spikeDrops'] += 1

    # Build output
    spike_carrier_stats = []
    for team_id, stats in team_stats.items():
        team_info = team_map.get(team_id, {})

        total = stats['totalAttackRounds']
        plants_count = stats['successfulPlants']
        carrier_deaths = stats['carrierDeaths']

        # Build player breakdown
        by_player = {}
        for player_id, p_stats in stats['byPlayer'].items():
            p_rounds = p_stats['rounds']
            p_plants = p_stats['plants']
            p_deaths = p_stats['deaths']
            by_player[player_id] = {
                'playerId': player_id,
                'playerName': player_map.get(player_id, f'Player {player_id}'),
                'roundsAsCarrier': p_rounds,
                'successfulPlants': p_plants,
                'deathsBeforePlant': p_deaths,
                'plantRate': round(p_plants / p_rounds, 3) if p_rounds > 0 else 0
            }

        spike_carrier_stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'totalAttackRounds': total,
            'successfulPlants': plants_count,
            'carrierDeathsBeforePlant': carrier_deaths,
            'plantRate': round(plants_count / total, 3) if total > 0 else 0,
            'carrierDeathRate': round(carrier_deaths / total, 3) if total > 0 else 0,
            'spikeDrops': stats['spikeDrops'],
            'byPlayer': by_player
        })

    return spike_carrier_stats


# =============================================================================
# Sprint 4: Pattern Recognition & Predictive Analytics
# =============================================================================

def detect_round_streaks(
    rounds: List[Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Identify all win/loss streaks for all teams.
    A streak is 2+ consecutive round wins or losses.
    """
    streaks = []
    teams = list(team_map.keys())

    if len(teams) < 2:
        return []

    # Group rounds by game
    game_rounds = defaultdict(list)
    for r in rounds:
        game_id = r.get('gameId')
        if game_id:
            game_rounds[game_id].append(r)

    for game_id, game_round_list in game_rounds.items():
        # Sort by round number
        sorted_rounds = sorted(game_round_list, key=lambda x: x.get('roundNumber', 0))

        for team_id in teams:
            # Build win/loss sequence for this team
            sequence = []
            for r in sorted_rounds:
                winner = r.get('winnerTeamId')
                round_num = r.get('roundNumber', 0)
                side = r.get('winnerSide', 'unknown')
                won = (winner == team_id)
                sequence.append({
                    'roundNumber': round_num,
                    'won': won,
                    'side': side if won else ('attack' if side == 'defense' else 'defense'),
                    'winType': r.get('winType'),
                    'hadPlant': r.get('hadPlant', False),
                    'hadDefuse': r.get('hadDefuse', False)
                })

            # Detect streaks
            if not sequence:
                continue

            current_streak = [sequence[0]]
            current_type = 'win' if sequence[0]['won'] else 'loss'

            for i in range(1, len(sequence)):
                is_win = sequence[i]['won']
                expected_type = 'win' if is_win else 'loss'

                if expected_type == current_type:
                    current_streak.append(sequence[i])
                else:
                    # End current streak if length >= 2
                    if len(current_streak) >= 2:
                        streaks.append(_build_streak_record(
                            game_id, team_id, current_type, current_streak
                        ))
                    # Start new streak
                    current_streak = [sequence[i]]
                    current_type = expected_type

            # Don't forget final streak
            if len(current_streak) >= 2:
                streaks.append(_build_streak_record(
                    game_id, team_id, current_type, current_streak
                ))

    return streaks


def _build_streak_record(
    game_id: str,
    team_id: str,
    streak_type: str,
    streak_rounds: List[Dict]
) -> Dict:
    """Build a streak record from round data."""
    start_round = streak_rounds[0]['roundNumber']
    end_round = streak_rounds[-1]['roundNumber']
    starting_side = streak_rounds[0]['side']

    # Check if streak crossed halves (round 12/13 boundary)
    crossed_halves = any(r['roundNumber'] <= 12 for r in streak_rounds) and \
                     any(r['roundNumber'] >= 13 for r in streak_rounds)

    return {
        'gameId': game_id,
        'teamId': team_id,
        'streakType': streak_type,
        'streakLength': len(streak_rounds),
        'startRound': start_round,
        'endRound': end_round,
        'startingSide': starting_side,
        'crossedHalves': crossed_halves,
        'streakRounds': [r['roundNumber'] for r in streak_rounds]
    }


def classify_streak_trigger(
    trigger_round: Dict,
    previous_round: Optional[Dict],
    round_number: int,
    clutch_situations: List[Dict],
    economy_rounds: List[Dict],
    game_id: str
) -> str:
    """Classify what triggered a streak to start."""
    # Pistol rounds
    if round_number in [1, 13]:
        return 'pistol_win'

    # Check for clutch in trigger round
    for clutch in clutch_situations:
        if clutch.get('gameId') == game_id and clutch.get('roundNumber') == round_number:
            if clutch.get('won', False):
                return 'clutch_conversion'

    # Check economy - was this an eco upset?
    for eco in economy_rounds:
        if eco.get('gameId') == game_id and eco.get('roundNumber') == round_number:
            tier = eco.get('economyTier', '')
            if tier in ['eco', 'save'] and eco.get('roundWon', False):
                return 'eco_upset'
            if tier == 'half_buy' and eco.get('roundWon', False):
                return 'force_success'

    return 'standard'


def classify_streak_breaker(
    breaker_round: Dict,
    streak_info: Dict,
    economy_rounds: List[Dict],
    man_advantage_data: List[Dict],
    game_id: str,
    round_number: int
) -> str:
    """Classify what broke a streak."""
    # Pistol loss
    if round_number in [1, 13]:
        return 'pistol_loss'

    # Check if this was a throw (had man advantage but lost)
    for ma in man_advantage_data:
        if ma.get('gameId') == game_id and ma.get('roundNumber') == round_number:
            if ma.get('thrown', False):
                return 'throw'

    # Check if lost to eco
    for eco in economy_rounds:
        if eco.get('gameId') == game_id and eco.get('roundNumber') == round_number:
            tier = eco.get('economyTier', '')
            if tier in ['eco', 'save', 'half_buy']:
                return 'eco_loss'

    # Side switch check
    if round_number == 13:
        return 'side_switch'

    return 'standard'


def compute_momentum_stats(
    streaks: List[Dict],
    rounds: List[Dict],
    clutch_situations: List[Dict],
    economy_rounds: List[Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """Aggregate momentum and streak statistics per team."""
    teams = list(team_map.keys())
    momentum_stats = []

    for team_id in teams:
        team_info = team_map.get(team_id, {})
        team_streaks = [s for s in streaks if s.get('teamId') == team_id]

        win_streaks = [s for s in team_streaks if s.get('streakType') == 'win']
        loss_streaks = [s for s in team_streaks if s.get('streakType') == 'loss']

        # Win streak stats
        win_lengths = [s.get('streakLength', 0) for s in win_streaks]
        max_win = max(win_lengths) if win_lengths else 0
        max_win_streak = next((s for s in win_streaks if s.get('streakLength') == max_win), None)

        # Loss streak stats
        loss_lengths = [s.get('streakLength', 0) for s in loss_streaks]
        max_loss = max(loss_lengths) if loss_lengths else 0
        max_loss_streak = next((s for s in loss_streaks if s.get('streakLength') == max_loss), None)

        # Trigger distribution
        trigger_dist = defaultdict(lambda: {'count': 0, 'totalLength': 0})
        for streak in win_streaks:
            # Get trigger for first round of streak
            trigger = classify_streak_trigger(
                None, None, streak.get('startRound', 0),
                clutch_situations, economy_rounds, streak.get('gameId', '')
            )
            trigger_dist[trigger]['count'] += 1
            trigger_dist[trigger]['totalLength'] += streak.get('streakLength', 0)

        # Format trigger distribution
        trigger_output = {}
        for trigger, data in trigger_dist.items():
            count = data['count']
            trigger_output[trigger] = {
                'count': count,
                'avgStreakLength': round(data['totalLength'] / count, 2) if count > 0 else 0
            }

        # Calculate scores
        total_rounds = len([r for r in rounds if any(
            r.get('winnerTeamId') == team_id or r.get('loserTeamId') == team_id
            for _ in [1]  # Dummy to check team involvement
        )])

        # Momentum score: longer win streaks, shorter loss streaks
        avg_win_len = sum(win_lengths) / len(win_lengths) if win_lengths else 0
        avg_loss_len = sum(loss_lengths) / len(loss_lengths) if loss_lengths else 0
        momentum_score = round(avg_win_len - avg_loss_len * 0.5 + 5, 2)  # Normalize around 5
        momentum_score = max(0, min(10, momentum_score))  # Clamp 0-10

        # Resilience: how quickly they recover from loss streaks
        recovery_rounds = []
        for loss_streak in loss_streaks:
            end_round = loss_streak.get('endRound', 0)
            game_id = loss_streak.get('gameId', '')
            # Find next win
            game_rounds = sorted(
                [r for r in rounds if r.get('gameId') == game_id],
                key=lambda x: x.get('roundNumber', 0)
            )
            for r in game_rounds:
                if r.get('roundNumber', 0) > end_round and r.get('winnerTeamId') == team_id:
                    recovery_rounds.append(r.get('roundNumber', 0) - end_round)
                    break

        resilience_score = round(10 - (sum(recovery_rounds) / len(recovery_rounds) if recovery_rounds else 3), 2)
        resilience_score = max(0, min(10, resilience_score))

        # Key momentum rounds
        key_rounds = []
        for streak in team_streaks[:5]:  # Top 5 streaks
            key_rounds.append({
                'gameId': streak.get('gameId'),
                'roundNumber': streak.get('startRound'),
                'momentumType': 'streak_start' if streak.get('streakType') == 'win' else 'loss_streak_start',
                'significance': f"{streak.get('streakLength')}-round {streak.get('streakType')} streak started"
            })

        momentum_stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'winStreaks': {
                'count': len(win_streaks),
                'avgLength': round(avg_win_len, 2),
                'maxLength': max_win,
                'maxStreakGame': max_win_streak.get('gameId') if max_win_streak else None,
                'maxStreakRounds': f"Rounds {max_win_streak.get('startRound')}-{max_win_streak.get('endRound')}" if max_win_streak else None
            },
            'lossStreaks': {
                'count': len(loss_streaks),
                'avgLength': round(avg_loss_len, 2),
                'maxLength': max_loss,
                'maxStreakGame': max_loss_streak.get('gameId') if max_loss_streak else None,
                'maxStreakRounds': f"Rounds {max_loss_streak.get('startRound')}-{max_loss_streak.get('endRound')}" if max_loss_streak else None
            },
            'triggerDistribution': trigger_output,
            'momentumScore': momentum_score,
            'resilienceScore': resilience_score,
            'keyMomentumRounds': key_rounds
        })

    return momentum_stats


def compute_round_importance(
    round_info: Dict,
    game_context: Dict,
    clutch_situations: List[Dict],
    economy_rounds: List[Dict],
    streaks: List[Dict]
) -> Dict:
    """Compute importance score for a round."""
    game_id = round_info.get('gameId')
    round_number = round_info.get('roundNumber', 0)
    score = 0
    factors = []

    # Get score context
    team_score = game_context.get('teamScore', 0)
    opponent_score = game_context.get('opponentScore', 0)
    score_diff = abs(team_score - opponent_score)

    # Score closeness (max 30 points)
    if score_diff <= 2:
        score += 30
        factors.append({'factor': 'close_score', 'weight': 30, 'description': f'Score within 2 rounds ({team_score}-{opponent_score})'})
    elif score_diff <= 4:
        score += 20
        factors.append({'factor': 'competitive', 'weight': 20, 'description': 'Competitive score'})
    else:
        score += 10

    # Match point (20 points)
    if team_score >= 12 or opponent_score >= 12:
        score += 20
        factors.append({'factor': 'match_point', 'weight': 20, 'description': 'Match point round'})

    # Pistol rounds (15 points)
    if round_number in [1, 13]:
        score += 15
        factors.append({'factor': 'pistol', 'weight': 15, 'description': 'Pistol round'})

    # Clutch situation (15 points)
    for clutch in clutch_situations:
        if clutch.get('gameId') == game_id and clutch.get('roundNumber') == round_number:
            score += 15
            factors.append({'factor': 'clutch', 'weight': 15, 'description': f"Clutch situation: {clutch.get('situation')}"})
            break

    # Economy pivot (10 points)
    for eco in economy_rounds:
        if eco.get('gameId') == game_id and eco.get('roundNumber') == round_number:
            tier = eco.get('economyTier', '')
            if tier in ['eco', 'save']:
                score += 10
                factors.append({'factor': 'economy_pivot', 'weight': 10, 'description': f'{tier} round'})
            break

    # Streak relevance (10 points)
    for streak in streaks:
        if streak.get('gameId') == game_id:
            if round_number == streak.get('startRound'):
                score += 10
                factors.append({'factor': 'streak_start', 'weight': 10, 'description': 'Started streak'})
            elif round_number == streak.get('endRound') + 1:  # Round after streak ended
                score += 10
                factors.append({'factor': 'streak_break', 'weight': 10, 'description': 'Broke streak'})

    # Determine priority
    if score >= 50:
        priority = 'critical'
    elif score >= 35:
        priority = 'high'
    elif score >= 20:
        priority = 'medium'
    else:
        priority = 'low'

    return {
        'gameId': game_id,
        'roundNumber': round_number,
        'importanceScore': min(score, 100),
        'importanceFactors': factors,
        'reviewPriority': priority,
        'reviewReason': factors[0]['description'] if factors else 'Standard round'
    }


def identify_critical_rounds(
    rounds: List[Dict],
    round_importance_scores: List[Dict],
    clutch_situations: List[Dict],
    streaks: List[Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """Identify rounds that coaches should prioritize for review."""
    critical_rounds_by_game = defaultdict(list)

    for importance in round_importance_scores:
        if importance.get('reviewPriority') in ['critical', 'high', 'medium']:
            game_id = importance.get('gameId')
            critical_rounds_by_game[game_id].append({
                'roundNumber': importance.get('roundNumber'),
                'category': importance.get('importanceFactors', [{}])[0].get('factor', 'standard'),
                'importance': importance.get('importanceScore', 0),
                'description': importance.get('reviewReason', ''),
                'learningOpportunity': _get_learning_opportunity(importance),
                'relatedRounds': []
            })

    results = []
    for game_id, game_critical in critical_rounds_by_game.items():
        # Sort by importance
        sorted_critical = sorted(game_critical, key=lambda x: x['importance'], reverse=True)

        # Categorize
        by_category = defaultdict(list)
        for cr in sorted_critical:
            by_category[cr['category']].append(cr['roundNumber'])

        results.append({
            'gameId': game_id,
            'criticalRounds': sorted_critical[:10],  # Top 10
            'totalCriticalRounds': len(sorted_critical),
            'reviewTimeEstimate': round(len(sorted_critical) * 2, 1),  # ~2 min per round
            'byCategory': dict(by_category)
        })

    return results


def _get_learning_opportunity(importance: Dict) -> str:
    """Generate learning opportunity text based on importance factors."""
    factors = importance.get('importanceFactors', [])
    if not factors:
        return 'Review round execution'

    factor = factors[0].get('factor', '')
    if factor == 'close_score':
        return 'Analyze decision-making under pressure'
    elif factor == 'match_point':
        return 'Study high-stakes execution'
    elif factor == 'clutch':
        return 'Review clutch mechanics and positioning'
    elif factor == 'economy_pivot':
        return 'Evaluate economy decisions'
    elif factor == 'streak_start':
        return 'Identify what initiated momentum'
    elif factor == 'streak_break':
        return 'Understand what stopped momentum'
    elif factor == 'pistol':
        return 'Analyze pistol round strategy'
    return 'Review round execution'


def compute_critical_round_stats(
    critical_rounds_data: List[Dict],
    rounds: List[Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """Aggregate critical round statistics for coaching insights."""
    stats = []

    for cr_data in critical_rounds_data:
        game_id = cr_data.get('gameId')
        critical_rounds = cr_data.get('criticalRounds', [])

        # Count by priority
        by_priority = {'critical': 0, 'high': 0, 'medium': 0}
        for cr in critical_rounds:
            imp = cr.get('importance', 0)
            if imp >= 50:
                by_priority['critical'] += 1
            elif imp >= 35:
                by_priority['high'] += 1
            else:
                by_priority['medium'] += 1

        # Category breakdown
        category_breakdown = {}
        by_cat = cr_data.get('byCategory', {})
        for cat, round_nums in by_cat.items():
            # Calculate win rate in these rounds
            wins = 0
            for rn in round_nums:
                for r in rounds:
                    if r.get('gameId') == game_id and r.get('roundNumber') == rn:
                        # This would need team context to determine if "won"
                        wins += 1  # Placeholder
                        break
            category_breakdown[cat] = {
                'count': len(round_nums),
                'rounds': round_nums[:5]  # Top 5
            }

        # Top review rounds
        top_rounds = []
        for cr in critical_rounds[:5]:
            top_rounds.append({
                'roundNumber': cr.get('roundNumber'),
                'reason': cr.get('description', ''),
                'coachingFocus': cr.get('learningOpportunity', '')
            })

        stats.append({
            'gameId': game_id,
            'totalCriticalRounds': cr_data.get('totalCriticalRounds', 0),
            'byPriority': by_priority,
            'categoryBreakdown': category_breakdown,
            'topReviewRounds': top_rounds,
            'reviewTimeEstimate': cr_data.get('reviewTimeEstimate', 0)
        })

    return stats


def compute_round_by_round_performance(
    rounds: List[Dict],
    kills: List[Dict],
    economy_rounds: List[Dict],
    player_map: Dict[str, str],
    team_id: str
) -> List[Dict]:
    """Compute performance metrics for each round to enable trend analysis."""
    performances = []

    # Build kills per round
    kills_by_round = defaultdict(list)
    for k in kills:
        key = (k.get('gameId'), k.get('roundNumber'))
        kills_by_round[key].append(k)

    # Build economy by round
    eco_by_round = {}
    for eco in economy_rounds:
        key = (eco.get('gameId'), eco.get('roundNumber'), eco.get('teamId'))
        eco_by_round[key] = eco

    cumulative_kd = 0
    cumulative_rounds = 0

    for r in sorted(rounds, key=lambda x: (x.get('gameId', ''), x.get('roundNumber', 0))):
        game_id = r.get('gameId')
        round_num = r.get('roundNumber', 0)
        winner = r.get('winnerTeamId')
        won = (winner == team_id)

        round_kills = kills_by_round.get((game_id, round_num), [])

        # Team kills and deaths
        team_kills = len([k for k in round_kills if k.get('killerTeamId') == team_id])
        team_deaths = len([k for k in round_kills if k.get('victimTeamId') == team_id])
        kd_diff = team_kills - team_deaths
        cumulative_kd += kd_diff

        # Headshots
        hs_kills = len([k for k in round_kills if k.get('killerTeamId') == team_id and k.get('isHeadshot', False)])
        hs_rate = round(hs_kills / team_kills, 3) if team_kills > 0 else 0

        # First blood
        fb_won = False
        if round_kills:
            first_kill = min(round_kills, key=lambda k: k.get('timestamp', ''))
            fb_won = first_kill.get('killerTeamId') == team_id

        # Economy tier
        eco = eco_by_round.get((game_id, round_num, team_id), {})
        eco_tier = eco.get('economyTier', 'unknown')

        cumulative_rounds += 1 if won else -1

        performances.append({
            'gameId': game_id,
            'roundNumber': round_num,
            'teamId': team_id,
            'won': won,
            'side': r.get('winnerSide') if won else ('attack' if r.get('winnerSide') == 'defense' else 'defense'),
            'kills': team_kills,
            'deaths': team_deaths,
            'kdDiff': kd_diff,
            'headshotKills': hs_kills,
            'headshotRate': hs_rate,
            'firstBloodWon': fb_won,
            'economyTier': eco_tier,
            'cumulativeRoundDiff': cumulative_rounds,
            'cumulativeKdDiff': cumulative_kd
        })

    return performances


def detect_performance_trends(
    round_performances: List[Dict],
    window_size: int = 5
) -> Dict:
    """Detect trends in performance metrics using rolling windows."""
    if not round_performances:
        return {}

    game_id = round_performances[0].get('gameId') if round_performances else ''
    team_id = round_performances[0].get('teamId') if round_performances else ''

    # Calculate rolling averages
    hs_rates = [p.get('headshotRate', 0) for p in round_performances]
    kd_diffs = [p.get('kdDiff', 0) for p in round_performances]

    # Headshot trend
    if len(hs_rates) >= window_size:
        start_avg = sum(hs_rates[:window_size]) / window_size
        end_avg = sum(hs_rates[-window_size:]) / window_size
        hs_change = end_avg - start_avg

        if hs_change > 0.05:
            hs_direction = 'improving'
        elif hs_change < -0.05:
            hs_direction = 'declining'
        else:
            hs_direction = 'stable'
    else:
        start_avg = sum(hs_rates) / len(hs_rates) if hs_rates else 0
        end_avg = start_avg
        hs_direction = 'stable'
        hs_change = 0

    # Detect phases
    phases = []
    phase_size = max(4, len(round_performances) // 3)
    for i in range(0, len(round_performances), phase_size):
        phase_perfs = round_performances[i:i + phase_size]
        if not phase_perfs:
            continue

        avg_kd = sum(p.get('kdDiff', 0) for p in phase_perfs) / len(phase_perfs)
        wins = sum(1 for p in phase_perfs if p.get('won', False))
        win_rate = wins / len(phase_perfs)

        if win_rate > 0.6:
            phase_type = 'dominant'
        elif win_rate < 0.4:
            phase_type = 'struggling'
        else:
            phase_type = 'competitive'

        phases.append({
            'startRound': phase_perfs[0].get('roundNumber', i + 1),
            'endRound': phase_perfs[-1].get('roundNumber', i + len(phase_perfs)),
            'phase': phase_type,
            'avgKdDiff': round(avg_kd, 2)
        })

    # Late game analysis (rounds 18+)
    early_perfs = [p for p in round_performances if p.get('roundNumber', 0) <= 12]
    late_perfs = [p for p in round_performances if p.get('roundNumber', 0) >= 18]

    early_kd = sum(p.get('kdDiff', 0) for p in early_perfs) / len(early_perfs) if early_perfs else 0
    late_kd = sum(p.get('kdDiff', 0) for p in late_perfs) / len(late_perfs) if late_perfs else 0

    return {
        'gameId': game_id,
        'teamId': team_id,
        'headshotTrend': {
            'direction': hs_direction,
            'startValue': round(start_avg, 3),
            'endValue': round(end_avg, 3),
            'changePercent': round(hs_change * 100, 1)
        },
        'phases': phases,
        'fatigueIndicators': {
            'lateGameDropoff': late_kd < early_kd - 0.5,
            'lateGameKdDiff': round(late_kd, 2),
            'earlyGameKdDiff': round(early_kd, 2)
        }
    }


def compute_performance_trend_stats(
    trend_data: List[Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """Aggregate performance trend statistics."""
    stats = []

    for trend in trend_data:
        team_id = trend.get('teamId', '')
        team_info = team_map.get(team_id, {})

        phases = trend.get('phases', [])
        fatigue = trend.get('fatigueIndicators', {})

        # Count phase types
        phase_counts = defaultdict(int)
        for p in phases:
            phase_counts[p.get('phase', 'unknown')] += 1

        # Determine common patterns
        dominant_count = phase_counts.get('dominant', 0)
        struggling_count = phase_counts.get('struggling', 0)
        total_phases = len(phases)

        stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'gameId': trend.get('gameId'),
            'trendProfile': {
                'headshotDirection': trend.get('headshotTrend', {}).get('direction', 'stable'),
                'phaseDistribution': dict(phase_counts),
                'dominantPhases': dominant_count,
                'strugglingPhases': struggling_count
            },
            'fatigueIndicators': fatigue,
            'coachingFlags': _generate_coaching_flags(trend)
        })

    return stats


def _generate_coaching_flags(trend: Dict) -> List[Dict]:
    """Generate coaching flags from trend data."""
    flags = []
    fatigue = trend.get('fatigueIndicators', {})

    if fatigue.get('lateGameDropoff', False):
        flags.append({
            'flag': 'late_game_dropoff',
            'description': 'Performance drops in late rounds',
            'severity': 'medium'
        })

    hs_trend = trend.get('headshotTrend', {})
    if hs_trend.get('direction') == 'declining' and hs_trend.get('changePercent', 0) < -10:
        flags.append({
            'flag': 'mechanical_decline',
            'description': 'Headshot rate declining significantly',
            'severity': 'high'
        })

    return flags


def extract_composition_data(
    evidence: Dict
) -> List[Dict]:
    """Extract agent composition for each game."""
    compositions = []
    agent_compositions = evidence.get('agentCompositions', {})
    games = evidence.get('games', [])
    rounds = evidence.get('rounds', [])

    for game in games:
        game_id = game.get('gameId')
        map_name = game.get('mapName', 'Unknown')
        comp = agent_compositions.get(game_id, [])

        if not comp:
            continue

        # Group by team
        team_agents = defaultdict(list)
        player_agents = {}
        for pick in comp:
            team_id = pick.get('teamId')
            agent = pick.get('agent', 'unknown').lower()
            player_id = pick.get('playerId')
            team_agents[team_id].append(agent)
            player_agents[player_id] = agent

        # Calculate round outcomes per team
        game_rounds = [r for r in rounds if r.get('gameId') == game_id]

        for team_id, agents in team_agents.items():
            # Count rounds won
            rounds_won = len([r for r in game_rounds if r.get('winnerTeamId') == team_id])
            rounds_lost = len(game_rounds) - rounds_won

            # Role breakdown
            roles = {'duelist': 0, 'controller': 0, 'initiator': 0, 'sentinel': 0}
            agent_roles = {
                'jett': 'duelist', 'raze': 'duelist', 'reyna': 'duelist', 'phoenix': 'duelist',
                'neon': 'duelist', 'yoru': 'duelist', 'iso': 'duelist',
                'omen': 'controller', 'brimstone': 'controller', 'viper': 'controller',
                'astra': 'controller', 'harbor': 'controller', 'clove': 'controller',
                'sova': 'initiator', 'breach': 'initiator', 'skye': 'initiator',
                'kayo': 'initiator', 'fade': 'initiator', 'gekko': 'initiator',
                'cypher': 'sentinel', 'killjoy': 'sentinel', 'sage': 'sentinel',
                'chamber': 'sentinel', 'deadlock': 'sentinel', 'vyse': 'sentinel'
            }

            for agent in agents:
                role = agent_roles.get(agent, 'unknown')
                if role in roles:
                    roles[role] += 1

            compositions.append({
                'gameId': game_id,
                'mapName': map_name,
                'teamId': team_id,
                'agents': sorted(agents),
                'composition': '-'.join(sorted(agents)),
                'roles': roles,
                'roleString': f"{roles['duelist']}-{roles['controller']}-{roles['initiator']}-{roles['sentinel']}",
                'playerAgents': {k: v for k, v in player_agents.items() if k in [p.get('playerId') for p in comp if p.get('teamId') == team_id]},
                'mapWon': rounds_won > rounds_lost,
                'roundsWon': rounds_won,
                'roundsLost': rounds_lost
            })

    return compositions


def compute_composition_stats(
    composition_data: List[Dict],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """Aggregate agent composition statistics."""
    stats = []

    # Group by team
    team_comps = defaultdict(list)
    for comp in composition_data:
        team_comps[comp.get('teamId')].append(comp)

    for team_id, comps in team_comps.items():
        team_info = team_map.get(team_id, {})

        # Composition frequency
        comp_freq = defaultdict(lambda: {'count': 0, 'wins': 0, 'maps': set()})
        for c in comps:
            comp_str = c.get('composition', '')
            comp_freq[comp_str]['count'] += 1
            if c.get('mapWon', False):
                comp_freq[comp_str]['wins'] += 1
            comp_freq[comp_str]['maps'].add(c.get('mapName', ''))

        comp_frequency = {}
        for comp_str, data in comp_freq.items():
            comp_frequency[comp_str] = {
                'count': data['count'],
                'winRate': round(data['wins'] / data['count'], 3) if data['count'] > 0 else 0,
                'maps': list(data['maps'])
            }

        # Agent effectiveness
        agent_stats = defaultdict(lambda: {'games': 0, 'wins': 0, 'player': None})
        for c in comps:
            for agent in c.get('agents', []):
                agent_stats[agent]['games'] += 1
                if c.get('mapWon', False):
                    agent_stats[agent]['wins'] += 1
                # Track player
                for pid, a in c.get('playerAgents', {}).items():
                    if a == agent:
                        agent_stats[agent]['player'] = pid

        agent_effectiveness = {}
        for agent, data in agent_stats.items():
            agent_effectiveness[agent] = {
                'gamesPlayed': data['games'],
                'winRate': round(data['wins'] / data['games'], 3) if data['games'] > 0 else 0,
                'player': data['player']
            }

        # Map compositions
        map_comps = defaultdict(list)
        for c in comps:
            map_comps[c.get('mapName')].append(c)

        map_compositions = {}
        for map_name, map_comp_list in map_comps.items():
            # Most used comp
            comp_counts = defaultdict(int)
            for c in map_comp_list:
                comp_counts[c.get('composition', '')] += 1

            if comp_counts:
                preferred = max(comp_counts.keys(), key=lambda k: comp_counts[k])
                wins = sum(1 for c in map_comp_list if c.get('composition') == preferred and c.get('mapWon'))
                total = comp_counts[preferred]
                map_compositions[map_name] = {
                    'preferredComp': preferred.split('-') if preferred else [],
                    'compWinRate': round(wins / total, 3) if total > 0 else 0,
                    'gamesPlayed': len(map_comp_list)
                }

        # Flexibility score
        unique_comps = len(set(c.get('composition', '') for c in comps))
        flexibility = round(unique_comps / len(comps), 3) if comps else 0

        stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'compositionFrequency': comp_frequency,
            'agentEffectiveness': agent_effectiveness,
            'mapCompositions': map_compositions,
            'flexibilityScore': flexibility,
            'uniqueCompositions': unique_comps,
            'totalGames': len(comps)
        })

    return stats


def extract_opponent_tendencies_single_match(
    evidence: Dict,
    opponent_team_id: str
) -> Dict:
    """Extract opponent tendencies from a single match."""
    rounds = evidence.get('rounds', [])
    kills = evidence.get('kills', [])
    plants = evidence.get('plants', [])
    economy_rounds = evidence.get('economyRounds', [])
    games = evidence.get('games', [])

    if not games:
        return {}

    map_name = games[0].get('mapName', 'Unknown')
    game_id = games[0].get('gameId', '')

    # Attack patterns - analyze opponent's attack rounds
    opponent_attacks = []
    for r in rounds:
        # Determine if opponent was on attack
        winner_side = r.get('winnerSide')
        winner = r.get('winnerTeamId')

        if winner == opponent_team_id and winner_side == 'attack':
            opponent_attacks.append({'roundNumber': r.get('roundNumber'), 'won': True})
        elif winner != opponent_team_id and winner_side == 'defense':
            opponent_attacks.append({'roundNumber': r.get('roundNumber'), 'won': False})

    # Site preference from plants
    opponent_plants = [p for p in plants if p.get('planterTeamId') == opponent_team_id]
    site_counts = defaultdict(int)
    for p in opponent_plants:
        site_counts[p.get('site', 'unknown')] += 1

    total_plants = len(opponent_plants)
    site_preference = {
        site: round(count / total_plants, 3) if total_plants > 0 else 0
        for site, count in site_counts.items()
    }

    # Economy decisions
    opponent_eco = [e for e in economy_rounds if e.get('teamId') == opponent_team_id]
    force_rounds = [e.get('roundNumber') for e in opponent_eco if e.get('economyTier') in ['eco', 'half_buy']]
    save_rounds = [e.get('roundNumber') for e in opponent_eco if e.get('economyTier') == 'save']
    full_buy_rounds = [e.get('roundNumber') for e in opponent_eco if e.get('economyTier') == 'full_buy']

    # Player performance
    player_perf = defaultdict(lambda: {'kills': 0, 'deaths': 0, 'firstBloods': 0})
    for k in kills:
        if k.get('killerTeamId') == opponent_team_id:
            player_perf[k.get('killerId')]['kills'] += 1
            if k.get('isFirstBlood'):
                player_perf[k.get('killerId')]['firstBloods'] += 1
        if k.get('victimTeamId') == opponent_team_id:
            player_perf[k.get('victimId')]['deaths'] += 1

    return {
        'opponentTeamId': opponent_team_id,
        'mapName': map_name,
        'gameId': game_id,
        'seriesId': evidence.get('meta', {}).get('seriesId', ''),
        'attackStats': {
            'attackRounds': len(opponent_attacks),
            'attackWins': sum(1 for a in opponent_attacks if a['won']),
            'sitePreference': site_preference
        },
        'economyDecisions': {
            'forceBuyRounds': force_rounds,
            'saveRounds': save_rounds,
            'fullBuyRounds': full_buy_rounds,
            'forceRate': round(len(force_rounds) / len(opponent_eco), 3) if opponent_eco else 0
        },
        'playerPerformance': dict(player_perf),
        'notableRounds': []  # Can be populated with specific analysis
    }


# =============================================================================
# Sprint 4 - Task 2: Execute Pattern Recognition
# =============================================================================

def extract_execute_signature(
    round_info: Dict,
    kills: List[Dict],
    plants: List[Dict],
    ability_uses: List[Dict],
    round_team_sides: Dict
) -> Optional[Dict]:
    """
    Generate pattern signature for attack rounds.

    Identifies the execute pattern based on:
    - Site targeted
    - Execute timing (early, mid, late)
    - Utility sequence used
    - Entry method

    Returns None if not an attack round or no plant occurred.
    """
    game_id = round_info.get('gameId')
    round_num = round_info.get('roundNumber', 0)

    # Find plant for this round
    round_plants = [p for p in plants
                    if p.get('gameId') == game_id and p.get('roundNumber') == round_num]

    if not round_plants:
        return None  # No execute - no plant

    plant = round_plants[0]
    planter_team = plant.get('planterTeamId')
    site = plant.get('site', 'unknown')
    plant_time = plant.get('timestamp', '')

    # Get round kills
    round_kills = [k for k in kills
                   if k.get('gameId') == game_id and k.get('roundNumber') == round_num]

    # Get round abilities
    round_abilities = [a for a in ability_uses
                       if a.get('gameId') == game_id and a.get('roundNumber') == round_num
                       and a.get('teamId') == planter_team]

    # Calculate execute timing (time from round start to plant)
    # Classify as early (<30s), mid (30-60s), late (>60s) based on round phase
    if plant_time:
        # Simplified timing classification based on round number position
        # In reality, you'd parse timestamps, but we use heuristics here
        entry_kills = [k for k in round_kills if k.get('killerTeamId') == planter_team][:2]
        if entry_kills:
            first_kill_ts = entry_kills[0].get('timestamp', '')
            # Early execute = kill + plant quickly
            execute_timing = 'early' if len(entry_kills) >= 1 else 'mid'
        else:
            execute_timing = 'late'  # No early kills, likely slow execute
    else:
        execute_timing = 'unknown'

    # Determine entry method
    entry_method = 'unknown'
    if round_abilities:
        # Check for flash entries
        flash_abilities = [a for a in round_abilities
                          if any(f in a.get('ability', '').lower() for f in ['flash', 'paranoia', 'blindside', 'curveball', 'flashpoint'])]
        smoke_abilities = [a for a in round_abilities
                          if any(s in a.get('ability', '').lower() for s in ['smoke', 'shroud', 'viper', 'omen', 'dark cover', 'astra'])]
        util_abilities = [a for a in round_abilities
                          if any(u in a.get('ability', '').lower() for u in ['shock', 'grenade', 'boombot', 'paint shells'])]

        if flash_abilities and entry_kills:
            entry_method = 'flash_entry'
        elif smoke_abilities and entry_kills:
            entry_method = 'smoke_execute'
        elif util_abilities:
            entry_method = 'utility_clear'
        elif entry_kills:
            entry_method = 'dry_entry'
        else:
            entry_method = 'default_hit'
    elif entry_kills:
        entry_method = 'dry_entry'
    else:
        entry_method = 'slow_default'

    # Utility sequence (simplified)
    utility_sequence = []
    for ability in sorted(round_abilities, key=lambda a: a.get('timestamp', '')):
        ability_type = ability.get('ability', 'unknown')
        utility_sequence.append(ability_type)

    # Kill sequence before plant
    pre_plant_kills = len([k for k in round_kills
                           if k.get('killerTeamId') == planter_team
                           and k.get('timestamp', '') < plant_time])

    return {
        'gameId': game_id,
        'roundNumber': round_num,
        'teamId': planter_team,
        'site': site,
        'executeTiming': execute_timing,
        'entryMethod': entry_method,
        'utilityCount': len(round_abilities),
        'utilitySequence': utility_sequence[:5],  # First 5 utility pieces
        'prePlantKills': pre_plant_kills,
        'roundWon': round_info.get('winnerTeamId') == planter_team,
        'signature': f"{site}_{execute_timing}_{entry_method}"
    }


def cluster_execute_patterns(
    signatures: List[Dict]
) -> Dict:
    """
    Group similar executes by site, timing, and entry method.

    Returns:
        Dictionary with pattern clusters by team
    """
    team_patterns = defaultdict(lambda: {
        'bySite': defaultdict(list),
        'byTiming': defaultdict(list),
        'byEntry': defaultdict(list),
        'bySignature': defaultdict(list)
    })

    for sig in signatures:
        if not sig:
            continue
        team_id = sig.get('teamId', '')
        site = sig.get('site', 'unknown')
        timing = sig.get('executeTiming', 'unknown')
        entry = sig.get('entryMethod', 'unknown')
        signature = sig.get('signature', '')

        team_patterns[team_id]['bySite'][site].append(sig)
        team_patterns[team_id]['byTiming'][timing].append(sig)
        team_patterns[team_id]['byEntry'][entry].append(sig)
        team_patterns[team_id]['bySignature'][signature].append(sig)

    # Calculate statistics for each cluster
    result = {}
    for team_id, patterns in team_patterns.items():
        result[team_id] = {
            'sitePatterns': {},
            'timingPatterns': {},
            'entryPatterns': {},
            'signaturePatterns': {}
        }

        # Site patterns
        for site, sigs in patterns['bySite'].items():
            wins = sum(1 for s in sigs if s.get('roundWon', False))
            result[team_id]['sitePatterns'][site] = {
                'count': len(sigs),
                'wins': wins,
                'winRate': round(wins / len(sigs), 3) if sigs else 0,
                'avgPrePlantKills': round(sum(s.get('prePlantKills', 0) for s in sigs) / len(sigs), 2) if sigs else 0
            }

        # Timing patterns
        for timing, sigs in patterns['byTiming'].items():
            wins = sum(1 for s in sigs if s.get('roundWon', False))
            result[team_id]['timingPatterns'][timing] = {
                'count': len(sigs),
                'wins': wins,
                'winRate': round(wins / len(sigs), 3) if sigs else 0
            }

        # Entry patterns
        for entry, sigs in patterns['byEntry'].items():
            wins = sum(1 for s in sigs if s.get('roundWon', False))
            result[team_id]['entryPatterns'][entry] = {
                'count': len(sigs),
                'wins': wins,
                'winRate': round(wins / len(sigs), 3) if sigs else 0
            }

        # Full signature patterns (most specific)
        for sig_str, sigs in patterns['bySignature'].items():
            if len(sigs) >= 2:  # Only track recurring patterns
                wins = sum(1 for s in sigs if s.get('roundWon', False))
                result[team_id]['signaturePatterns'][sig_str] = {
                    'count': len(sigs),
                    'wins': wins,
                    'winRate': round(wins / len(sigs), 3) if sigs else 0,
                    'rounds': [s.get('roundNumber') for s in sigs]
                }

    return result


def compute_execute_pattern_stats(
    execute_patterns: Dict,
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Aggregate execute pattern statistics for coaching insights.
    """
    stats = []

    for team_id, patterns in execute_patterns.items():
        team_info = team_map.get(team_id, {})

        site_patterns = patterns.get('sitePatterns', {})
        timing_patterns = patterns.get('timingPatterns', {})
        entry_patterns = patterns.get('entryPatterns', {})
        signature_patterns = patterns.get('signaturePatterns', {})

        # Find most used patterns
        preferred_site = max(site_patterns.keys(), key=lambda s: site_patterns[s]['count']) if site_patterns else 'unknown'
        preferred_timing = max(timing_patterns.keys(), key=lambda t: timing_patterns[t]['count']) if timing_patterns else 'unknown'
        preferred_entry = max(entry_patterns.keys(), key=lambda e: entry_patterns[e]['count']) if entry_patterns else 'unknown'

        # Find most successful patterns (min 2 attempts)
        best_site = None
        best_site_wr = 0
        for site, data in site_patterns.items():
            if data['count'] >= 2 and data['winRate'] > best_site_wr:
                best_site = site
                best_site_wr = data['winRate']

        best_entry = None
        best_entry_wr = 0
        for entry, data in entry_patterns.items():
            if data['count'] >= 2 and data['winRate'] > best_entry_wr:
                best_entry = entry
                best_entry_wr = data['winRate']

        # Predictability score (how often they use their most common signature)
        total_rounds = sum(p['count'] for p in signature_patterns.values()) if signature_patterns else 0
        most_common_sig = max(signature_patterns.values(), key=lambda p: p['count']) if signature_patterns else {'count': 0}
        predictability = round(most_common_sig['count'] / total_rounds, 3) if total_rounds > 0 else 0

        stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'executeBreakdown': {
                'sitePreferences': site_patterns,
                'timingPreferences': timing_patterns,
                'entryMethods': entry_patterns,
                'recurringPatterns': signature_patterns
            },
            'preferredPatterns': {
                'site': preferred_site,
                'timing': preferred_timing,
                'entryMethod': preferred_entry
            },
            'mostSuccessfulPatterns': {
                'site': best_site,
                'siteWinRate': best_site_wr,
                'entryMethod': best_entry,
                'entryWinRate': best_entry_wr
            },
            'predictabilityScore': predictability,
            'coachingInsights': _generate_execute_coaching_insights(
                site_patterns, timing_patterns, entry_patterns, preferred_site, preferred_timing
            )
        })

    return stats


def _generate_execute_coaching_insights(
    site_patterns: Dict,
    timing_patterns: Dict,
    entry_patterns: Dict,
    preferred_site: str,
    preferred_timing: str
) -> List[Dict]:
    """Generate coaching insights from execute pattern analysis."""
    insights = []

    # Site focus insight
    if preferred_site and preferred_site != 'unknown':
        site_data = site_patterns.get(preferred_site, {})
        pct = site_data.get('count', 0) / sum(p.get('count', 0) for p in site_patterns.values()) if site_patterns else 0
        if pct > 0.6:
            insights.append({
                'type': 'site_predictability',
                'description': f'Heavy focus on {preferred_site} site ({pct:.0%})',
                'severity': 'medium'
            })

    # Timing insight
    early_data = timing_patterns.get('early', {})
    late_data = timing_patterns.get('late', {})
    if early_data.get('count', 0) > 0 and late_data.get('count', 0) > 0:
        if early_data.get('winRate', 0) > late_data.get('winRate', 0) + 0.2:
            insights.append({
                'type': 'timing_opportunity',
                'description': 'Early executes more successful than late',
                'severity': 'low'
            })
        elif late_data.get('winRate', 0) > early_data.get('winRate', 0) + 0.2:
            insights.append({
                'type': 'timing_opportunity',
                'description': 'Late executes more successful than early',
                'severity': 'low'
            })

    # Entry method insight
    dry_entry = entry_patterns.get('dry_entry', {})
    flash_entry = entry_patterns.get('flash_entry', {})
    if dry_entry.get('count', 0) >= 3 and dry_entry.get('winRate', 0) < 0.4:
        insights.append({
            'type': 'entry_weakness',
            'description': 'Low success rate on dry entries',
            'severity': 'high'
        })

    if flash_entry.get('count', 0) >= 2 and flash_entry.get('winRate', 0) > 0.6:
        insights.append({
            'type': 'entry_strength',
            'description': 'Flash entries highly effective',
            'severity': 'positive'
        })

    return insights


# =============================================================================
# Sprint 5: Advanced Intelligence & Coaching Automation
# =============================================================================

# =============================================================================
# Task 1: Win Probability Model
# =============================================================================

def compute_round_state(
    round_info: Dict,
    kills: List[Dict],
    economy_rounds: List[Dict],
    plants: List[Dict],
    streaks: List[Dict],
    team_map: Dict[str, Dict]
) -> Dict:
    """
    Compute comprehensive round state for win probability modeling.

    Features include:
    - Player count differential
    - Economy differential
    - Round number and side
    - Streak context
    - Spike status
    """
    game_id = round_info.get('gameId')
    round_num = round_info.get('roundNumber', 0)
    winner = round_info.get('winnerTeamId')
    winner_side = round_info.get('winnerSide', 'unknown')

    teams = list(team_map.keys())
    if len(teams) < 2:
        return {}

    team_a, team_b = teams[0], teams[1]

    # Get round kills
    round_kills = [k for k in kills
                   if k.get('gameId') == game_id and k.get('roundNumber') == round_num]

    # Economy info
    team_a_eco = next((e for e in economy_rounds
                       if e.get('gameId') == game_id and e.get('roundNumber') == round_num
                       and e.get('teamId') == team_a), {})
    team_b_eco = next((e for e in economy_rounds
                       if e.get('gameId') == game_id and e.get('roundNumber') == round_num
                       and e.get('teamId') == team_b), {})

    team_a_loadout = team_a_eco.get('loadoutValue', 0)
    team_b_loadout = team_b_eco.get('loadoutValue', 0)

    # Spike planted?
    had_plant = any(p.get('gameId') == game_id and p.get('roundNumber') == round_num
                    for p in plants)

    # Current streak context
    team_a_streak = 0
    team_b_streak = 0
    for s in streaks:
        if s.get('gameId') == game_id:
            if s.get('teamId') == team_a and s.get('streakType') == 'win':
                if s.get('startRound', 0) < round_num <= s.get('endRound', 0):
                    team_a_streak = round_num - s.get('startRound', 0)
            elif s.get('teamId') == team_b and s.get('streakType') == 'win':
                if s.get('startRound', 0) < round_num <= s.get('endRound', 0):
                    team_b_streak = round_num - s.get('startRound', 0)

    # Score at start of round
    prior_rounds = [r for r in round_kills if r.get('roundNumber', 0) < round_num]
    # Simplified - count prior wins
    team_a_score = len([r for r in prior_rounds if r.get('winnerTeamId') == team_a]) if prior_rounds else 0
    team_b_score = len([r for r in prior_rounds if r.get('winnerTeamId') == team_b]) if prior_rounds else 0

    return {
        'gameId': game_id,
        'roundNumber': round_num,
        'winnerTeamId': winner,
        'winnerSide': winner_side,
        'teams': {
            team_a: {
                'loadoutValue': team_a_loadout,
                'economyTier': team_a_eco.get('economyTier', 'unknown'),
                'currentStreak': team_a_streak,
                'score': team_a_score
            },
            team_b: {
                'loadoutValue': team_b_loadout,
                'economyTier': team_b_eco.get('economyTier', 'unknown'),
                'currentStreak': team_b_streak,
                'score': team_b_score
            }
        },
        'features': {
            'roundNumber': round_num,
            'scoreDiff': team_a_score - team_b_score,
            'economyDiff': team_a_loadout - team_b_loadout,
            'streakDiff': team_a_streak - team_b_streak,
            'hadPlant': had_plant,
            'isHalf': round_num in [12, 13],
            'isOT': round_num > 24
        }
    }


def compute_win_probability_factors(
    round_states: List[Dict],
    team_map: Dict[str, Dict]
) -> Dict:
    """
    Compute win probability factors based on historical round states.

    Returns coefficients for win probability model:
    - Economy advantage impact
    - Streak momentum impact
    - Score differential impact
    - Plant conversion rates
    """
    if not round_states:
        return {}

    teams = list(team_map.keys())
    if len(teams) < 2:
        return {}

    team_a = teams[0]

    # Analyze economy impact
    eco_wins = {'advantage': 0, 'disadvantage': 0, 'even': 0}
    eco_totals = {'advantage': 0, 'disadvantage': 0, 'even': 0}

    # Streak impact
    streak_wins = {'positive': 0, 'negative': 0, 'neutral': 0}
    streak_totals = {'positive': 0, 'negative': 0, 'neutral': 0}

    for state in round_states:
        features = state.get('features', {})
        winner = state.get('winnerTeamId')
        team_a_won = (winner == team_a)

        # Economy categorization
        eco_diff = features.get('economyDiff', 0)
        if eco_diff > 5000:
            eco_totals['advantage'] += 1
            if team_a_won:
                eco_wins['advantage'] += 1
        elif eco_diff < -5000:
            eco_totals['disadvantage'] += 1
            if team_a_won:
                eco_wins['disadvantage'] += 1
        else:
            eco_totals['even'] += 1
            if team_a_won:
                eco_wins['even'] += 1

        # Streak categorization
        streak_diff = features.get('streakDiff', 0)
        if streak_diff > 0:
            streak_totals['positive'] += 1
            if team_a_won:
                streak_wins['positive'] += 1
        elif streak_diff < 0:
            streak_totals['negative'] += 1
            if team_a_won:
                streak_wins['negative'] += 1
        else:
            streak_totals['neutral'] += 1
            if team_a_won:
                streak_wins['neutral'] += 1

    return {
        'economyImpact': {
            'advantageWinRate': round(eco_wins['advantage'] / eco_totals['advantage'], 3) if eco_totals['advantage'] > 0 else 0,
            'disadvantageWinRate': round(eco_wins['disadvantage'] / eco_totals['disadvantage'], 3) if eco_totals['disadvantage'] > 0 else 0,
            'evenWinRate': round(eco_wins['even'] / eco_totals['even'], 3) if eco_totals['even'] > 0 else 0,
            'samples': eco_totals
        },
        'streakImpact': {
            'positiveStreakWinRate': round(streak_wins['positive'] / streak_totals['positive'], 3) if streak_totals['positive'] > 0 else 0,
            'negativeStreakWinRate': round(streak_wins['negative'] / streak_totals['negative'], 3) if streak_totals['negative'] > 0 else 0,
            'neutralWinRate': round(streak_wins['neutral'] / streak_totals['neutral'], 3) if streak_totals['neutral'] > 0 else 0,
            'samples': streak_totals
        }
    }


def estimate_round_win_probability(
    round_state: Dict,
    probability_factors: Dict,
    team_id: str
) -> Dict:
    """
    Estimate win probability for a specific round state.

    Uses computed factors to estimate probability based on:
    - Economy state
    - Streak momentum
    - Historical conversion rates
    """
    features = round_state.get('features', {})
    team_data = round_state.get('teams', {}).get(team_id, {})

    # Base probability 0.5
    base_prob = 0.5

    # Economy adjustment
    eco_impact = probability_factors.get('economyImpact', {})
    eco_diff = features.get('economyDiff', 0)

    if eco_diff > 5000:
        eco_adj = eco_impact.get('advantageWinRate', 0.6) - 0.5
    elif eco_diff < -5000:
        eco_adj = eco_impact.get('disadvantageWinRate', 0.4) - 0.5
    else:
        eco_adj = 0

    # Streak adjustment
    streak_impact = probability_factors.get('streakImpact', {})
    streak_diff = features.get('streakDiff', 0)

    if streak_diff > 0:
        streak_adj = (streak_impact.get('positiveStreakWinRate', 0.55) - 0.5) * 0.5
    elif streak_diff < 0:
        streak_adj = (streak_impact.get('negativeStreakWinRate', 0.45) - 0.5) * 0.5
    else:
        streak_adj = 0

    # Final probability
    final_prob = min(0.95, max(0.05, base_prob + eco_adj + streak_adj))

    return {
        'teamId': team_id,
        'roundNumber': round_state.get('roundNumber'),
        'winProbability': round(final_prob, 3),
        'factors': {
            'baseProbability': base_prob,
            'economyAdjustment': round(eco_adj, 3),
            'streakAdjustment': round(streak_adj, 3)
        },
        'confidence': 'high' if abs(final_prob - 0.5) > 0.2 else 'medium' if abs(final_prob - 0.5) > 0.1 else 'low'
    }


def compute_win_probability_stats(
    round_states: List[Dict],
    probability_factors: Dict,
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute win probability statistics for coaching insights.
    """
    stats = []

    for team_id, team_info in team_map.items():
        team_probs = []
        correct_predictions = 0
        total_predictions = 0

        for state in round_states:
            prob = estimate_round_win_probability(state, probability_factors, team_id)
            team_probs.append(prob)

            # Check accuracy
            winner = state.get('winnerTeamId')
            predicted_win = prob.get('winProbability', 0.5) > 0.5
            actual_win = (winner == team_id)

            if predicted_win == actual_win:
                correct_predictions += 1
            total_predictions += 1

        # Identify swing rounds (probability < 0.5 but won, or > 0.5 but lost)
        swing_rounds = []
        for i, state in enumerate(round_states):
            prob = team_probs[i] if i < len(team_probs) else {'winProbability': 0.5}
            winner = state.get('winnerTeamId')
            prob_val = prob.get('winProbability', 0.5)

            if (prob_val < 0.4 and winner == team_id) or (prob_val > 0.6 and winner != team_id):
                swing_rounds.append({
                    'roundNumber': state.get('roundNumber'),
                    'probability': prob_val,
                    'won': winner == team_id,
                    'impact': 'positive' if winner == team_id else 'negative'
                })

        stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'modelAccuracy': round(correct_predictions / total_predictions, 3) if total_predictions > 0 else 0,
            'probabilityFactors': probability_factors,
            'swingRounds': swing_rounds[:5],  # Top 5 swing rounds
            'avgWinProbability': round(sum(p.get('winProbability', 0.5) for p in team_probs) / len(team_probs), 3) if team_probs else 0.5
        })

    return stats


# =============================================================================
# Task 2: What-If Scenario Engine
# =============================================================================

def generate_what_if_scenario(
    round_state: Dict,
    modification: Dict
) -> Dict:
    """
    Generate a what-if scenario by modifying round state.

    Modifications can include:
    - economy_change: Adjust team economy
    - player_alive: Add/remove alive players
    - spike_status: Change spike plant status
    """
    modified_state = round_state.copy()
    features = modified_state.get('features', {}).copy()

    mod_type = modification.get('type')
    mod_value = modification.get('value')

    if mod_type == 'economy_change':
        features['economyDiff'] = features.get('economyDiff', 0) + mod_value
    elif mod_type == 'streak_change':
        features['streakDiff'] = features.get('streakDiff', 0) + mod_value
    elif mod_type == 'score_change':
        features['scoreDiff'] = features.get('scoreDiff', 0) + mod_value
    elif mod_type == 'spike_planted':
        features['hadPlant'] = mod_value

    modified_state['features'] = features
    modified_state['isWhatIf'] = True
    modified_state['modification'] = modification

    return modified_state


def evaluate_what_if_impact(
    original_state: Dict,
    modified_state: Dict,
    probability_factors: Dict,
    team_id: str
) -> Dict:
    """
    Evaluate the impact of a what-if scenario.
    """
    original_prob = estimate_round_win_probability(original_state, probability_factors, team_id)
    modified_prob = estimate_round_win_probability(modified_state, probability_factors, team_id)

    prob_change = modified_prob.get('winProbability', 0.5) - original_prob.get('winProbability', 0.5)

    return {
        'originalProbability': original_prob.get('winProbability'),
        'modifiedProbability': modified_prob.get('winProbability'),
        'probabilityChange': round(prob_change, 3),
        'modification': modified_state.get('modification'),
        'impactLevel': 'high' if abs(prob_change) > 0.15 else 'medium' if abs(prob_change) > 0.05 else 'low'
    }


def compute_scenario_analysis(
    round_states: List[Dict],
    probability_factors: Dict,
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute scenario analysis for key decision points.

    Identifies rounds where different decisions could have swung outcome.
    """
    analyses = []

    for team_id, team_info in team_map.items():
        team_scenarios = []

        for state in round_states:
            # Only analyze close rounds or lost rounds
            features = state.get('features', {})
            winner = state.get('winnerTeamId')

            if winner != team_id or features.get('economyDiff', 0) < -3000:
                # Generate scenarios
                scenarios = [
                    {'type': 'economy_change', 'value': 5000, 'description': '+5000 economy'},
                    {'type': 'streak_change', 'value': 2, 'description': 'On 2-win streak'},
                    {'type': 'spike_planted', 'value': True, 'description': 'Spike planted'},
                ]

                round_scenarios = []
                for scenario in scenarios:
                    modified = generate_what_if_scenario(state, scenario)
                    impact = evaluate_what_if_impact(state, modified, probability_factors, team_id)
                    if impact.get('impactLevel') in ['high', 'medium']:
                        round_scenarios.append({
                            'scenario': scenario.get('description'),
                            'impact': impact
                        })

                if round_scenarios:
                    team_scenarios.append({
                        'roundNumber': state.get('roundNumber'),
                        'gameId': state.get('gameId'),
                        'actualOutcome': 'win' if winner == team_id else 'loss',
                        'scenarios': round_scenarios
                    })

        analyses.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'scenarioCount': len(team_scenarios),
            'keyScenarios': team_scenarios[:10]  # Top 10 scenarios
        })

    return analyses


# =============================================================================
# Task 3: Automated Coaching Recommendations Engine
# =============================================================================

def analyze_team_weaknesses(
    evidence: Dict,
    team_id: str
) -> List[Dict]:
    """
    Analyze team weaknesses from evidence data.

    Returns prioritized list of areas for improvement.
    """
    weaknesses = []
    derived = evidence.get('derived', {})

    # Analyze first blood conversion
    fb_stats = derived.get('firstBloodStats', [])
    team_fb = next((s for s in fb_stats if s.get('teamId') == team_id), {})
    if team_fb.get('conversionRate', 0) < 0.6:
        weaknesses.append({
            'area': 'first_blood_conversion',
            'severity': 'high' if team_fb.get('conversionRate', 0) < 0.5 else 'medium',
            'description': f"First blood conversion rate is {team_fb.get('conversionRate', 0):.1%}",
            'recommendation': 'Focus on trade kills and coordinated follow-up after first blood'
        })

    # Analyze clutch performance
    clutch_stats = derived.get('clutchStats', [])
    team_clutches = [c for c in clutch_stats if c.get('teamId') == team_id]
    total_attempts = sum(c.get('clutchAttempts', 0) for c in team_clutches)
    total_wins = sum(c.get('clutchWins', 0) for c in team_clutches)
    if total_attempts > 5 and total_wins / total_attempts < 0.3:
        weaknesses.append({
            'area': 'clutch_situations',
            'severity': 'medium',
            'description': f"Clutch win rate is {total_wins/total_attempts:.1%} ({total_wins}/{total_attempts})",
            'recommendation': 'Practice 1vX scenarios and improve decision-making in clutches'
        })

    # Analyze economy management
    eco_stats = derived.get('economyStats', [])
    team_eco = next((s for s in eco_stats if s.get('teamId') == team_id), {})
    if team_eco.get('ecoRoundWinRate', 0) < 0.15:
        weaknesses.append({
            'area': 'eco_rounds',
            'severity': 'low',
            'description': 'Low eco round win rate',
            'recommendation': 'Improve eco round strategies with coordinated utility usage'
        })

    # Analyze streak patterns
    streak_stats = derived.get('streakStats', [])
    team_streaks = next((s for s in streak_stats if s.get('teamId') == team_id), {})
    if team_streaks.get('resilienceScore', 0) < 0.4:
        weaknesses.append({
            'area': 'resilience',
            'severity': 'high',
            'description': 'Poor recovery from loss streaks',
            'recommendation': 'Develop mental reset protocols and timeout strategies'
        })

    # Sort by severity
    severity_order = {'high': 0, 'medium': 1, 'low': 2}
    weaknesses.sort(key=lambda w: severity_order.get(w.get('severity', 'low'), 3))

    return weaknesses


def analyze_team_strengths(
    evidence: Dict,
    team_id: str
) -> List[Dict]:
    """
    Analyze team strengths from evidence data.

    Returns prioritized list of team advantages.
    """
    strengths = []
    derived = evidence.get('derived', {})

    # Analyze first blood
    fb_stats = derived.get('firstBloodStats', [])
    team_fb = next((s for s in fb_stats if s.get('teamId') == team_id), {})
    if team_fb.get('conversionRate', 0) > 0.75:
        strengths.append({
            'area': 'first_blood_conversion',
            'level': 'elite',
            'description': f"Elite first blood conversion at {team_fb.get('conversionRate', 0):.1%}",
            'leverage': 'Continue aggressive opening strategies'
        })

    # Analyze post-plant
    plant_stats = derived.get('plantStats', [])
    team_plant = next((s for s in plant_stats if s.get('teamId') == team_id), {})
    if team_plant.get('postPlantWinRate', 0) > 0.7:
        strengths.append({
            'area': 'post_plant',
            'level': 'strong',
            'description': f"Strong post-plant at {team_plant.get('postPlantWinRate', 0):.1%}",
            'leverage': 'Prioritize getting plants in close rounds'
        })

    # Analyze execute patterns
    exec_stats = derived.get('executePatternStats', [])
    team_exec = next((s for s in exec_stats if s.get('teamId') == team_id), {})
    best_entry = team_exec.get('mostSuccessfulPatterns', {}).get('entryWinRate', 0)
    if best_entry > 0.65:
        strengths.append({
            'area': 'executes',
            'level': 'strong',
            'description': f"Effective execute patterns ({best_entry:.1%} win rate on best entry)",
            'leverage': 'Lean into successful execute timing and entry methods'
        })

    return strengths


def generate_coaching_recommendations(
    weaknesses: List[Dict],
    strengths: List[Dict],
    match_context: Dict
) -> List[Dict]:
    """
    Generate prioritized coaching recommendations.

    Combines weakness analysis with strengths to create actionable advice.
    """
    recommendations = []

    # High priority: Address critical weaknesses
    for weakness in weaknesses:
        if weakness.get('severity') == 'high':
            recommendations.append({
                'priority': 'critical',
                'type': 'improvement',
                'area': weakness.get('area'),
                'title': f"Address {weakness.get('area', '').replace('_', ' ').title()}",
                'details': weakness.get('description'),
                'action': weakness.get('recommendation'),
                'expectedImpact': 'High - directly addresses losing rounds'
            })

    # Medium priority: Leverage strengths
    for strength in strengths:
        if strength.get('level') == 'elite':
            recommendations.append({
                'priority': 'high',
                'type': 'leverage',
                'area': strength.get('area'),
                'title': f"Leverage {strength.get('area', '').replace('_', ' ').title()}",
                'details': strength.get('description'),
                'action': strength.get('leverage'),
                'expectedImpact': 'High - maximizes existing advantage'
            })

    # Lower priority: Medium weaknesses
    for weakness in weaknesses:
        if weakness.get('severity') == 'medium':
            recommendations.append({
                'priority': 'medium',
                'type': 'improvement',
                'area': weakness.get('area'),
                'title': f"Improve {weakness.get('area', '').replace('_', ' ').title()}",
                'details': weakness.get('description'),
                'action': weakness.get('recommendation'),
                'expectedImpact': 'Medium - incremental improvement'
            })

    return recommendations


def compute_coaching_recommendation_stats(
    evidence: Dict,
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute coaching recommendations for each team.
    """
    stats = []

    for team_id, team_info in team_map.items():
        weaknesses = analyze_team_weaknesses(evidence, team_id)
        strengths = analyze_team_strengths(evidence, team_id)

        match_context = {
            'seriesId': evidence.get('meta', {}).get('seriesId'),
            'gamesPlayed': len(evidence.get('games', []))
        }

        recommendations = generate_coaching_recommendations(weaknesses, strengths, match_context)

        stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'weaknessCount': len(weaknesses),
            'strengthCount': len(strengths),
            'weaknesses': weaknesses,
            'strengths': strengths,
            'recommendations': recommendations,
            'topPriority': recommendations[0] if recommendations else None
        })

    return stats


# =============================================================================
# Task 4: Scouting Report Generator
# =============================================================================

def generate_team_scouting_profile(
    evidence: Dict,
    team_id: str,
    team_map: Dict[str, Dict],
    player_map: Dict[str, str]
) -> Dict:
    """
    Generate comprehensive scouting profile for a team.

    Includes:
    - Playstyle tendencies
    - Key players
    - Site preferences
    - Economy patterns
    - Predictable behaviors
    """
    derived = evidence.get('derived', {})
    team_info = team_map.get(team_id, {})

    # Playstyle analysis
    tempo_stats = derived.get('tempoStats', [])
    team_tempo = next((t for t in tempo_stats if t.get('teamId') == team_id), {})

    exec_stats = derived.get('executePatternStats', [])
    team_exec = next((e for e in exec_stats if e.get('teamId') == team_id), {})

    playstyle = 'balanced'
    if team_tempo.get('avgRoundDuration', 0) < 40:
        playstyle = 'aggressive'
    elif team_tempo.get('avgRoundDuration', 0) > 70:
        playstyle = 'methodical'

    # Key players
    kill_stats = derived.get('openingDuelStats', [])
    top_fraggers = sorted(
        [k for k in kill_stats if any(
            p.get('teamId') == team_id for p in evidence.get('players', [])
            if p.get('playerId') == k.get('playerId')
        )],
        key=lambda x: x.get('wins', 0) + x.get('losses', 0),
        reverse=True
    )[:3]

    # Site preferences
    site_stats = derived.get('siteStats', [])
    team_sites = [s for s in site_stats if s.get('teamId') == team_id]
    site_prefs = {}
    for site_stat in team_sites:
        for site, data in site_stat.get('attackStats', {}).items():
            if site not in site_prefs:
                site_prefs[site] = {'plants': 0, 'wins': 0}
            site_prefs[site]['plants'] += data.get('plants', 0)
            site_prefs[site]['wins'] += data.get('postPlantWins', 0)

    # Predictability
    predictability = team_exec.get('predictabilityScore', 0)

    return {
        'teamId': team_id,
        'teamName': team_info.get('name', 'Unknown'),
        'playstyle': {
            'primary': playstyle,
            'avgRoundDuration': team_tempo.get('avgRoundDuration', 0),
            'preferredTiming': team_exec.get('preferredPatterns', {}).get('timing', 'mid')
        },
        'keyPlayers': [
            {
                'playerId': p.get('playerId'),
                'playerName': player_map.get(p.get('playerId'), 'Unknown'),
                'role': 'entry' if p.get('wins', 0) > p.get('losses', 0) else 'support'
            }
            for p in top_fraggers
        ],
        'sitePreferences': site_prefs,
        'predictability': {
            'score': predictability,
            'level': 'high' if predictability > 0.4 else 'medium' if predictability > 0.2 else 'low',
            'exploitable': predictability > 0.4
        },
        'economyTendencies': {
            'forceRate': next(
                (e.get('forceRate', 0) for e in derived.get('economyStats', []) if e.get('teamId') == team_id),
                0
            )
        }
    }


def generate_counter_strategies(
    scouting_profile: Dict
) -> List[Dict]:
    """
    Generate counter-strategies based on scouting profile.
    """
    strategies = []

    # Counter playstyle
    playstyle = scouting_profile.get('playstyle', {}).get('primary', 'balanced')
    if playstyle == 'aggressive':
        strategies.append({
            'target': 'playstyle',
            'strategy': 'Slow play and bait rushes',
            'details': 'Hold utility for retakes, avoid committing early',
            'priority': 'high'
        })
    elif playstyle == 'methodical':
        strategies.append({
            'target': 'playstyle',
            'strategy': 'Apply early pressure',
            'details': 'Force fights before they can set up defaults',
            'priority': 'high'
        })

    # Counter site preferences
    site_prefs = scouting_profile.get('sitePreferences', {})
    most_targeted = max(site_prefs.keys(), key=lambda s: site_prefs[s].get('plants', 0)) if site_prefs else None
    if most_targeted:
        strategies.append({
            'target': 'sites',
            'strategy': f'Stack {most_targeted} site',
            'details': f'Heavy preference for {most_targeted} - add extra utility and players',
            'priority': 'medium'
        })

    # Counter predictability
    pred = scouting_profile.get('predictability', {})
    if pred.get('exploitable'):
        strategies.append({
            'target': 'patterns',
            'strategy': 'Exploit predictable patterns',
            'details': 'Pre-position based on expected executes',
            'priority': 'high'
        })

    return strategies


def compute_scouting_report_stats(
    evidence: Dict,
    team_map: Dict[str, Dict],
    player_map: Dict[str, str]
) -> List[Dict]:
    """
    Generate scouting reports for all teams.
    """
    reports = []

    for team_id, team_info in team_map.items():
        profile = generate_team_scouting_profile(evidence, team_id, team_map, player_map)
        counters = generate_counter_strategies(profile)

        reports.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'profile': profile,
            'counterStrategies': counters,
            'keyTakeaways': [
                f"Playstyle: {profile.get('playstyle', {}).get('primary', 'unknown')}",
                f"Predictability: {profile.get('predictability', {}).get('level', 'unknown')}",
                f"Key entry: {profile.get('keyPlayers', [{}])[0].get('playerName', 'unknown') if profile.get('keyPlayers') else 'unknown'}"
            ]
        })

    return reports


# =============================================================================
# Task 5: Performance Benchmarking System
# =============================================================================

# Pro team benchmark data (simplified representation)
PRO_BENCHMARKS = {
    'firstBloodConversion': {'elite': 0.75, 'good': 0.65, 'average': 0.55},
    'clutchRate': {'elite': 0.35, 'good': 0.25, 'average': 0.20},
    'postPlantWinRate': {'elite': 0.70, 'good': 0.60, 'average': 0.50},
    'headshotRate': {'elite': 0.30, 'good': 0.25, 'average': 0.20},
    'tradeRate': {'elite': 0.75, 'good': 0.65, 'average': 0.50},
    'ecoWinRate': {'elite': 0.25, 'good': 0.18, 'average': 0.12}
}


def compute_performance_benchmark(
    stat_name: str,
    stat_value: float
) -> Dict:
    """
    Benchmark a stat against pro-level performance.
    """
    benchmarks = PRO_BENCHMARKS.get(stat_name, {})

    if not benchmarks:
        return {'percentile': 50, 'tier': 'unknown'}

    elite_threshold = benchmarks.get('elite', 1.0)
    good_threshold = benchmarks.get('good', 0.7)
    average_threshold = benchmarks.get('average', 0.5)

    if stat_value >= elite_threshold:
        tier = 'elite'
        percentile = 90 + min(10, (stat_value - elite_threshold) / 0.1 * 10)
    elif stat_value >= good_threshold:
        tier = 'above_average'
        percentile = 70 + (stat_value - good_threshold) / (elite_threshold - good_threshold) * 20
    elif stat_value >= average_threshold:
        tier = 'average'
        percentile = 40 + (stat_value - average_threshold) / (good_threshold - average_threshold) * 30
    else:
        tier = 'below_average'
        percentile = max(5, stat_value / average_threshold * 40)

    return {
        'value': round(stat_value, 3),
        'percentile': round(percentile, 1),
        'tier': tier,
        'benchmarks': benchmarks
    }


def compute_team_benchmarks(
    evidence: Dict,
    team_id: str
) -> Dict:
    """
    Compute comprehensive benchmarks for a team.
    """
    derived = evidence.get('derived', {})

    benchmarks = {}

    # First blood conversion
    fb_stats = derived.get('firstBloodStats', [])
    team_fb = next((s for s in fb_stats if s.get('teamId') == team_id), {})
    if team_fb:
        benchmarks['firstBloodConversion'] = compute_performance_benchmark(
            'firstBloodConversion', team_fb.get('conversionRate', 0)
        )

    # Post-plant win rate
    plant_stats = derived.get('plantStats', [])
    team_plant = next((s for s in plant_stats if s.get('teamId') == team_id), {})
    if team_plant:
        benchmarks['postPlantWinRate'] = compute_performance_benchmark(
            'postPlantWinRate', team_plant.get('postPlantWinRate', 0)
        )

    # Trade rate
    trade_stats = derived.get('tradeStats', [])
    team_trades = next((s for s in trade_stats if s.get('teamId') == team_id), {})
    if team_trades:
        total = team_trades.get('totalDeaths', 0)
        traded = team_trades.get('tradedDeaths', 0)
        trade_rate = traded / total if total > 0 else 0
        benchmarks['tradeRate'] = compute_performance_benchmark('tradeRate', trade_rate)

    # Overall rating
    percentiles = [b.get('percentile', 50) for b in benchmarks.values()]
    overall_percentile = sum(percentiles) / len(percentiles) if percentiles else 50

    return {
        'metrics': benchmarks,
        'overallPercentile': round(overall_percentile, 1),
        'overallTier': 'elite' if overall_percentile >= 85 else 'above_average' if overall_percentile >= 65 else 'average' if overall_percentile >= 45 else 'below_average'
    }


def compute_player_benchmarks(
    evidence: Dict,
    player_id: str,
    player_map: Dict[str, str]
) -> Dict:
    """
    Compute benchmarks for an individual player.
    """
    derived = evidence.get('derived', {})
    kills = evidence.get('kills', [])

    # Calculate player stats
    player_kills = [k for k in kills if k.get('killerId') == player_id]
    player_deaths = [k for k in kills if k.get('victimId') == player_id]

    total_kills = len(player_kills)
    headshot_kills = len([k for k in player_kills if k.get('isHeadshot', False)])
    hs_rate = headshot_kills / total_kills if total_kills > 0 else 0

    benchmarks = {
        'headshotRate': compute_performance_benchmark('headshotRate', hs_rate)
    }

    # Clutch performance
    clutch_stats = derived.get('clutchStats', [])
    player_clutch = next((c for c in clutch_stats if c.get('playerId') == player_id), {})
    if player_clutch:
        benchmarks['clutchRate'] = compute_performance_benchmark(
            'clutchRate', player_clutch.get('clutchRate', 0)
        )

    percentiles = [b.get('percentile', 50) for b in benchmarks.values()]
    overall = sum(percentiles) / len(percentiles) if percentiles else 50

    return {
        'playerId': player_id,
        'playerName': player_map.get(player_id, 'Unknown'),
        'metrics': benchmarks,
        'overallPercentile': round(overall, 1)
    }


def compute_benchmark_stats(
    evidence: Dict,
    team_map: Dict[str, Dict],
    player_map: Dict[str, str]
) -> List[Dict]:
    """
    Compute comprehensive benchmark statistics.
    """
    stats = []

    for team_id, team_info in team_map.items():
        team_benchmarks = compute_team_benchmarks(evidence, team_id)

        # Get team players
        team_players = [
            p for p in evidence.get('players', [])
            if p.get('teamId') == team_id
        ]

        player_benchmarks = [
            compute_player_benchmarks(evidence, p.get('playerId'), player_map)
            for p in team_players[:5]  # Top 5 players
        ]

        stats.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'teamBenchmarks': team_benchmarks,
            'playerBenchmarks': player_benchmarks,
            'areasAboveAverage': [
                k for k, v in team_benchmarks.get('metrics', {}).items()
                if v.get('tier') in ['elite', 'above_average']
            ],
            'areasForImprovement': [
                k for k, v in team_benchmarks.get('metrics', {}).items()
                if v.get('tier') == 'below_average'
            ]
        })

    return stats


# =============================================================================
# Task 6: Coaching Report Composer
# =============================================================================

def compose_executive_summary(
    evidence: Dict,
    team_id: str,
    team_map: Dict[str, Dict]
) -> Dict:
    """
    Compose executive summary for coaching report.
    """
    team_info = team_map.get(team_id, {})
    games = evidence.get('games', [])
    rounds = evidence.get('rounds', [])

    # Calculate win/loss
    team_rounds_won = len([r for r in rounds if r.get('winnerTeamId') == team_id])
    total_rounds = len(rounds)

    # Determine series outcome
    games_won = 0
    games_lost = 0
    for game in games:
        game_id = game.get('gameId')
        game_rounds = [r for r in rounds if r.get('gameId') == game_id]
        team_game_rounds = len([r for r in game_rounds if r.get('winnerTeamId') == team_id])
        if team_game_rounds > len(game_rounds) / 2:
            games_won += 1
        else:
            games_lost += 1

    return {
        'teamName': team_info.get('name', 'Unknown'),
        'seriesResult': f"{games_won}-{games_lost}",
        'roundRecord': f"{team_rounds_won}-{total_rounds - team_rounds_won}",
        'roundWinRate': round(team_rounds_won / total_rounds, 3) if total_rounds > 0 else 0,
        'mapsPlayed': len(games),
        'outcome': 'win' if games_won > games_lost else 'loss'
    }


def compose_key_moments(
    evidence: Dict,
    team_id: str
) -> List[Dict]:
    """
    Identify and compose key moments from the match.
    """
    derived = evidence.get('derived', {})
    moments = []

    # Critical rounds
    critical = derived.get('criticalRounds', [])
    for cr in critical:
        top_rounds = cr.get('topReviewRounds', [])[:3]
        for tr in top_rounds:
            moments.append({
                'type': 'critical_round',
                'roundNumber': tr.get('roundNumber'),
                'reason': tr.get('reason'),
                'coachingFocus': tr.get('coachingFocus')
            })

    # Swing rounds from win probability
    wp_stats = derived.get('winProbabilityStats', [])
    team_wp = next((w for w in wp_stats if w.get('teamId') == team_id), {})
    for swing in team_wp.get('swingRounds', [])[:3]:
        moments.append({
            'type': 'swing_round',
            'roundNumber': swing.get('roundNumber'),
            'probability': swing.get('probability'),
            'impact': swing.get('impact')
        })

    return moments[:10]


def compose_action_items(
    recommendations: List[Dict],
    benchmarks: Dict
) -> List[Dict]:
    """
    Compose actionable items for the coaching staff.
    """
    actions = []

    # From recommendations
    for rec in recommendations[:5]:
        actions.append({
            'priority': rec.get('priority'),
            'action': rec.get('action'),
            'area': rec.get('area'),
            'expectedImpact': rec.get('expectedImpact')
        })

    # From benchmark gaps
    for area in benchmarks.get('areasForImprovement', [])[:2]:
        actions.append({
            'priority': 'medium',
            'action': f"Review and improve {area.replace('_', ' ')}",
            'area': area,
            'expectedImpact': 'Benchmark improvement'
        })

    return actions


def compose_coaching_report(
    evidence: Dict,
    team_map: Dict[str, Dict],
    player_map: Dict[str, str]
) -> List[Dict]:
    """
    Compose comprehensive coaching reports for all teams.
    """
    reports = []

    for team_id, team_info in team_map.items():
        # Gather all components
        summary = compose_executive_summary(evidence, team_id, team_map)
        key_moments = compose_key_moments(evidence, team_id)

        # Get recommendations
        rec_stats = compute_coaching_recommendation_stats(evidence, team_map)
        team_recs = next((r for r in rec_stats if r.get('teamId') == team_id), {})
        recommendations = team_recs.get('recommendations', [])

        # Get benchmarks
        bench_stats = compute_benchmark_stats(evidence, team_map, player_map)
        team_bench = next((b for b in bench_stats if b.get('teamId') == team_id), {})

        actions = compose_action_items(recommendations, team_bench)

        # Get scouting data for opponent
        opponent_id = next((t for t in team_map.keys() if t != team_id), None)
        opponent_scouting = None
        if opponent_id:
            scout_stats = compute_scouting_report_stats(evidence, team_map, player_map)
            opponent_scouting = next((s for s in scout_stats if s.get('teamId') == opponent_id), None)

        reports.append({
            'teamId': team_id,
            'teamName': team_info.get('name', 'Unknown'),
            'reportVersion': '5.0',
            'sections': {
                'executiveSummary': summary,
                'keyMoments': key_moments,
                'strengthsAndWeaknesses': {
                    'strengths': team_recs.get('strengths', []),
                    'weaknesses': team_recs.get('weaknesses', [])
                },
                'benchmarks': team_bench.get('teamBenchmarks', {}),
                'playerPerformance': team_bench.get('playerBenchmarks', []),
                'opponentScouting': opponent_scouting,
                'actionItems': actions
            },
            'generatedAt': None  # Set at runtime
        })

    return reports


def generate_summary_markdown(evidence: Dict, output_path: Path):
    """
    Generate human-readable summary markdown file.

    Args:
        evidence: Evidence dictionary
        output_path: Path to write summary.md
    """
    lines = []
    lines.append(f"# Evidence Summary: {evidence['meta']['seriesId']}")
    lines.append("")
    lines.append(f"**Version:** {evidence['meta']['version']}")
    lines.append(f"**Isolation Threshold:** {evidence['meta']['isoThreshold']}")
    lines.append("")

    # Maps
    lines.append("## Maps")
    lines.append("")
    for game in evidence["games"]:
        lines.append(f"- Game {game['sequenceNumber']}: **{game['mapName']}**")
    lines.append("")

    # Rounds per map
    lines.append("## Rounds per Map")
    lines.append("")
    game_round_counts = defaultdict(int)
    for round_data in evidence["rounds"]:
        game_round_counts[round_data["gameId"]] += 1

    for game in evidence["games"]:
        count = game_round_counts[game["gameId"]]
        lines.append(f"- **{game['mapName']}**: {count} rounds")
    lines.append("")

    # First blood stats
    lines.append("## First Blood Stats")
    lines.append("")
    for fb_stat in evidence["derived"]["firstBloodStats"]:
        lines.append(f"- **{fb_stat['teamName']}**: {fb_stat['firstBloods']} first bloods, "
                     f"{fb_stat['roundsWon']} round wins ({fb_stat['conversionRate']:.1%} conversion)")
    lines.append("")

    # Plant stats
    lines.append("## Plant Stats")
    lines.append("")
    for plant_stat in evidence["derived"]["plantStats"]:
        lines.append(f"- **{plant_stat['teamName']}**: {plant_stat['plants']} plants, "
                     f"{plant_stat['postPlantWins']} post-plant wins ({plant_stat['postPlantWinRate']:.1%} win rate)")
    lines.append("")

    # Isolated deaths
    lines.append("## Isolated Deaths (Top 5 Players)")
    lines.append("")
    sorted_players = sorted(evidence["players"], key=lambda p: p["isolatedDeathsCount"], reverse=True)
    for i, player in enumerate(sorted_players[:5], 1):
        lines.append(f"{i}. Player {player['playerId']}: {player['isolatedDeathsCount']} isolated deaths "
                     f"(Team {player['teamId']})")
    lines.append("")

    # Write summary
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))


def main():
    parser = argparse.ArgumentParser(
        description="Extract evidence_v1.json from GRID series events",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Extract from series directory
  python scripts/py/extract_evidence_v1.py --series-dir "E:\\grid-cache\\hot\\2024\\tournaments\\757073\\series\\2629390"

  # Quick test with max lines
  python scripts/py/extract_evidence_v1.py --series-dir "<PATH>" --max-lines 50000

  # Custom output directory
  python scripts/py/extract_evidence_v1.py --series-dir "<PATH>" --out-dir my_output
"""
    )

    parser.add_argument(
        "--series-dir",
        type=str,
        required=True,
        help="Path to series directory (contains events.jsonl)"
    )

    parser.add_argument(
        "--events",
        type=str,
        help="Path to events file (default: events.jsonl in series-dir)"
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
        help="Maximum lines to process (for testing)"
    )

    parser.add_argument(
        "--iso-threshold",
        type=float,
        default=2500.0,
        help="Distance threshold for isolated deaths (default: 2500)"
    )

    args = parser.parse_args()

    # Validate series directory
    series_dir = Path(args.series_dir)
    if not series_dir.exists():
        print(f"ERROR: Series directory does not exist: {series_dir}")
        sys.exit(1)

    # Get series ID from directory name
    series_id = series_dir.name

    # Determine events file path
    if args.events:
        events_path = Path(args.events)
    else:
        events_path = series_dir / "events.jsonl"

    if not events_path.exists():
        print(f"ERROR: Events file does not exist: {events_path}")
        sys.exit(1)

    # Create output directory
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 80)
    print("GRID Evidence Extractor v1")
    print("=" * 80)
    print(f"Series ID: {series_id}")
    print(f"Events file: {events_path}")
    print(f"Output dir: {out_dir}")
    if args.max_lines:
        print(f"Max lines: {args.max_lines}")
    print(f"Isolation threshold: {args.iso_threshold}")
    print()

    # Extract evidence
    print("Extracting evidence...")
    evidence = extract_evidence(
        events_path,
        series_id,
        max_lines=args.max_lines,
        iso_threshold=args.iso_threshold
    )

    # Add extraction timestamp
    from datetime import datetime, timezone
    evidence["meta"]["extractedAt"] = datetime.now(timezone.utc).isoformat()

    # Write JSON output
    json_output_path = out_dir / f"{series_id}_evidence_v1.json"
    with open(json_output_path, 'w', encoding='utf-8') as f:
        json.dump(evidence, f, indent=2, ensure_ascii=False)

    print(f"[OK] Wrote: {json_output_path}")

    # Write summary markdown
    summary_output_path = out_dir / f"{series_id}_evidence_v1_summary.md"
    generate_summary_markdown(evidence, summary_output_path)

    print(f"[OK] Wrote: {summary_output_path}")

    # Print stats
    print()
    print("=" * 80)
    print("Extraction Summary")
    print("=" * 80)
    print(f"Games: {len(evidence['games'])}")
    print(f"Rounds: {len(evidence['rounds'])}")
    print(f"Kills: {len(evidence['kills'])}")
    print(f"Plants: {len(evidence['plants'])}")
    print(f"Defuses: {len(evidence['defuses'])}")
    print(f"Players: {len(evidence['players'])}")
    print()

    # Print map details
    for game in evidence["games"]:
        game_rounds = [r for r in evidence["rounds"] if r["gameId"] == game["gameId"]]
        print(f"  {game['mapName']}: {len(game_rounds)} rounds")

    print()
    print("Done!")


if __name__ == "__main__":
    main()
