import { NextResponse } from 'next/server'
import { Types } from 'mongoose'

import { connectToDB } from '@/lib/db'
import { fetchGridMatch } from '@/lib/gridClient'
import { Match } from '@/models/Match'

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch (error) {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
  }

  const { gridMatchId } = body ?? {}

  if (!gridMatchId) {
    return NextResponse.json({ message: 'Missing gridMatchId' }, { status: 400 })
  }

  try {
    const payload = await fetchGridMatch(gridMatchId)
    const teamIdentifier = (payload as any)?.team ?? (payload as any)?.teamId
    const parsedDate = new Date((payload as any)?.date ?? Date.now())

    const matchToCreate = {
      gridMatchId,
      team: teamIdentifier ? new Types.ObjectId(teamIdentifier) : new Types.ObjectId(),
      opponentName: (payload as any)?.opponentName ?? 'Unknown Opponent',
      map: (payload as any)?.map ?? 'Unknown Map',
      eventName: (payload as any)?.eventName ?? 'Unknown Event',
      date: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
      rawData: payload ?? null,
    }

    await connectToDB()
    const created = await Match.create(matchToCreate)

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    console.error('Failed to import match from GRID', error)
    return NextResponse.json({ message: error?.message ?? 'Failed to import match' }, { status: 500 })
  }
}
