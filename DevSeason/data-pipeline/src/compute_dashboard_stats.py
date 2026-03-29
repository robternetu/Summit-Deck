"""
Compute and store Summit dashboard statistics from match evidence.

Processes all matches with evidence_v1 data and creates a pre-computed
stats document for fast dashboard loading.
"""
import os
import sys
from datetime import datetime, timezone
from collections import defaultdict
from typing import Dict, List, Any, Optional

from pymongo import MongoClient


PRIMARY_TEAM_ID = '79'  # Featured team ID as string
DASHBOARD_STATS_ID = 'featured-team'


# Tournament mapping based on series ID ranges
TOURNAMENT_MAPPINGS = [
    (2843060, 2843071, 'VCT 2025 Americas Split 2', 'Dec 2025'),
    (2819676, 2819705, 'VCT 2025 Americas Stage 2', 'Nov 2025'),
    (2775953, 2789396, 'VCT 2025 Americas Stage 1', 'Sep 2025'),
    (2748743, 2748766, 'VCT 2025 Americas Kickoff', 'Feb 2025'),
    (2681809, 2681847, 'VCT 2024 Americas Playoffs', 'Aug 2024'),
    (2653969, 2654052, 'VCT 2024 Americas Stage 2', 'Jun 2024'),
    (2648624, 2648639, 'VCT 2024 Americas Stage 1', 'Apr 2024'),
    (2637961, 2637963, 'VCT 2024 Americas Stage 1', 'Mar 2024'),
    (2629390, 2629407, 'VCT 2024 Americas Kickoff', 'Feb 2024'),
]


def get_tournament_info(series_id: str) -> tuple:
    """Get tournament name and date from series ID."""
    try:
        sid = int(series_id)
        for start, end, tournament, date in TOURNAMENT_MAPPINGS:
            if start <= sid <= end:
                return tournament, date
    except (ValueError, TypeError):
        pass
    return 'VCT Americas', ''


def get_mongo_uri() -> str:
    """Get MongoDB URI from environment."""
    uri = os.environ.get('MONGODB_URI')
    if not uri:
        raise ValueError('MONGODB_URI environment variable not set')
    return uri


