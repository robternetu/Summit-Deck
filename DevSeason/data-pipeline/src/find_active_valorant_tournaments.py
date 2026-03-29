import requests
import os
from dotenv import load_dotenv

# Load environment variables from .env.local
load_dotenv(".env.local")

GRID_API_KEY = os.getenv("GRID_API_KEY")
if not GRID_API_KEY:
    raise ValueError("GRID_API_KEY not found in environment. Check your .env.local file.")

CENTRAL_DATA_URL = "https://api-op.grid.gg/central-data/graphql"

HEADERS = {
    "Content-Type": "application/json",
    "x-api-key": GRID_API_KEY,
}

# Paste the tournament IDs you already discovered
TOURNAMENT_IDS = [
    "757073","757074","757101","757234","757235","757320","757321",
    "757371","757372","757481","757482","757581","757584","757614",
    "757615","757616","757619","757628","757629","758114",
    "774782","774783","774784","774785","774786","774787",
    "775516","775517","775518",
    "800675","800676","800677","800678","800679","800680",
    "826660","826661","826662","826663","826991","826992",
]

"""Complete list of valorant tournaments with matches can be found at:

✓ Tournament 757073 -> 5 series
✓ Tournament 757074 -> 3 series
✓ Tournament 757101 -> 3 series
✓ Tournament 757234 -> 10 series
✓ Tournament 757235 -> 6 series
✓ Tournament 757321 -> 8 series
✓ Tournament 757628 -> 5 series
✓ Tournament 757629 -> 3 series
✓ Tournament 758114 -> 30 series

✓ Tournament 774784 -> 15 series
✓ Tournament 774785 -> 10 series
✓ Tournament 774787 -> 8 series
✓ Tournament 775518 -> 22 series
✓ Tournament 800677 -> 15 series
✓ Tournament 800678 -> 15 series
✓ Tournament 800680 -> 12 series
✓ Tournament 826662 -> 15 series
✓ Tournament 826663 -> 15 series
✓ Tournament 826992 -> 12 series




"""



QUERY = """
query ($tournamentId: [ID!]!) {
  allSeries(
    filter: {
      tournamentIds: { in: $tournamentId }
      titleId: "6"
    }
    first: 1
  ) {
    totalCount
  }
}
"""

def check_tournament(tournament_id: str):
    payload = {
        "query": QUERY,
        "variables": {
            "tournamentId": [tournament_id]
        }
    }

    resp = requests.post(CENTRAL_DATA_URL, headers=HEADERS, json=payload)
    resp.raise_for_status()
    data = resp.json()

    # Check for GraphQL errors
    if "errors" in data:
        raise Exception(f"GraphQL error: {data['errors']}")

    # Defensive parsing
    if not data.get("data"):
        raise Exception(f"Missing 'data' in response: {data}")

    if not data["data"].get("allSeries"):
        raise Exception(f"Missing 'allSeries' in response: {data}")

    return data["data"]["allSeries"]["totalCount"]

def main():
    print("\nActive Valorant Tournaments (with matches):\n")

    for tid in TOURNAMENT_IDS:
        try:
            count = check_tournament(tid)
            if count > 0:
                print(f"✓ Tournament {tid} -> {count} series")
        except Exception as e:
            print(f"✗ Tournament {tid} failed: {e}")

if __name__ == "__main__":
    main()
