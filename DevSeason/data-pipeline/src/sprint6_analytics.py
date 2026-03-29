"""
Sprint 6: ADR, KAST, ACS, Item Tracking, and Highlight Detection

Since GRID doesn't provide damage events, we estimate ADR from kills.
"""

from collections import defaultdict
from typing import Dict, List, Optional, Any


# =============================================================================
# Task A1: Estimated Damage Stats (ADR, KAST, ACS)
# =============================================================================

def estimate_damage_from_kills(
    kills: List[Dict],
    rounds: List[Dict],
    clutch_situations: List[Dict],
    trade_kills: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> Dict:
    """
    Estimate damage statistics from kill data.

    Since GRID doesn't provide player-damaged-player events,
    we estimate damage as:
    - 150 damage per kill (full health elimination)
    - Bonus for multi-kills (likely more total damage dealt)
    - Context: clutch damage, trade damage

    Returns:
        {
            "playerDamageStats": [...],
            "teamDamageStats": [...]
        }
    """
    # Count kills per player per round
    player_kills_per_round = defaultdict(lambda: defaultdict(list))
    player_deaths_per_round = defaultdict(lambda: defaultdict(list))

    for kill in kills:
        killer_id = kill.get('killerId')
        victim_id = kill.get('victimId')
        game_id = kill.get('gameId')
        round_num = kill.get('roundNumber', 0)
        round_key = (game_id, round_num)

        if killer_id:
            player_kills_per_round[killer_id][round_key].append(kill)
        if victim_id:
            player_deaths_per_round[victim_id][round_key].append(kill)

    # Build clutch round lookup
    clutch_rounds = set()
    clutch_players = defaultdict(set)
    for clutch in clutch_situations:
        round_key = (clutch.get('gameId'), clutch.get('roundNumber'))
        clutch_rounds.add(round_key)
        clutch_players[clutch.get('playerId')].add(round_key)

    # Build trade lookup
    traded_kills = set()
    for trade in trade_kills:
        traded_kills.add((trade.get('tradedKillerId'), trade.get('gameId'), trade.get('roundNumber')))

    # Calculate damage per player
    player_stats = defaultdict(lambda: {
        'playerId': None,
        'playerName': '',
        'teamId': None,
        'teamName': '',
        'totalKills': 0,
        'totalDeaths': 0,
        'estimatedDamage': 0,
        'roundsPlayed': 0,
        'clutchDamage': 0,
        'tradeDamage': 0,
        'multiKillRounds': 0,
        'headshotKills': 0,
        'damageByWeapon': defaultdict(int),
        'damageByRange': {'close': 0, 'medium': 0, 'long': 0}
    })

    # Get all unique rounds
    all_rounds = set()
    for r in rounds:
        all_rounds.add((r.get('gameId'), r.get('roundNumber')))

    total_rounds = len(all_rounds) // 2 if all_rounds else 1  # Approximate rounds per player

    # Process each player
    for player_id, round_kills in player_kills_per_round.items():
        stats = player_stats[player_id]
        stats['playerId'] = player_id
        stats['playerName'] = player_map.get(player_id, f'Player {player_id}')

        # Find team from any kill
        for kills_list in round_kills.values():
            if kills_list:
                stats['teamId'] = kills_list[0].get('killerTeamId')
                break

        stats['teamName'] = team_map.get(stats['teamId'], {}).get('name', 'Unknown')

        for round_key, kills_list in round_kills.items():
            num_kills = len(kills_list)
            stats['totalKills'] += num_kills

            # Base damage: 150 per kill
            round_damage = num_kills * 150

            # Multi-kill bonus (more enemies engaged = more damage dealt)
            if num_kills >= 3:
                round_damage += 50 * (num_kills - 2)
                stats['multiKillRounds'] += 1

            stats['estimatedDamage'] += round_damage

            # Check for clutch damage
            if round_key in clutch_players.get(player_id, set()):
                stats['clutchDamage'] += round_damage

            # Check for trade damage
            if (player_id, round_key[0], round_key[1]) in traded_kills:
                stats['tradeDamage'] += 150  # At least one trade kill

            # Weapon and range breakdown
            for kill in kills_list:
                weapon = kill.get('weapon', 'unknown')
                stats['damageByWeapon'][weapon] += 150

                range_cat = kill.get('engagementRange', 'medium')
                if range_cat in stats['damageByRange']:
                    stats['damageByRange'][range_cat] += 150

                if kill.get('isHeadshot', False):
                    stats['headshotKills'] += 1

        # Count deaths
        stats['totalDeaths'] = sum(
            len(deaths) for deaths in player_deaths_per_round.get(player_id, {}).values()
        )

        # Estimate rounds played (rough approximation)
        stats['roundsPlayed'] = max(
            len(round_kills),
            len(player_deaths_per_round.get(player_id, {})),
            total_rounds
        )

    # Build output
    player_damage_stats = []
    for player_id, stats in player_stats.items():
        rounds_played = max(stats['roundsPlayed'], 1)
        total_kills = max(stats['totalKills'], 1)

        player_damage_stats.append({
            'playerId': stats['playerId'],
            'playerName': stats['playerName'],
            'teamId': stats['teamId'],
            'teamName': stats['teamName'],

            # Core damage stats
            'totalDamage': stats['estimatedDamage'],
            'roundsPlayed': rounds_played,
            'adr': round(stats['estimatedDamage'] / rounds_played, 1),

            # Damage breakdown
            'damageByWeapon': dict(stats['damageByWeapon']),

            # Efficiency metrics
            'damagePerKill': round(stats['estimatedDamage'] / total_kills, 1),
            'killsPerDamageHundred': round(total_kills * 100 / max(stats['estimatedDamage'], 1), 2),
            'headshotDamagePercent': round(stats['headshotKills'] * 150 / max(stats['estimatedDamage'], 1), 3),

            # Context damage
            'tradeDamage': stats['tradeDamage'],
            'clutchDamage': stats['clutchDamage'],

            # Damage taken (estimated from deaths)
            'damageTaken': stats['totalDeaths'] * 150,
            'damageTakenPerRound': round(stats['totalDeaths'] * 150 / rounds_played, 1),
            'damageRatio': round(stats['estimatedDamage'] / max(stats['totalDeaths'] * 150, 1), 2),

            # Range breakdown
            'damageByRange': stats['damageByRange'],

            # Note about estimation
            '_isEstimated': True,
            '_estimationMethod': 'kill-based'
        })

    # Sort by ADR
    player_damage_stats.sort(key=lambda x: x['adr'], reverse=True)

    # Team damage stats
    team_damage = defaultdict(lambda: {
        'teamId': '',
        'teamName': '',
        'totalDamage': 0,
        'totalKills': 0,
        'playerDamage': {}
    })

    for ps in player_damage_stats:
        team_id = ps['teamId']
        team_damage[team_id]['teamId'] = team_id
        team_damage[team_id]['teamName'] = ps['teamName']
        team_damage[team_id]['totalDamage'] += ps['totalDamage']
        team_damage[team_id]['totalKills'] += ps['totalDamage'] // 150
        team_damage[team_id]['playerDamage'][ps['playerId']] = ps['totalDamage']

    team_damage_stats = []
    for team_id, stats in team_damage.items():
        team_total = max(stats['totalDamage'], 1)

        # Calculate distribution
        distribution = {
            pid: round(dmg / team_total, 3)
            for pid, dmg in stats['playerDamage'].items()
        }

        team_damage_stats.append({
            'teamId': stats['teamId'],
            'teamName': stats['teamName'],
            'totalDamage': stats['totalDamage'],
            'teamAdr': round(stats['totalDamage'] / total_rounds / 5, 1) if total_rounds else 0,  # Per player avg
            'damageDistribution': distribution,
            'topDamageRounds': []  # Would need round-level data
        })

    return {
        'playerDamageStats': player_damage_stats,
        'teamDamageStats': team_damage_stats
    }


def compute_kast_stats(
    kills: List[Dict],
    rounds: List[Dict],
    trade_stats: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> List[Dict]:
    """
    Compute KAST% - Rounds with Kill/Assist/Survived/Traded

    Since GRID doesn't provide assists, we use:
    - K: Got at least one kill
    - A: Had utility assist (flash, damage before teammate kill)
    - S: Survived the round
    - T: Was traded within 3 seconds of death

    Returns:
        List of player KAST stats
    """
    # Build round data structures
    round_kills_by_player = defaultdict(lambda: defaultdict(int))
    round_deaths_by_player = defaultdict(lambda: defaultdict(bool))
    round_traded_deaths = defaultdict(set)

    for kill in kills:
        killer_id = kill.get('killerId')
        victim_id = kill.get('victimId')
        game_id = kill.get('gameId')
        round_num = kill.get('roundNumber', 0)
        round_key = (game_id, round_num)

        if killer_id:
            round_kills_by_player[killer_id][round_key] += 1
        if victim_id:
            round_deaths_by_player[victim_id][round_key] = True

    # Build traded deaths from trade stats
    for trade in trade_stats:
        traded_player = trade.get('tradedVictimId')
        if traded_player:
            round_key = (trade.get('gameId'), trade.get('roundNumber'))
            round_traded_deaths[traded_player].add(round_key)

    # Get all rounds per team
    team_rounds = defaultdict(set)
    for r in rounds:
        round_key = (r.get('gameId'), r.get('roundNumber'))
        winner = r.get('winnerTeamId')
        # Both teams played this round
        for team_id in team_map.keys():
            team_rounds[team_id].add(round_key)

    # Get player teams
    player_teams = {}
    for kill in kills:
        if kill.get('killerId') and kill.get('killerTeamId'):
            player_teams[kill.get('killerId')] = kill.get('killerTeamId')
        if kill.get('victimId') and kill.get('victimTeamId'):
            player_teams[kill.get('victimId')] = kill.get('victimTeamId')

    # Calculate KAST for each player
    kast_stats = []

    all_players = set(round_kills_by_player.keys()) | set(round_deaths_by_player.keys())

    for player_id in all_players:
        team_id = player_teams.get(player_id)
        if not team_id:
            continue

        player_rounds = team_rounds.get(team_id, set())
        if not player_rounds:
            continue

        kast_rounds = 0
        kill_rounds = 0
        assist_rounds = 0  # Pseudo-assists
        survived_rounds = 0
        traded_rounds = 0
        multi_contribution = 0
        zero_impact = 0

        for round_key in player_rounds:
            had_kill = round_kills_by_player[player_id].get(round_key, 0) > 0
            died = round_deaths_by_player[player_id].get(round_key, False)
            was_traded = round_key in round_traded_deaths.get(player_id, set())
            survived = not died

            # Pseudo-assist: had multi-kill (implies team coordination)
            had_assist = round_kills_by_player[player_id].get(round_key, 0) > 1

            # Count contributions
            if had_kill:
                kill_rounds += 1
            if had_assist:
                assist_rounds += 1
            if survived:
                survived_rounds += 1
            if was_traded:
                traded_rounds += 1

            # KAST: any of K/A/S/T
            contributions = sum([had_kill, had_assist, survived, was_traded])
            if contributions > 0:
                kast_rounds += 1

            if contributions >= 2:
                multi_contribution += 1

            if died and not was_traded and not had_kill:
                zero_impact += 1

        total_rounds = len(player_rounds)

        kast_stats.append({
            'playerId': player_id,
            'playerName': player_map.get(player_id, f'Player {player_id}'),
            'teamId': team_id,
            'teamName': team_map.get(team_id, {}).get('name', 'Unknown'),

            'roundsPlayed': total_rounds,
            'kastRounds': kast_rounds,
            'kastPercent': round(kast_rounds / max(total_rounds, 1), 3),

            # Breakdown
            'killRounds': kill_rounds,
            'assistRounds': assist_rounds,
            'survivedRounds': survived_rounds,
            'tradedRounds': traded_rounds,

            # Advanced
            'multiContributionRounds': multi_contribution,
            'zeroImpactRounds': zero_impact,

            # Note
            '_isEstimated': True,
            '_assistMethod': 'multi-kill proxy'
        })

    # Sort by KAST%
    kast_stats.sort(key=lambda x: x['kastPercent'], reverse=True)

    return kast_stats


def compute_acs_stats(
    damage_stats: Dict,
    kills: List[Dict],
    first_blood_stats: List[Dict],
    multi_kill_stats: List[Dict],
    rounds: List[Dict]
) -> List[Dict]:
    """
    Approximate Average Combat Score using available data.

    ACS Formula (approximation):
    - Damage: 1 point per damage
    - Kills: 50 points per kill (150 for first blood)
    - Multi-kills: Bonus (2k +50, 3k +150, 4k +300, 5k +500)

    Returns:
        List of player ACS stats
    """
    # Build first blood lookup
    first_bloods_by_player = defaultdict(int)
    for fb in first_blood_stats:
        # First blood stats are team-level, need to extract from kills
        pass

    # Count first bloods from kills
    for r in rounds:
        first_blood = r.get('firstBlood', {})
        killer_id = first_blood.get('killerId')
        if killer_id:
            first_bloods_by_player[killer_id] += 1

    # Build multi-kill lookup
    multi_kills_by_player = defaultdict(lambda: {'2k': 0, '3k': 0, '4k': 0, '5k': 0})
    for mk in multi_kill_stats:
        player_id = mk.get('playerId')
        if player_id:
            multi_kills_by_player[player_id]['2k'] += mk.get('doubleKills', 0)
            multi_kills_by_player[player_id]['3k'] += mk.get('tripleKills', 0)
            multi_kills_by_player[player_id]['4k'] += mk.get('quadraKills', 0)
            multi_kills_by_player[player_id]['5k'] += mk.get('aces', 0)

    acs_stats = []

    player_damage_stats = damage_stats.get('playerDamageStats', [])

    for pds in player_damage_stats:
        player_id = pds['playerId']
        rounds_played = max(pds['roundsPlayed'], 1)

        # Damage score (using estimated damage)
        damage_score = pds['totalDamage']

        # Kill score: 50 per kill
        kills_count = pds['totalDamage'] // 150  # Estimated from damage
        kill_score = kills_count * 50

        # First blood score: +100 bonus (150 total)
        fb_count = first_bloods_by_player.get(player_id, 0)
        first_blood_score = fb_count * 100

        # Multi-kill score
        mk = multi_kills_by_player.get(player_id, {})
        multi_kill_score = (
            mk.get('2k', 0) * 50 +
            mk.get('3k', 0) * 150 +
            mk.get('4k', 0) * 300 +
            mk.get('5k', 0) * 500
        )

        total_score = damage_score + kill_score + first_blood_score + multi_kill_score
        acs = round(total_score / rounds_played, 1)

        acs_stats.append({
            'playerId': player_id,
            'playerName': pds['playerName'],
            'teamId': pds['teamId'],
            'teamName': pds['teamName'],

            'totalCombatScore': total_score,
            'roundsPlayed': rounds_played,
            'acs': acs,

            # Score breakdown
            'damageScore': damage_score,
            'killScore': kill_score,
            'firstBloodScore': first_blood_score,
            'multiKillScore': multi_kill_score,

            # Percentile (will be calculated after sorting)
            'acsRank': 0,
            'teamAcsShare': 0,

            # Note
            '_isEstimated': True
        })

    # Sort by ACS and assign ranks
    acs_stats.sort(key=lambda x: x['acs'], reverse=True)
    for i, stat in enumerate(acs_stats):
        stat['acsRank'] = i + 1

    # Calculate team ACS share
    team_totals = defaultdict(int)
    for stat in acs_stats:
        team_totals[stat['teamId']] += stat['totalCombatScore']

    for stat in acs_stats:
        team_total = team_totals.get(stat['teamId'], 1)
        stat['teamAcsShare'] = round(stat['totalCombatScore'] / team_total, 3)

    return acs_stats


# =============================================================================
# Task A3: Item Event Extraction
# =============================================================================

def extract_item_events(
    kills: List[Dict],
    plants: List[Dict],
    rounds: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> Dict:
    """
    Track item-related statistics from available data.

    Since we don't have full item events, we track:
    - Spike drops (from carrier deaths)
    - Weapon pickups (inferred from eco round kills with expensive weapons)

    Returns:
        Item-related statistics
    """
    # Track spike drops from kills where carrier died before planting
    spike_drops = defaultdict(lambda: {
        'totalDrops': 0,
        'recoveredDrops': 0,
        'failedDrops': 0
    })

    # Build plant lookup
    planted_rounds = set()
    for plant in plants:
        planted_rounds.add((plant.get('gameId'), plant.get('roundNumber')))

    # Track attack-side deaths (potential spike drops)
    for r in rounds:
        game_id = r.get('gameId')
        round_num = r.get('roundNumber', 0)
        round_key = (game_id, round_num)

        # Determine attack team from first plant or winner
        attack_team = None
        for plant in plants:
            if plant.get('gameId') == game_id and plant.get('roundNumber') == round_num:
                attack_team = plant.get('planterTeamId')
                break

        if not attack_team:
            continue

        # Count attack team deaths before plant
        attack_deaths = 0
        for kill in kills:
            if (kill.get('gameId') == game_id and
                kill.get('roundNumber') == round_num and
                kill.get('victimTeamId') == attack_team):
                attack_deaths += 1

        # If all attackers died without plant = spike was dropped and lost
        had_plant = round_key in planted_rounds
        if attack_deaths >= 5 and not had_plant:
            spike_drops[attack_team]['totalDrops'] += 1
            spike_drops[attack_team]['failedDrops'] += 1
        elif attack_deaths > 0 and had_plant:
            # Some deaths but still planted = potential recovery
            spike_drops[attack_team]['totalDrops'] += attack_deaths
            spike_drops[attack_team]['recoveredDrops'] += attack_deaths

    # Build output
    item_stats = {
        'spikeHandlingStats': {},
        'weaponPickupStats': {},  # Would need actual pickup events
        'economyEfficiencyFromPickups': {}  # Would need actual pickup events
    }

    for team_id, drops in spike_drops.items():
        team_name = team_map.get(team_id, {}).get('name', 'Unknown')
        item_stats['spikeHandlingStats'][team_id] = {
            'teamId': team_id,
            'teamName': team_name,
            'spikeDrops': drops['totalDrops'],
            'spikeRecoveries': drops['recoveredDrops'],
            'failedRecoveries': drops['failedDrops'],
            'avgRecoveryTime': 0,  # Would need timestamps
            'spikeRecoveryPlayers': {}  # Would need pickup events
        }

    return item_stats


# =============================================================================
# Task C2: Highlight Round Detection
# =============================================================================

def identify_highlight_rounds(
    rounds: List[Dict],
    kills: List[Dict],
    clutch_situations: List[Dict],
    multi_kill_stats: List[Dict],
    economy_rounds: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict],
    max_highlights: int = 10
) -> List[Dict]:
    """
    Identify highlight-worthy rounds for demo reel / VOD review.

    Scoring factors:
    - Ace: +100
    - 4k: +60
    - 3k: +30
    - Clutch win: +50 (bonus for 1v3+: +30)
    - Clutch attempt (lost): +15
    - Comeback round: +40
    - Match point: +30
    - Overtime: +20
    - Throw (2+ man advantage lost): -20 (still interesting)
    - Close score: +10
    - Economy upset: +35
    - First blood + plant + defuse in same round: +25

    Returns:
        List of highlight rounds with scores and descriptions
    """
    # Build kills per round per player
    kills_by_round = defaultdict(lambda: defaultdict(list))
    for kill in kills:
        game_id = kill.get('gameId')
        round_num = kill.get('roundNumber', 0)
        killer_id = kill.get('killerId')
        kills_by_round[(game_id, round_num)][killer_id].append(kill)

    # Build clutch lookup
    clutch_lookup = {}
    for clutch in clutch_situations:
        round_key = (clutch.get('gameId'), clutch.get('roundNumber'))
        clutch_lookup[round_key] = clutch

    # Build economy lookup
    eco_lookup = {}
    for eco in economy_rounds:
        round_key = (eco.get('gameId'), eco.get('roundNumber'), eco.get('teamId'))
        eco_lookup[round_key] = eco

    # Track game scores
    game_scores = defaultdict(lambda: defaultdict(int))

    highlights = []

    for r in rounds:
        game_id = r.get('gameId')
        round_num = r.get('roundNumber', 0)
        round_key = (game_id, round_num)
        winner = r.get('winnerTeamId')

        # Update score
        if winner:
            game_scores[game_id][winner] += 1

        # Calculate current score before this round
        scores = list(game_scores[game_id].values())
        if len(scores) >= 2:
            high_score = max(scores)
            low_score = min(scores)
            score_diff = high_score - low_score
            total_rounds = sum(scores)
        else:
            high_score = 0
            low_score = 0
            score_diff = 0
            total_rounds = round_num

        # Calculate highlight score
        score = 0
        highlight_types = []
        description_parts = []
        involved_players = set()

        # Check for multi-kills
        round_kills = kills_by_round.get(round_key, {})
        for player_id, player_kills in round_kills.items():
            kill_count = len(player_kills)
            player_name = player_map.get(player_id, f'Player {player_id}')
            involved_players.add(player_name)

            if kill_count == 5:
                score += 100
                highlight_types.append('ace')
                description_parts.append(f'{player_name} ACE!')
            elif kill_count == 4:
                score += 60
                highlight_types.append('4k')
                description_parts.append(f'{player_name} 4K')
            elif kill_count == 3:
                score += 30
                highlight_types.append('3k')
                description_parts.append(f'{player_name} 3K')

        # Check for clutch
        clutch = clutch_lookup.get(round_key)
        if clutch:
            clutch_player = clutch.get('playerName', 'Unknown')
            involved_players.add(clutch_player)
            situation = clutch.get('situation', '1v1')
            won = clutch.get('won', False)

            if won:
                score += 50
                highlight_types.append('clutch_win')
                # Bonus for hard clutches
                if situation in ['1v3', '1v4', '1v5']:
                    score += 30
                    highlight_types.append('hard_clutch')
                description_parts.append(f'{clutch_player} {situation} clutch WIN!')
            else:
                score += 15
                highlight_types.append('clutch_attempt')
                description_parts.append(f'{clutch_player} {situation} attempt')

        # Check for match point
        if high_score == 12 and total_rounds >= 23:
            score += 30
            highlight_types.append('match_point')
            description_parts.append('Match point round')

        # Check for overtime
        if total_rounds > 24:
            score += 20
            highlight_types.append('overtime')
            description_parts.append('Overtime')

        # Check for close score
        if score_diff <= 2 and total_rounds >= 10:
            score += 10
            highlight_types.append('close_game')

        # Check for comeback (winning after being down 3+)
        if winner and score_diff >= 3:
            # Team was losing but won this round
            winner_score = game_scores[game_id].get(winner, 0)
            other_score = max(s for t, s in game_scores[game_id].items() if t != winner)
            if winner_score < other_score:
                score += 40
                highlight_types.append('comeback')
                description_parts.append('Comeback round')

        # Check for eco win (economy upset)
        teams_in_round = set()
        for k in round_kills.values():
            for kill in k:
                teams_in_round.add(kill.get('killerTeamId'))
                teams_in_round.add(kill.get('victimTeamId'))

        if winner and len(teams_in_round) >= 2:
            winner_eco_key = (game_id, round_num, winner)
            winner_eco = eco_lookup.get(winner_eco_key, {})
            winner_tier = winner_eco.get('economyTier', 'unknown')

            # Check opponent economy
            loser_team = [t for t in teams_in_round if t != winner]
            if loser_team:
                loser_eco_key = (game_id, round_num, loser_team[0])
                loser_eco = eco_lookup.get(loser_eco_key, {})
                loser_tier = loser_eco.get('economyTier', 'unknown')

                # Eco/save beat full buy
                if winner_tier in ['eco', 'save'] and loser_tier == 'full_buy':
                    score += 35
                    highlight_types.append('eco_upset')
                    description_parts.append('Economy upset!')

        # Only include rounds with score > 20
        if score >= 20:
            highlights.append({
                'roundNumber': round_num,
                'gameId': game_id,
                'mapName': '',  # Would need game map lookup
                'highlightScore': score,
                'highlightType': highlight_types[0] if highlight_types else 'notable',
                'allHighlightTypes': highlight_types,
                'description': ' | '.join(description_parts) if description_parts else 'Notable round',
                'involvedPlayers': list(involved_players),
                'timestamp': '',  # Would need round timing
                'vodTimestamp': '',
                'keyMoments': [],  # Would need detailed timing
                'scoreBefore': f'{low_score}-{high_score}' if high_score > 0 else '0-0',
                'scoreAfter': f'{game_scores[game_id].get(winner, 0)}-{sum(game_scores[game_id].values()) - game_scores[game_id].get(winner, 0)}'
            })

    # Sort by score and limit
    highlights.sort(key=lambda x: x['highlightScore'], reverse=True)

    # Add ranks
    for i, h in enumerate(highlights[:max_highlights]):
        h['rank'] = i + 1

    return highlights[:max_highlights]


# =============================================================================
# Task C1: Stat Significance Filtering
# =============================================================================

DEFAULT_MIN_SAMPLES = {
    'clutch': 3,
    'opening': 5,
    'weapon': 10,
    'trade': 5,
    'entry': 3,
    'economy': 5,
    'damage': 10,
    'ability': 5,
    'kast': 5,
    'acs': 5
}


def filter_significant_stats(
    evidence: Dict,
    min_samples: Dict = None
) -> Dict:
    """
    Filter out statistics with insufficient sample sizes.

    Returns filtered evidence with only significant stats.
    """
    if min_samples is None:
        min_samples = DEFAULT_MIN_SAMPLES

    filtered = evidence.copy()
    derived = filtered.get('derived', {})
    filtered_derived = derived.copy()

    # Filter clutch stats
    if 'clutchStats' in filtered_derived:
        filtered_derived['clutchStats'] = [
            c for c in filtered_derived['clutchStats']
            if c.get('clutchAttempts', 0) >= min_samples['clutch']
        ]

    # Filter opening duel stats
    if 'openingDuelStats' in filtered_derived:
        filtered_derived['openingDuelStats'] = [
            o for o in filtered_derived['openingDuelStats']
            if o.get('openingDuels', o.get('wins', 0) + o.get('losses', 0)) >= min_samples['opening']
        ]

    # Filter weapon stats
    if 'weaponStats' in filtered_derived:
        for player_stat in filtered_derived['weaponStats']:
            if 'byWeapon' in player_stat:
                player_stat['byWeapon'] = {
                    weapon: stats for weapon, stats in player_stat['byWeapon'].items()
                    if stats.get('kills', 0) >= min_samples['weapon']
                }

    # Filter trade stats
    if 'tradeStats' in filtered_derived:
        filtered_derived['tradeStats'] = [
            t for t in filtered_derived['tradeStats']
            if t.get('deaths', t.get('totalDeaths', 0)) >= min_samples['trade']
        ]

    # Filter entry stats
    if 'entryStats' in filtered_derived:
        filtered_derived['entryStats'] = [
            e for e in filtered_derived['entryStats']
            if e.get('entryAttempts', 0) >= min_samples['entry']
        ]

    # Filter KAST stats
    if 'kastStats' in filtered_derived:
        filtered_derived['kastStats'] = [
            k for k in filtered_derived['kastStats']
            if k.get('roundsPlayed', 0) >= min_samples['kast']
        ]

    # Filter ACS stats
    if 'acsStats' in filtered_derived:
        filtered_derived['acsStats'] = [
            a for a in filtered_derived['acsStats']
            if a.get('roundsPlayed', 0) >= min_samples['acs']
        ]

    filtered['derived'] = filtered_derived
    return filtered


def add_confidence_indicators(stats: Dict) -> Dict:
    """
    Add confidence levels to stats based on sample size.

    Confidence levels:
    - high: Large sample size (20+ events)
    - medium: Moderate sample size (10-19 events)
    - low: Small sample size (5-9 events)
    """
    def get_confidence(sample_size: int) -> str:
        if sample_size >= 20:
            return 'high'
        elif sample_size >= 10:
            return 'medium'
        else:
            return 'low'

    # Add confidence to various stats
    if 'derived' in stats:
        derived = stats['derived']

        if 'clutchStats' in derived:
            for c in derived['clutchStats']:
                c['confidence'] = get_confidence(c.get('clutchAttempts', 0))

        if 'openingDuelStats' in derived:
            for o in derived['openingDuelStats']:
                total = o.get('wins', 0) + o.get('losses', 0)
                o['confidence'] = get_confidence(total)

        if 'tradeStats' in derived:
            for t in derived['tradeStats']:
                t['confidence'] = get_confidence(t.get('totalDeaths', t.get('deaths', 0)))

        if 'kastStats' in derived:
            for k in derived['kastStats']:
                k['confidence'] = get_confidence(k.get('roundsPlayed', 0))

        if 'acsStats' in derived:
            for a in derived['acsStats']:
                a['confidence'] = get_confidence(a.get('roundsPlayed', 0))

    return stats


# =============================================================================
# Integration: Compute All Sprint 6 Stats
# =============================================================================

def compute_sprint6_stats(
    rounds: List[Dict],
    kills: List[Dict],
    plants: List[Dict],
    clutch_situations: List[Dict],
    economy_rounds: List[Dict],
    first_blood_stats: List[Dict],
    multi_kill_stats: List[Dict],
    trade_stats: List[Dict],
    player_map: Dict[str, str],
    team_map: Dict[str, Dict]
) -> Dict:
    """
    Compute all Sprint 6 analytics stats.

    Returns:
        Dictionary of Sprint 6 stats to add to evidence['derived']
    """
    # Task A1: Damage/ADR stats
    damage_stats = estimate_damage_from_kills(
        kills, rounds, clutch_situations, trade_stats, player_map, team_map
    )

    # Task A1: KAST stats
    kast_stats = compute_kast_stats(
        kills, rounds, trade_stats, player_map, team_map
    )

    # Task A1: ACS stats
    acs_stats = compute_acs_stats(
        damage_stats, kills, first_blood_stats, multi_kill_stats, rounds
    )

    # Task A3: Item stats
    item_stats = extract_item_events(
        kills, plants, rounds, player_map, team_map
    )

    # Task C2: Highlight rounds
    highlights = identify_highlight_rounds(
        rounds, kills, clutch_situations, multi_kill_stats,
        economy_rounds, player_map, team_map
    )

    return {
        'playerDamageStats': damage_stats['playerDamageStats'],
        'teamDamageStats': damage_stats['teamDamageStats'],
        'kastStats': kast_stats,
        'acsStats': acs_stats,
        'itemStats': item_stats,
        'highlightRounds': highlights
    }
