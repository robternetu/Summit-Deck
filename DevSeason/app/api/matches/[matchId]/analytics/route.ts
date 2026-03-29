import { NextResponse } from 'next/server'
import { connectToDB } from '@/lib/db'
import { Match } from '@/models/Match'
import { computeMatchAnalytics } from '@/lib/analytics/computeMatchAnalytics'

type Props = { params: Promise<{ matchId: string }> }

export async function GET(_req: Request, { params }: Props) {
  const { matchId } = await params
  await connectToDB()
  const match = await Match.findById(matchId).lean()
  if (!match) {
    return NextResponse.json({ message: 'Match not found' }, { status: 404 })
  }
  const analytics = computeMatchAnalytics(match as any)
  return NextResponse.json(analytics)
}
