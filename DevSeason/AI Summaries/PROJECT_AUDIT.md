# SkyLimit Command - Project Audit

## Current MVP Flow

1. **Landing** (`/`) - User sees intro, clicks "Log in to StratOS"
2. **Login** (`/login`) - Enter credentials (`SkyLimit` / `C9VCT2026Champions`)
3. **Dashboard** (`/dashboard`) - View team overview: total matches, wins, losses, map breakdown
4. **Matches List** (`/matches`) - Browse all matches, click "View" on any row
5. **Match Detail** (`/matches/[matchId]`) - See player K/D stats, click "Generate coaching report"
6. **Coaching Report** - AI generates report following Evidence → Insight → Recommendation format

## Known Gaps

| Area | Status | Notes |
|------|--------|-------|
| LLM Integration | Stubbed | Returns mock report when `COACH_MOCK=true`, throws otherwise |
| Team Overview Stats | Placeholder | `wins`, `attackWinRate`, `defenseWinRate` hardcoded to 50% |
| GRID IDs | Hardcoded | `teamId=79`, `titleId=6` in GraphQL query |
| Per-Round Data | Not implemented | Only series-level player K/D aggregation |

## Commands

```bash
# Install dependencies
npm install

# Development
npm run dev              # Start dev server at http://localhost:3000

# Build & Production
npm run build            # Build for production
npm run start            # Start production server

# Quality
npm run typecheck        # TypeScript check (must pass)
npm run lint             # ESLint

# Data Scripts
npm run seed             # Seed sample matches
npm run grid:list-series # List SkyLimit series from GRID
npm run grid:ingest      # Ingest GRID data to MongoDB
```

## Environment Variables

Copy `.env.example` to `.env.local` and configure:
- `MONGODB_URI` - MongoDB Atlas connection string (required)
- `GRID_API_KEY` - GRID API key (for ingestion scripts)
- `COACH_MOCK=true` - Enable mock coaching reports

