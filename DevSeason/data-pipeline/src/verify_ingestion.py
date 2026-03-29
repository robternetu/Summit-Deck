"""
Verify MongoDB ingestion success by querying and inspecting evidence_v1 data.
"""
import os
import sys
from pymongo import MongoClient

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
    print("MongoDB Ingestion Verification")
    print("=" * 80)

    # Count total matches
    total_matches = matches_collection.count_documents({})
    print(f"Total matches in database: {total_matches}")

    # Count matches with evidence_v1
    evidence_matches = matches_collection.count_documents(
        {"analytics.evidence_v1": {"$exists": True}}
    )
    print(f"Matches with evidence_v1: {evidence_matches}")
    print(f"Coverage: {evidence_matches}/{total_matches} ({100 * evidence_matches / total_matches if total_matches > 0 else 0:.1f}%)")

    # Sample one match with evidence
    print("\n" + "=" * 80)
    print("Sample Match with Evidence")
    print("=" * 80)

    sample_match = matches_collection.find_one(
        {"analytics.evidence_v1": {"$exists": True}},
        {
            "gridSeriesId": 1,
            "map": 1,
            "opponentName": 1,
            "analytics.evidence_v1.meta": 1,
            "analytics.evidence_v1.rounds": {"$slice": 3},  # First 3 rounds
            "analytics.evidence_v1.derived.firstBloodStats": 1,
            "analytics.evidence_v1.derived.plantStats": 1,
        }
    )

    if sample_match:
        print(f"Series ID: {sample_match.get('gridSeriesId')}")
        print(f"Map: {sample_match.get('map')}")
        print(f"Opponent: {sample_match.get('opponentName')}")

        evidence = sample_match.get('analytics', {}).get('evidence_v1', {})
        meta = evidence.get('meta', {})
        print(f"\nEvidence Meta:")
        print(f"  - Version: {meta.get('version')}")
        print(f"  - Extracted: {meta.get('extractedAt')}")
        print(f"  - Series ID: {meta.get('seriesId')}")

        rounds = evidence.get('rounds', [])
        print(f"\nTotal Rounds: {len(rounds)}")
        print(f"Sample Rounds (first 3):")
        for i, round_data in enumerate(rounds[:3], 1):
            winner_side = round_data.get('winnerSide', 'N/A')
            print(f"  Round {i}: Winner Team {round_data.get('winnerTeamId')} on {winner_side} side")

        # Check for winnerSide field
        rounds_with_side = sum(1 for r in rounds if r.get('winnerSide'))
        print(f"\nRounds with winnerSide: {rounds_with_side}/{len(rounds)} ({100 * rounds_with_side / len(rounds) if len(rounds) > 0 else 0:.1f}%)")

        # First blood stats
        fb_stats = evidence.get('derived', {}).get('firstBloodStats', [])
        print(f"\nFirst Blood Stats:")
        for stat in fb_stats:
            print(f"  - {stat.get('teamName')}: {stat.get('firstBloods')} FBs, {stat.get('conversionRate', 0) * 100:.1f}% conversion")

        # Plant stats
        plant_stats = evidence.get('derived', {}).get('plantStats', [])
        print(f"\nPlant Stats:")
        for stat in plant_stats:
            print(f"  - {stat.get('teamName')}: {stat.get('plants')} plants, {stat.get('postPlantWinRate', 0) * 100:.1f}% post-plant WR")

    print("\n" + "=" * 80)
    print("Verification Complete!")
    print("=" * 80)

    client.close()

if __name__ == "__main__":
    main()
