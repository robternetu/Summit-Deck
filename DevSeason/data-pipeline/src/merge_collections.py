"""
Merge evidence data from Match collection to matches collection.

The Python ingestion script created documents in 'Match' (capital M),
but Mongoose auto-pluralizes to 'matches' (lowercase).
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
    print("Merging Match to matches Collections")
    print("=" * 80)

    # Check initial state
    match_count = db.Match.count_documents({})
    matches_count = db.matches.count_documents({})
    print(f"\nInitial state:")
    print(f"  Match collection: {match_count} documents")
    print(f"  matches collection: {matches_count} documents")

    # Strategy: Copy all documents from Match to matches, using upsert
    print(f"\nMerging strategy:")
    print(f"  - Copy all {match_count} documents from Match to matches")
    print(f"  - Use gridSeriesId as unique key")
    print(f"  - Upsert to avoid duplicates")

    print(f"\nProcessing...")

    updated_count = 0
    inserted_count = 0
    error_count = 0

    for i, doc in enumerate(db.Match.find({}), 1):
        try:
            grid_series_id = doc.get('gridSeriesId')
            if not grid_series_id:
                print(f"  [WARNING] Document {doc.get('_id')} has no gridSeriesId, skipping")
                error_count += 1
                continue

            # Check if exists in matches
            existing = db.matches.find_one({'gridSeriesId': grid_series_id})

            # Prepare update document (exclude _id from source)
            update_doc = {k: v for k, v in doc.items() if k != '_id'}

            # Upsert into matches collection
            result = db.matches.update_one(
                {'gridSeriesId': grid_series_id},
                {'$set': update_doc},
                upsert=True
            )

            if result.upserted_id:
                inserted_count += 1
                if inserted_count <= 5:
                    print(f"  [INSERT] Series {grid_series_id}")
            elif result.modified_count > 0:
                updated_count += 1
                if updated_count <= 5:
                    print(f"  [UPDATE] Series {grid_series_id}")

        except Exception as e:
            print(f"  [ERROR] Failed to process document {doc.get('_id')}: {e}")
            error_count += 1

    # Final state
    final_matches_count = db.matches.count_documents({})
    final_matches_with_evidence = db.matches.count_documents({'analytics.evidence_v1': {'$exists': True}})

    print(f"\n" + "=" * 80)
    print("Summary")
    print("=" * 80)
    print(f"Documents processed: {match_count}")
    print(f"Inserted: {inserted_count}")
    print(f"Updated: {updated_count}")
    print(f"Errors: {error_count}")
    print(f"\nFinal matches collection:")
    print(f"  Total documents: {final_matches_count}")
    print(f"  With evidence: {final_matches_with_evidence}")
    print(f"  Coverage: {100 * final_matches_with_evidence / final_matches_count if final_matches_count > 0 else 0:.1f}%")

    # Optional: Drop the Match collection after successful merge
    if error_count == 0 and final_matches_with_evidence == match_count:
        print(f"\n✅ Merge successful! All {match_count} documents now in 'matches' with evidence.")
        print(f"\nOptionally, you can drop the 'Match' collection:")
        print(f"  db.Match.drop()")
    else:
        print(f"\n⚠️ Merge completed with {error_count} errors. Review before dropping 'Match' collection.")

    client.close()

if __name__ == "__main__":
    main()
