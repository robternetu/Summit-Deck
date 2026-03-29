export interface GridMatchPayload {
  // TODO: Replace `any` shape with the actual GRID match response once available.
  [key: string]: any
}

export async function fetchGridMatch(gridMatchId: string): Promise<GridMatchPayload> {
  const apiKey = process.env.GRID_API_KEY
  const baseUrl = process.env.GRID_API_BASE_URL

  if (!apiKey) {
    throw new Error('GRID_API_KEY is not set. Please configure it to enable GRID integration.')
  }

  if (!baseUrl) {
    throw new Error('GRID_API_BASE_URL is not set. Please configure it to enable GRID integration.')
  }

  // TODO: Replace this stub with a real HTTP call to the GRID API once the
  // credentials and endpoint documentation are available.
  // Example:
  // const response = await fetch(`${baseUrl}/matches/${gridMatchId}`, { headers: { Authorization: `Bearer ${apiKey}` } })
  // if (!response.ok) { throw new Error('Failed to fetch GRID match') }
  // return response.json()

  return {
    gridMatchId,
    opponentName: 'Unknown Opponent',
    map: 'Unknown Map',
    eventName: 'Unknown Event',
    date: new Date().toISOString(),
    rawData: { stub: true },
  }
}
