/**
 * Sprint 6: Interactive Coach Query API Endpoint
 *
 * POST /api/coach/query
 *
 * Enables coaches to ask natural language questions about match data
 * with AI-powered, evidence-based responses.
 */

import { NextRequest, NextResponse } from 'next/server'
import { connectToDB } from '@/lib/db'
import { Match, type MatchDocument } from '@/models/Match'
import { processCoachQuery, SUGGESTED_QUERIES } from '@/lib/ai/interactiveCoach'

export async function POST(request: NextRequest) {
  try {
    await connectToDB()

    const body = await request.json()

    const {
      seriesId,
      gameId,
      query,
      queryType = 'general',
      context
    } = body

    // Validate required fields
    if (!seriesId) {
      return NextResponse.json(
        { error: 'seriesId is required' },
        { status: 400 }
      )
    }

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'query is required and must be a non-empty string' },
        { status: 400 }
      )
    }

    // Validate query type
    const validQueryTypes = ['general', 'what_if', 'player_focus', 'comparison', 'tactical']
    if (!validQueryTypes.includes(queryType)) {
      return NextResponse.json(
        { error: `queryType must be one of: ${validQueryTypes.join(', ')}` },
        { status: 400 }
      )
    }

    // Get match evidence from database
    const match = await Match.findOne({ gridSeriesId: seriesId }).lean() as MatchDocument | null

    if (!match) {
      return NextResponse.json(
        { error: `Match not found for seriesId: ${seriesId}` },
        { status: 404 }
      )
    }

    // Get evidence, filtering by gameId if provided
    let evidence = match.analytics?.evidence_v1

    if (!evidence) {
      return NextResponse.json(
        { error: 'No evidence data available for this match' },
        { status: 404 }
      )
    }

    // Filter by gameId if specified
    if (gameId && evidence.games) {
      const game = evidence.games.find((g: any) => g.gameId === gameId)
      if (!game) {
        return NextResponse.json(
          { error: `Game not found: ${gameId}` },
          { status: 404 }
        )
      }

      // Filter evidence to this game only
      evidence = {
        ...evidence,
        meta: {
          ...evidence.meta,
          filteredForGame: gameId,
          mapName: game.mapName
        },
        rounds: evidence.rounds?.filter((r: any) => r.gameId === gameId) || [],
        kills: evidence.kills?.filter((k: any) => k.gameId === gameId) || [],
        plants: evidence.plants?.filter((p: any) => p.gameId === gameId) || [],
        defuses: evidence.defuses?.filter((d: any) => d.gameId === gameId) || [],
        clutchSituations: evidence.clutchSituations?.filter((c: any) => c.gameId === gameId) || [],
        economyRounds: evidence.economyRounds?.filter((e: any) => e.gameId === gameId) || [],
        abilityUses: evidence.abilityUses?.filter((a: any) => a.gameId === gameId) || [],
      }
    }

    // Process the query
    const response = await processCoachQuery({
      query: query.trim(),
      queryType,
      evidence,
      context
    })

    // Add metadata to response
    return NextResponse.json({
      success: true,
      data: response,
      meta: {
        seriesId,
        gameId: gameId || null,
        queryType,
        timestamp: new Date().toISOString()
      }
    })

  } catch (error: any) {
    console.error('Coach query error:', error)

    // Handle specific error types
    if (error.name === 'MongoNetworkError') {
      return NextResponse.json(
        { error: 'Database connection error. Please try again.' },
        { status: 503 }
      )
    }

    if (error.name === 'SyntaxError') {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'An error occurred processing your query',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      },
      { status: 500 }
    )
  }
}

/**
 * GET /api/coach/query
 *
 * Returns suggested queries and documentation
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const queryType = searchParams.get('queryType') || 'general'

  return NextResponse.json({
    suggestedQueries: SUGGESTED_QUERIES,
    queryTypes: [
      {
        id: 'general',
        label: 'General',
        description: 'Ask about overall match performance, key metrics, and team analysis'
      },
      {
        id: 'what_if',
        label: 'What If',
        description: 'Explore alternative scenarios - economy decisions, site choices, timing'
      },
      {
        id: 'player_focus',
        label: 'Player Focus',
        description: 'Deep dive into individual player performance, matchups, and impact'
      },
      {
        id: 'comparison',
        label: 'Comparison',
        description: 'Compare team performance, benchmark against pro standards'
      },
      {
        id: 'tactical',
        label: 'Tactical',
        description: 'Analyze execute patterns, defensive setups, and strategic tendencies'
      }
    ],
    documentation: {
      endpoint: '/api/coach/query',
      method: 'POST',
      body: {
        seriesId: 'string (required) - Match series ID',
        gameId: 'string (optional) - Filter to specific map',
        query: 'string (required) - Natural language question',
        queryType: 'string (optional) - One of: general, what_if, player_focus, comparison, tactical',
        context: {
          playerNames: 'string[] (optional) - Focus on specific players',
          roundNumbers: 'number[] (optional) - Focus on specific rounds',
          sites: 'string[] (optional) - Focus on specific sites',
          focusArea: 'string (optional) - Additional context'
        }
      },
      response: {
        answer: 'Direct answer with data citations',
        evidence: {
          dataPoints: 'Array of metrics with values and context',
          relevantRounds: 'Round numbers referenced',
          relevantPlayers: 'Players referenced'
        },
        insight: 'Tactical interpretation',
        recommendations: 'Actionable advice',
        confidence: 'high | medium | low',
        suggestedFollowUps: 'Related questions to explore'
      }
    }
  })
}
