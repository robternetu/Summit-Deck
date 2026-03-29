"""
Test script to demonstrate evidence-based analytics.

This script fetches a match from MongoDB and simulates what the TypeScript
computeMatchAnalytics function would compute from the evidence_v1 data.
"""
import os
import sys
from pymongo import MongoClient

def compute_attack_defense_stats(rounds, team_id):
    """
    Compute attack/defense win rates from round data.
    Mirrors the logic in computeMatchAnalytics.ts
    """
    attack_wins = 0
    attack_total = 0
    defense_wins = 0
    defense_total = 0
    team_rounds_won = 0
    team_rounds_lost = 0

    for round_data in rounds:
        is_winner = round_data.get('winnerTeamId') == team_id
        winner_side = round_data.get('winnerSide')

        if is_winner:
            team_rounds_won += 1
            if winner_side == 'attacker':
                attack_wins += 1
            elif winner_side == 'defender':
                defense_wins += 1
        else:
            team_rounds_lost += 1

        # Track totals based on team's side this round
        if winner_side == 'attacker':
            if is_winner:
                attack_total += 1
            else:
                defense_total += 1  # Team was defense, lost
        elif winner_side == 'defender':
            if is_winner:
                defense_total += 1
            else:
                attack_total += 1  # Team was attack, lost

    return {
        'attack_wins': attack_wins,
        'attack_total': attack_total,
        'defense_wins': defense_wins,
        'defense_total': defense_total,
        'attack_win_rate': attack_wins / attack_total if attack_total > 0 else 0,
        'defense_win_rate': defense_wins / defense_total if defense_total > 0 else 0,
        'team_rounds_won': team_rounds_won,
        'team_rounds_lost': team_rounds_lost,
    }

def main():
    # Get MongoDB URI from environment
    mongo_uri = os.getenv("MONGODB_URI")
    if not mongo_uri:
        print("ERROR: MONGODB_URI environment variable not set")
        sys.exit(1)

    # Connect to MongoDB
    client = MongoClient(mongo_uri)
    db = client["c9-stratos"]
    matches_collection = db.Match

    print("=" * 80)
    print("Evidence-Based Analytics Test")
    print("=" * 80)

    # Fetch a match with evidence
    match = matches_collection.find_one(
        {"analytics.evidence_v1": {"$exists": True}},
    )

    if not match:
        print("No matches with evidence found!")
        client.close()
        sys.exit(1)

    print(f"\nMatch: {match.get('map')} - {match.get('opponentName')}")
    print(f"Series ID: {match.get('gridSeriesId')}")

    evidence = match.get('analytics', {}).get('evidence_v1', {})
    rounds = evidence.get('rounds', [])
    derived = evidence.get('derived', {})

    print(f"\nTotal Rounds: {len(rounds)}")

    # Determine team IDs
    fb_stats = derived.get('firstBloodStats', [])
    if len(fb_stats) >= 2:
        team1_id = fb_stats[0]['teamId']
        team1_name = fb_stats[0]['teamName']
        team2_id = fb_stats[1]['teamId']
        team2_name = fb_stats[1]['teamName']

        print(f"\nTeams:")
        print(f"  - Team 1: {team1_name} (ID: {team1_id})")
        print(f"  - Team 2: {team2_name} (ID: {team2_id})")

        # Compute stats for team 1
        stats1 = compute_attack_defense_stats(rounds, team1_id)
        stats2 = compute_attack_defense_stats(rounds, team2_id)

        print("\n" + "=" * 80)
        print(f"{team1_name} Analytics")
        print("=" * 80)
        print(f"Match Result: {stats1['team_rounds_won']}-{stats1['team_rounds_lost']}")
        print(f"\nAttack Performance:")
        print(f"  - Rounds: {stats1['attack_wins']}/{stats1['attack_total']}")
        print(f"  - Win Rate: {stats1['attack_win_rate'] * 100:.1f}%")
        print(f"\nDefense Performance:")
        print(f"  - Rounds: {stats1['defense_wins']}/{stats1['defense_total']}")
        print(f"  - Win Rate: {stats1['defense_win_rate'] * 100:.1f}%")

        # First blood conversion
        team1_fb = next((s for s in fb_stats if s['teamId'] == team1_id), None)
        if team1_fb:
            print(f"\nFirst Blood Stats:")
            print(f"  - First Bloods: {team1_fb['firstBloods']}")
            print(f"  - Conversion Rate: {team1_fb['conversionRate'] * 100:.1f}%")

        # Plant stats
        plant_stats = derived.get('plantStats', [])
        team1_plant = next((s for s in plant_stats if s['teamId'] == team1_id), None)
        if team1_plant:
            print(f"\nPlant Stats:")
            print(f"  - Plants: {team1_plant['plants']}")
            print(f"  - Post-Plant Win Rate: {team1_plant['postPlantWinRate'] * 100:.1f}%")

        print("\n" + "=" * 80)
        print(f"{team2_name} Analytics")
        print("=" * 80)
        print(f"Match Result: {stats2['team_rounds_won']}-{stats2['team_rounds_lost']}")
        print(f"\nAttack Performance:")
        print(f"  - Rounds: {stats2['attack_wins']}/{stats2['attack_total']}")
        print(f"  - Win Rate: {stats2['attack_win_rate'] * 100:.1f}%")
        print(f"\nDefense Performance:")
        print(f"  - Rounds: {stats2['defense_wins']}/{stats2['defense_total']}")
        print(f"  - Win Rate: {stats2['defense_win_rate'] * 100:.1f}%")

        # First blood conversion
        team2_fb = next((s for s in fb_stats if s['teamId'] == team2_id), None)
        if team2_fb:
            print(f"\nFirst Blood Stats:")
            print(f"  - First Bloods: {team2_fb['firstBloods']}")
            print(f"  - Conversion Rate: {team2_fb['conversionRate'] * 100:.1f}%")

        # Plant stats
        team2_plant = next((s for s in plant_stats if s['teamId'] == team2_id), None)
        if team2_plant:
            print(f"\nPlant Stats:")
            print(f"  - Plants: {team2_plant['plants']}")
            print(f"  - Post-Plant Win Rate: {team2_plant['postPlantWinRate'] * 100:.1f}%")

    print("\n" + "=" * 80)
    print("Test Complete!")
    print("=" * 80)

    client.close()

if __name__ == "__main__":
    main()
