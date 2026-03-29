## Inspiration

Summit Deck was inspired by a simple problem in competitive play: teams collect a lot of match data, but turning that data into clear, actionable decisions is slow and inconsistent. I wanted to build a system that helps coaches and analysts move from raw events to practical game plans without losing context. The goal was to make review faster, scouting sharper, and pre-match preparation more confident.

## What it does

Summit Deck is an AI-powered Valorant analytics and coaching workspace. It aggregates match data, computes performance metrics, and presents opponent tendencies in a clean dashboard. It also generates AI-assisted coaching insights that connect evidence to recommendations, so teams can quickly identify what happened, why it mattered, and what to adjust next.

## How I built it

I built Summit Deck as a full-stack web app using Next.js 15 (App Router), TypeScript, and Tailwind CSS for the frontend and user experience. MongoDB (via Mongoose) stores match records, analytics output, and derived summaries. A Python data pipeline handles ingestion and transformation of event-level match data, while Google Gemini powers coaching-oriented insight generation. I structured the app into clear modules for auth, match analytics, dashboard stats, scouting views, and AI report generation so each part can evolve independently.

## Challenges I ran into

One major challenge was reliability across data ingestion and analytics consistency. Event-level data can be noisy, and making sure derived stats remained accurate and stable required repeated validation. I also ran into runtime issues during development, including chunk-loading and stale build artifacts that caused page-load failures. Another challenge was balancing detail and usability: presenting enough tactical information for analysts without overwhelming coaches who need quick takeaways.

## Accomplishments that I'm proud of

I am proud of delivering an end-to-end workflow from raw match evidence to coach-ready insights in a single workspace. The platform now supports structured scouting, clear overview metrics, and practical AI-assisted recommendations tied to observable data. I also improved the UI to be more focused and readable, making it easier to move through dashboard, matches, and project context without friction.

## What I learned

I learned that the hardest part is not just collecting data, but designing trustworthy interpretation layers on top of it. Strong schema design and analytics contracts are critical when multiple systems (pipeline, database, frontend, and AI) depend on the same fields. I also learned to prioritize operational stability early, because even small environment mismatches can break developer velocity and confidence in outputs.

## What's next for Summit Deck

Next, I want to deepen tactical intelligence with map-specific and side-specific trend modeling, improve explainability in AI recommendations, and add richer timeline-based visual analysis. I also plan to strengthen collaboration features for coaching staff, expand quality checks in the ingestion pipeline, and introduce more automated validation so every insight can be traced back to reliable evidence.
