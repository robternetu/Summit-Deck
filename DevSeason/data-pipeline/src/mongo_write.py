"""
MongoDB client for writing analytics results.
"""

from typing import Dict

from pymongo import MongoClient
from pymongo.database import Database


def load_mongo(uri: str) -> MongoClient:
    """
    Connect to MongoDB and return client.
    """
    return MongoClient(uri)


def upsert_match_analytics(uri: str, series_id: str, payload_dict: Dict) -> bool:
    """
    Update match document with advanced analytics.

    Updates matches where gridMatchId == str(series_id):
        $set: { "analytics.advanced": payload_dict }

    Returns True if document was found and updated, False otherwise.
    """
    client = load_mongo(uri)

    try:
        db: Database = client["c9-stratos"]
        matches_collection = db["matches"]

        # Find and update the match by gridMatchId
        result = matches_collection.update_one(
            {"gridMatchId": str(series_id)},
            {"$set": {"analytics.advanced": payload_dict}}
        )

        return result.matched_count > 0

    finally:
        client.close()
