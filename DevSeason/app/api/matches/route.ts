import { NextResponse } from 'next/server'

import { connectToDB } from '@/lib/db'
import { Match } from '@/models/Match'

export async function GET() {
  try {
    await connectToDB()
    const matches = await Match.find({}).sort({ date: -1 }).lean()
    return NextResponse.json(matches, { status: 200 })
  } catch (error) {
    console.error('Failed to fetch matches', error)
    return NextResponse.json({ message: 'Failed to fetch matches' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch (error) {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 })
  }

  const { gridMatchId, team, opponentName, map, eventName, date, rawData = null } = body ?? {}

  if (!gridMatchId || !team || !opponentName || !map || !eventName || !date) {
    return NextResponse.json({ message: 'Missing required fields' }, { status: 400 })
  }

  const parsedDate = new Date(date)
  if (isNaN(parsedDate.getTime())) {
    return NextResponse.json({ message: 'Invalid date' }, { status: 400 })
  }

  try {
    await connectToDB()
    const created = await Match.create({
      gridMatchId,
      team,
      opponentName,
      map,
      eventName,
      date: parsedDate,
      rawData,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    console.error('Failed to save match', error)
    if (error?.code === 11000) {
      return NextResponse.json({ message: 'Duplicate gridMatchId' }, { status: 409 })
    }
    return NextResponse.json({ message: 'Failed to save match' }, { status: 500 })
  }
}
