# Summit Deck

Summit Deck is an AI-powered Valorant analytics and coaching workspace built for fast review, opponent scouting, and coach-ready decision support.

## Project Layout

- `DevSeason/` - Main Next.js application, APIs, data pipeline scripts, and assets
- `frontend/` - Additional frontend workspace

## Core Stack

- Next.js 15 (App Router)
- TypeScript + React
- Tailwind CSS
- MongoDB (Mongoose)
- Python data pipeline
- Google Gemini integration

## Quick Start

1. Go to the app workspace:
   - `cd DevSeason`
2. Install dependencies:
   - `npm install`
3. Configure environment:
   - create `.env.local`
   - set `MONGODB_URI`
4. Run development server:
   - `npm run dev`

## Main Commands (DevSeason)

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run lint checks
- `npm run typecheck` - Run TypeScript checks

## Notes

Detailed app-level documentation is available in `DevSeason/README.md`.
