"""
Update player names in MongoDB matches from evidence_v1 data.
"""
import os
import sys
from pymongo import MongoClient

def main():
    mongo_uri = os.getenv("MONGODB_URI")
    if not mongo_uri:
        print("ERROR: MONGODB_URI environment variable not set")
        sys.exit(1)

    client = MongoClient(mongo_uri)
    db = client["c9-stratos"]

    print("=" * 80)
    print("Updating Player Names from Evidence")
    print("=" * 80)

    # Find all matches with evidence
    matches_with_evidence = db.matches.find({"analytics.evidence_v1": {"$exists": True}})

    updated_count = 0
    skipped_count = 0

    for match in matches_with_evidence:
        evidence = match.get("analytics", {}).get("evidence_v1", {})
        ev_players = evidence.get("players", [])

        if not ev_players:
            skipped_count += 1
            continue

        # Build player name updates
        match_players = match.get("players", [])
        updates_needed = False

        for match_player in match_players:
            player_id = match_player.get("playerId")
            # Find this player in evidence
            ev_player = next((p for p in ev_players if p.get("playerId") == player_id), None)
            if ev_player and ev_player.get("playerName"):
                # Update the player name
                match_player["playerName"] = ev_player["playerName"]
                updates_needed = True

        if updates_needed:
            # Update the match in MongoDB
            result = db.matches.update_one(
                {"_id": match["_id"]},
                {"$set": {"players": match_players}}
            )
            updated_count += 1
            if updated_count <= 5:
                print(f"  Updated match {match.get('gridSeriesId')} - {len(match_players)} players")
        else:
            skipped_count += 1

    print(f"\n" + "=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"Matches updated: {updated_count}")
    print(f"Matches skipped: {skipped_count}")
    print(f"Total processed: {updated_count + skipped_count}")

    client.close()

if __name__ == "__main__":
    main()
