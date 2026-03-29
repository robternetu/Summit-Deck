const FILE_DOWNLOAD_BASE = 'https://api.grid.gg/file-download'

export interface FileDownloadEntry {
  id: string
  description: string
  status: string
  fileName: string
  fullURL: string
}

export interface FileDownloadList {
  files: FileDownloadEntry[]
}

export async function listSeriesFiles(seriesId: string): Promise<FileDownloadList> {
  const apiKey = process.env.GRID_API_KEY
  if (!apiKey) {
    throw new Error(
      'GRID_API_KEY is not set. Add it to .env.local to enable GRID File Download access.'
    )
  }

  const url = `${FILE_DOWNLOAD_BASE}/list/${seriesId}`

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
    },
  })

  if (!response.ok) {
    const bodyText = await response.text()
    throw new Error(
      `GRID File Download request failed: ${response.status} ${response.statusText} - ${bodyText}`
    )
  }

  const json = await response.json()

  return json as FileDownloadList
}
