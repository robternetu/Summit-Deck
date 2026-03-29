'use client'

import { useState } from 'react'

type MatchCoachPanelProps = {
  matchId: string
}

export function MatchCoachPanel({ matchId }: MatchCoachPanelProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)

  const handleGenerateReport = async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/coach-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error ?? 'Failed to generate report')
      }

      setReport(data.report ?? 'No report returned.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate report')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-lg border bg-white shadow-sm">
      <div className="border-b px-4 py-3">
        <h2 className="text-lg font-medium text-gray-900">AI Coaching Report</h2>
        <p className="text-sm text-gray-600">Generate AI-powered coaching insights for this match.</p>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={loading}
            className="rounded-md bg-[#ffffff] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#d4d4d4] disabled:cursor-not-allowed disabled:bg-[#ffffff]"
          >
            {loading ? 'Generating...' : 'Generate coaching report'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>

        {loading && (
          <div className="text-sm text-gray-600">Generating coaching report...</div>
        )}

        {report && (
          <div className="max-h-96 overflow-y-auto rounded-md border bg-gray-50 p-4">
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">
              {report}
            </pre>
          </div>
        )}

        {!report && !loading && (
          <p className="text-sm text-gray-500">
            Click the button above to generate an AI coaching report based on match analytics.
          </p>
        )}
      </div>
    </section>
  )
}
