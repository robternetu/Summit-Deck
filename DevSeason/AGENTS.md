# SkyLimit Command – AI Engineering Guide

This repository is an AI-assisted engineering project that uses Next.js 15, MongoDB, and Junie/Claude Code to build a Valorant analytics and coaching platform for competitive review workflows.

## Purpose

SkyLimit Command is designed for pro-level Valorant coaching. It ingests match data from GRID API, computes analytics, and generates AI-driven coaching insights for the featured team tracked by this repo.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router, TypeScript) |
| Database | MongoDB Atlas via Mongoose |
| AI | Google Gemini 2.5 Flash |
| Data Pipeline | Python (GRID event extraction) |
| Styling | Tailwind CSS |

## Project Structure

```
├── app/                    # Next.js pages and API routes
│   ├── (main)/            # Main app routes (dashboard, matches)
│   └── api/               # API endpoints
├── components/            # React components
│   ├── matches/          # Match-specific components
│   └── ui/               # Reusable UI components
├── data-pipeline/         # Python data extraction
│   └── src/              # Pipeline scripts
├── lib/                   # Shared utilities
│   ├── ai/               # LLM integration
│   ├── analytics/        # Computation functions
│   └── grid/             # GRID API clients
├── models/                # Mongoose schemas
└── .claude/               # Claude Code configuration
    ├── agents/           # Specialized AI agents
    ├── skills/           # Domain knowledge
    └── commands/         # Custom slash commands
```

## Claude Code Integration

### Agents (`.claude/agents/`)

| Agent | Use When |
|-------|----------|
| `@data-pipeline-engineer` | Working on Python extraction, GRID API, MongoDB ingestion |
| `@valorant-analyst` | Analyzing match data, creating coaching insights |
| `@schema-guardian` | Modifying data schemas, types, or contracts |
| `@frontend-developer` | Creating/modifying React components, UI |
| `@backend-developer` | Working on API routes, MongoDB queries |

### Skills (`.claude/skills/`)

| Skill | Content |
|-------|---------|
| `grid-api.md` | GRID event types, data locations, coordinate system |
| `evidence-schema.md` | Complete Evidence V1 schema reference |
| `coaching-format.md` | Evidence → Insight → Recommendation format |

### Commands (`.claude/commands/`)

| Command | Description |
|---------|-------------|
| `/validate-evidence` | Validate MongoDB ingestion status |
| `/add-stat-display` | Guide for adding new stat sections to UI |
| `/run-ingestion` | Full data pipeline execution guide |

## Key IDs

- **Featured Team ID**: `'79'`
- **Database**: `c9-stratos`
- **Collection**: `matches`

## Data Flow

```
GRID API Events → Python Extraction → evidence_v1.json → MongoDB → Next.js API → React UI
                                                              ↓
                                                         Gemini LLM → Coaching Report
```

## Coaching Output Format

All coaching insights must follow:

1. **Evidence**: Specific statistics with numbers
2. **Insight**: Tactical interpretation
3. **Recommendation**: Actionable advice

## Development Commands

```bash
# Start development server
npm run dev

# Type checking
npm run typecheck

# Build
npm run build

# Run data pipeline
cd data-pipeline/src
python batch_extract_evidence_v1.py --hot-dir "E:\A-c9-StratOS\grid-cache\hot" --reprocess
python ingest_evidence_v1_to_mongo.py
```

## MCP Servers

Claude Code has access to:
- **MongoDB**: Direct database queries via `mongodb-mcp-server`
- **Filesystem**: Project files and GRID cache via `@modelcontextprotocol/server-filesystem`

## Coding Conventions

- TypeScript for all modules
- Server Components for data fetching
- Client Components only for interactivity
- Analytics logic in dedicated functions, not API routes
- camelCase for functions, PascalCase for models
- Always preserve backward compatibility in schema changes

## File Locations

| Data | Location |
|------|----------|
| Hot cache | `E:/A-c9-StratOS/grid-cache/hot/` |
| Cold archive | `F:/grid-archive/` |
| Pipeline output | `data-pipeline/src/out/` |

---

*This project is part of an internal rapid-build sprint.*
