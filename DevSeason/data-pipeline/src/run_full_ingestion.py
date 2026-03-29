#!/usr/bin/env python
"""
Run full evidence_v1 ingestion for all series.
Sets up environment and calls ingest_evidence_v1_to_mongo.py
"""
import os
import sys
from pathlib import Path

# Require secure env var setup from caller instead of embedding credentials.
if not os.getenv('MONGODB_URI'):
    raise RuntimeError('MONGODB_URI is required. Set it in your environment before running this script.')

os.environ.setdefault('GRID_HOT_ROOT', r'E:\A-c9-StratOS\grid-cache\hot')

# Change to script directory
script_dir = Path(__file__).parent
os.chdir(script_dir)

# Import and run the ingestion
from ingest_evidence_v1_to_mongo import main

if __name__ == "__main__":
    # Override sys.argv to set years
    sys.argv = ['ingest_evidence_v1_to_mongo.py', '--years', '2024,2025']
    main()