def compute_dashboard_stats(matches: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compute dashboard statistics from match documents.

    Args:
        matches: List of match documents with evidence_v1 data

    Returns:
        Dictionary containing all dashboard statistics
    """
    # Group matches by series
    series_map: Dict[str, List[Dict]] = defaultdict(list)
    for match in matches:
        series_id = match.get('gridSeriesId')
        if series_id:
            series_map[series_id].append(match)

    # Compute series-level stats
    total_series = len(series_map)
    series_wins = 0
    series_losses = 0
    maps_played: Dict[str, int] = defaultdict(int)

    attack_rounds_won = 0
    attack_rounds_total = 0
    defense_rounds_won = 0
    defense_rounds_total = 0

    # Track opponent records: opponent -> {seriesWins, seriesLosses, mapsWon, mapsLost}
    opponent_records: Dict[str, Dict[str, int]] = defaultdict(
        lambda: {'seriesWins': 0, 'seriesLosses': 0, 'mapsWon': 0, 'mapsLost': 0}
    )

    recent_series: List[Dict[str, Any]] = []

    # Process each series
    for series_id, series_matches in series_map.items():
        primary_team_maps_won = 0
        opponent_maps_won = 0
        opponent_name = 'Unknown'
        games_detail: List[Dict] = []

        for match in series_matches:
            evidence = match.get('analytics', {}).get('evidence_v1', {})
            if not evidence:
                continue

            # Get map stats from derived.mapsStats
            maps_stats = evidence.get('derived', {}).get('mapsStats', [])
            games = evidence.get('games', [])
            rounds = evidence.get('rounds', [])

            # Build game ID to map name lookup
            game_map_names: Dict[str, str] = {}
            for game in games:
                game_map_names[game.get('gameId', '')] = game.get('mapName', 'Unknown')

            # Group mapsStats by gameId to get featured team vs opponent per map
            game_stats: Dict[str, Dict[str, Any]] = defaultdict(lambda: {'primaryTeam': None, 'opponent': None})
            for stat in maps_stats:
                game_id = stat.get('gameId')
                team_id = str(stat.get('teamId', ''))
                if team_id == PRIMARY_TEAM_ID:
                    game_stats[game_id]['primaryTeam'] = stat
                else:
                    game_stats[game_id]['opponent'] = stat
                    if stat.get('teamName'):
                        opponent_name = stat.get('teamName')

            # Also get opponent name from match document
            if match.get('opponentName') and opponent_name == 'Unknown':
                opponent_name = match.get('opponentName')

            # Calculate map wins/losses for this match
            for game_id, stats in game_stats.items():
                primary_team_stat = stats['primaryTeam']
                opp_stat = stats['opponent']

                if not primary_team_stat or not opp_stat:
                    continue

                map_name = game_map_names.get(game_id, 'Unknown')
                maps_played[map_name] += 1

                primary_team_rounds = primary_team_stat.get('roundsWon', 0)
                opp_rounds = opp_stat.get('roundsWon', 0)

                games_detail.append({
                    'mapName': map_name,
                    'primaryTeamRounds': primary_team_rounds,
                    'opponentRounds': opp_rounds
                })

                if primary_team_rounds > opp_rounds:
                    primary_team_maps_won += 1
                elif opp_rounds > primary_team_rounds:
                    opponent_maps_won += 1

            # Calculate attack/defense round stats from rounds data
            for round_data in rounds:
                winner_team_id = str(round_data.get('winnerTeamId', ''))
                winner_side = round_data.get('winnerSide', '')

                if winner_side == 'attack':
                    attack_rounds_total += 1
                    if winner_team_id == PRIMARY_TEAM_ID:
                        attack_rounds_won += 1
                elif winner_side == 'defense':
                    defense_rounds_total += 1
                    if winner_team_id == PRIMARY_TEAM_ID:
                        defense_rounds_won += 1

        # Determine series result
        is_win = primary_team_maps_won > opponent_maps_won
        is_loss = opponent_maps_won > primary_team_maps_won

        if is_win:
            series_wins += 1
            opponent_records[opponent_name]['seriesWins'] += 1
        elif is_loss:
            series_losses += 1
            opponent_records[opponent_name]['seriesLosses'] += 1

        opponent_records[opponent_name]['mapsWon'] += primary_team_maps_won
        opponent_records[opponent_name]['mapsLost'] += opponent_maps_won

        # Add to recent series list
        if series_matches:
            first_match = series_matches[0]
            tournament_name, match_date = get_tournament_info(series_id)
            recent_series.append({
                'seriesId': series_id,
                'opponent': opponent_name,
                'primaryTeamMapsWon': primary_team_maps_won,
                'opponentMapsWon': opponent_maps_won,
                'isWin': is_win,
                'tournamentName': tournament_name,
                'matchDate': match_date,
                'games': games_detail,
                'matchId': str(first_match.get('_id', '')),
                'date': first_match.get('date')
            })

    # Calculate win rates
    attack_win_rate = attack_rounds_won / attack_rounds_total if attack_rounds_total > 0 else 0
    defense_win_rate = defense_rounds_won / defense_rounds_total if defense_rounds_total > 0 else 0

    # Sort recent series by date (most recent first) and limit to 10
    recent_series.sort(key=lambda x: x.get('date') or '', reverse=True)
    recent_series = recent_series[:10]

    # Remove date field from output (not needed in schema)
    for series in recent_series:
        series.pop('date', None)

    # Find opponents the featured roster struggles against (loss rate > 50%, minimum 2 series)
    struggling_against = []
    for opponent, record in opponent_records.items():
        total = record['seriesWins'] + record['seriesLosses']
        if total >= 2:
            loss_rate = record['seriesLosses'] / total
            if loss_rate > 0.5:
                struggling_against.append({
                    'name': opponent,
                    'seriesWins': record['seriesWins'],
                    'seriesLosses': record['seriesLosses'],
                    'mapsWon': record['mapsWon'],
                    'mapsLost': record['mapsLost']
                })

    # Sort by loss rate descending, then by total losses
    struggling_against.sort(
        key=lambda x: (x['seriesLosses'] / (x['seriesWins'] + x['seriesLosses']), x['seriesLosses']),
        reverse=True
    )
    struggling_against = struggling_against[:5]

    return {
        'totalSeries': total_series,
        'seriesWins': series_wins,
        'seriesLosses': series_losses,
        'mapsPlayed': dict(maps_played),
        'attackWinRate': attack_win_rate,
        'defenseWinRate': defense_win_rate,
        'recentSeries': recent_series,
        'strugglingAgainst': struggling_against,
        'lastUpdated': datetime.now(timezone.utc),
        'matchesProcessed': len(matches)
    }


def main():
    """Main function to compute and store dashboard stats."""
    print('=' * 60)
    print('Summit Dashboard Stats Computation')
    print('=' * 60)
    print()

    print('Connecting to MongoDB...')
    sys.stdout.flush()

    uri = get_mongo_uri()
    client = MongoClient(uri)

    try:
        db = client['c9-stratos']
        matches_collection = db['matches']
        dashboard_stats_collection = db['dashboardstats']

        print('[OK] Connected to MongoDB')
        sys.stdout.flush()

        # Only fetch the fields we need for computation
        print('\nFetching matches with evidence data...')
        sys.stdout.flush()

        cursor = matches_collection.find(
            {'analytics.evidence_v1.derived.mapsStats': {'$exists': True}},
            {
                'gridSeriesId': 1,
                'opponentName': 1,
                'date': 1,
                'analytics.evidence_v1.derived.mapsStats': 1,
                'analytics.evidence_v1.games': 1,
                'analytics.evidence_v1.rounds': 1
            }
        )

        matches = list(cursor)
        print(f'[OK] Found {len(matches)} matches with evidence data')

        if len(matches) == 0:
            print('\n[WARN] No matches found. Skipping stats computation.')
            return

        print('\nComputing dashboard statistics...')
        sys.stdout.flush()

        stats = compute_dashboard_stats(matches)

        print('[OK] Computed stats:')
        print(f'  - Total Series: {stats["totalSeries"]}')
        print(f'  - Series Wins: {stats["seriesWins"]}')
        print(f'  - Series Losses: {stats["seriesLosses"]}')
        print(f'  - Maps Played: {len(stats["mapsPlayed"])} unique maps')
        for map_name, count in sorted(stats["mapsPlayed"].items(), key=lambda x: -x[1]):
            print(f'      {map_name}: {count}')
        print(f'  - Attack Win Rate: {stats["attackWinRate"] * 100:.1f}%')
        print(f'  - Defense Win Rate: {stats["defenseWinRate"] * 100:.1f}%')
        print(f'  - Recent Series: {len(stats["recentSeries"])} series')
        for series in stats["recentSeries"][:5]:
            result = "W" if series["isWin"] else "L"
            print(f'      vs {series["opponent"]}: {result} ({series["primaryTeamMapsWon"]}-{series["opponentMapsWon"]})')
        print(f'  - Struggling Against: {len(stats["strugglingAgainst"])} opponents')
        for opp in stats["strugglingAgainst"]:
            print(f'      {opp["name"]}: {opp["seriesWins"]}W-{opp["seriesLosses"]}L')

        print('\nSaving to dashboardstats collection...')
        sys.stdout.flush()

        dashboard_stats_collection.replace_one(
            {'_id': DASHBOARD_STATS_ID},
            {'_id': DASHBOARD_STATS_ID, **stats},
            upsert=True
        )

        print('[OK] Dashboard stats saved successfully!')

        # Verify
        saved = dashboard_stats_collection.find_one({'_id': DASHBOARD_STATS_ID})
        print(f'\n[VERIFIED] Document saved with {saved["matchesProcessed"]} matches processed')
        print(f'           Last updated: {saved["lastUpdated"]}')

        print('\n' + '=' * 60)
        print('[SUCCESS] Dashboard stats computation complete!')
        print('=' * 60)

    finally:
        client.close()


if __name__ == '__main__':
    main()
