function getApiKey(): string {
  const apiKey = process.env.GRID_API_KEY
  if (!apiKey) {
    throw new Error('GRID_API_KEY is not set. Add it to .env.local to enable GRID API access.')
  }
  return apiKey
}

type GraphQLResponse<T> = {
  data?: T
  errors?: Array<{ message: string }>
}

export async function gridGraphQL<T>(
  url: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const apiKey = getApiKey()

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(`GRID GraphQL request failed: ${response.status} ${response.statusText} - ${bodyText}`)
  }

  const json = (await response.json()) as GraphQLResponse<T>

  if (json.errors && json.errors.length > 0) {
    throw new Error(`GRID GraphQL error: ${json.errors[0].message}`)
  }

  if (!json.data) {
    throw new Error('GRID GraphQL response missing data field')
  }

  return json.data
}

export async function gridGetJson<T>(url: string): Promise<T> {
  const apiKey = getApiKey()

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
    },
  })

  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(`GRID GET request failed: ${response.status} ${response.statusText} - ${bodyText}`)
  }

  return (await response.json()) as T
}
