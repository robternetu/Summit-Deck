'use client'

import { useState, useEffect } from 'react'
import { Sparkles, AlertCircle } from 'lucide-react'

interface CoachPanelProps {
  matchId: string
  selectedGameId?: string // Sync with parent's map selection
}

interface GameInfo {
  gameId: string
  mapName: string
  sequenceNumber: number
}

// Enhanced markdown renderer for coaching reports
function renderMarkdown(text: string): JSX.Element {
  const lines = text.split('\n')
  const elements: JSX.Element[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inMetaSection = false
  let metaItems: string[] = []

  const flushList = () => {
    if (listItems.length > 0 && listType) {
      const ListTag = listType
      elements.push(
        <ListTag key={elements.length} className={listType === 'ul' ? 'list-disc pl-6 space-y-3 my-4' : 'list-decimal pl-6 space-y-3 my-4'}>
          {listItems.map((item, i) => (
            <li key={i} className="text-gray-300 leading-relaxed" dangerouslySetInnerHTML={{ __html: formatInline(item) }} />
          ))}
        </ListTag>
      )
      listItems = []
      listType = null
    }
  }

  const flushMeta = () => {
    if (metaItems.length > 0) {
      elements.push(
        <div key={elements.length} className="flex flex-wrap gap-3 mb-6 text-sm">
          {metaItems.map((item, i) => {
            const [label, ...valueParts] = item.split(':')
            const value = valueParts.join(':').trim()
            return (
              <span key={i} className="bg-gray-800/60 px-3 py-1.5 rounded-lg border border-gray-700/50">
                <span className="text-gray-500">{label}:</span>{' '}
                <span className="text-gray-200 font-medium">{value}</span>
              </span>
            )
          })}
        </div>
      )
      metaItems = []
      inMetaSection = false
    }
  }

  const formatInline = (text: string): string => {
    // Bold
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-white">$1</strong>')
    text = text.replace(/__(.+?)__/g, '<strong class="font-semibold text-white">$1</strong>')
    // Italic
    text = text.replace(/\*(.+?)\*/g, '<em class="text-[#ffffff]">$1</em>')
    text = text.replace(/_(.+?)_/g, '<em class="text-[#ffffff]">$1</em>')
    // Percentages - highlight them
    text = text.replace(/(\d+(?:\.\d+)?%)/g, '<span class="text-yellow-400 font-medium">$1</span>')
    // KD ratios like (7K/4D)
    text = text.replace(/\((\d+[KkDd]\/\d+[KkDd])\)/g, '<span class="text-[#e5e7eb] font-mono">($1)</span>')
    // Win rates and specific stats
    text = text.replace(/(\d+W\s*-\s*\d+L)/g, '<span class="text-emerald-400 font-medium">$1</span>')
    return text
  }

  const getSectionIcon = (headerText: string): string => {
    if (headerText.includes('EVIDENCE')) return '📊'
    if (headerText.includes('INSIGHT')) return '💡'
    if (headerText.includes('RECOMMENDATION')) return '🎯'
    return '📋'
  }

  const getSectionColor = (headerText: string): string => {
    if (headerText.includes('EVIDENCE')) return 'text-cyan-400 border-cyan-500/40'
    if (headerText.includes('INSIGHT')) return 'text-purple-400 border-purple-500/40'
    if (headerText.includes('RECOMMENDATION')) return 'text-green-400 border-green-500/40'
    return 'text-[#ffffff] border-[#ffffff]/40'
  }

  const getSectionBg = (headerText: string): string => {
    if (headerText.includes('EVIDENCE')) return 'bg-cyan-500/5'
    if (headerText.includes('INSIGHT')) return 'bg-purple-500/5'
    if (headerText.includes('RECOMMENDATION')) return 'bg-green-500/5'
    return 'bg-[#ffffff]/5'
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    if (!trimmed) {
      flushList()
      flushMeta()
      continue
    }

    // Detect report title (COACHING REPORT: ... or all caps title)
    if (trimmed.match(/^COACHING REPORT:/i) || (i === 0 && trimmed === trimmed.toUpperCase() && trimmed.length > 10 && !trimmed.startsWith('#'))) {
      flushList()
      flushMeta()
      inMetaSection = true
      elements.push(
        <h1 key={elements.length} className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-[#ffffff] via-purple-400 to-cyan-400 mb-4 pb-2">
          {trimmed}
        </h1>
      )
      continue
    }

    // Detect metadata lines (Date:, Map:, Result:, etc.)
    const metaMatch = trimmed.match(/^(Date|Map|Result|Event|Score|Team):\s*(.+)$/i)
    if (metaMatch && (inMetaSection || elements.length <= 2)) {
      metaItems.push(trimmed)
      continue
    }

    // Flush meta when we hit a section header
    if (trimmed.startsWith('#')) {
      flushMeta()
    }

    // Handle ### headers (h3) - commonly used by LLM for EVIDENCE/INSIGHT/RECOMMENDATION
    if (trimmed.startsWith('### ')) {
      flushList()
      flushMeta()
      const headerText = trimmed.slice(4).toUpperCase()
      const colorClass = getSectionColor(headerText)
      const bgClass = getSectionBg(headerText)
      const icon = getSectionIcon(headerText)
      
      elements.push(
        <div key={elements.length} className={`mt-8 mb-4 ${bgClass} -mx-2 px-2 py-1 rounded-lg`}>
          <h3 className={`text-base font-bold ${colorClass} pb-2 border-b flex items-center gap-2`}>
            <span className="text-lg">{icon}</span>
            {headerText}
          </h3>
        </div>
      )
      continue
    }

    // Handle ## headers (h2)
    if (trimmed.startsWith('## ')) {
      flushList()
      flushMeta()
      const headerText = trimmed.slice(3).toUpperCase()
      const colorClass = getSectionColor(headerText)
      const bgClass = getSectionBg(headerText)
      const icon = getSectionIcon(headerText)
      
      elements.push(
        <div key={elements.length} className={`mt-8 mb-4 ${bgClass} -mx-2 px-2 py-1 rounded-lg`}>
          <h2 className={`text-lg font-bold ${colorClass} pb-2 border-b flex items-center gap-2`}>
            <span className="text-lg">{icon}</span>
            {headerText}
          </h2>
        </div>
      )
      continue
    }

    // Handle # headers (h1) - title/report header
    if (trimmed.startsWith('# ')) {
      flushList()
      flushMeta()
      elements.push(
        <h1 key={elements.length} className="text-xl font-bold text-white mt-6 mb-4">
          {trimmed.slice(2)}
        </h1>
      )
      continue
    }

    // Numbered list items
    const numberedMatch = trimmed.match(/^\d+[\.\)]\s+(.+)$/)
    if (numberedMatch) {
      flushMeta()
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
      }
      listItems.push(numberedMatch[1])
      continue
    }

    // Bullet list items (-, *, •)
    const bulletMatch = trimmed.match(/^[\-\*•]\s+(.+)$/)
    if (bulletMatch) {
      flushMeta()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      listItems.push(bulletMatch[1])
      continue
    }

    // Regular paragraphs
    flushList()
    flushMeta()
    elements.push(
      <p key={elements.length} className="text-gray-300 my-3 leading-relaxed" dangerouslySetInnerHTML={{ __html: formatInline(trimmed) }} />
    )
  }

  flushList()
  flushMeta()

  return <>{elements}</>
}

export function CoachPanel({ matchId, selectedGameId: externalGameId }: CoachPanelProps) {
  const [loading, setLoading] = useState(false)
  const [fetchingGames, setFetchingGames] = useState(true)
  const [games, setGames] = useState<GameInfo[]>([])
  const [report, setReport] = useState<string | null>(null)
  const [reportGameId, setReportGameId] = useState<string | null>(null) // Track which game the report is for
  const [error, setError] = useState<string | null>(null)
  const [quotaBanner, setQuotaBanner] = useState<string | null>(null)

  // Use external game ID if provided
  const selectedGameId = externalGameId || games[0]?.gameId || null

  // Fetch available games for this match
  useEffect(() => {
    async function fetchGames() {
      try {
        const res = await fetch(`/api/coach/match?matchId=${matchId}`)
        if (res.ok) {
          const data = await res.json()
          if (data?.evidence?.games) {
            setGames(data.evidence.games)
          }
        }
      } catch (err) {
        console.error('Failed to fetch games:', err)
      } finally {
        setFetchingGames(false)
      }
    }
    fetchGames()
  }, [matchId])

  // Clear report when map changes
  useEffect(() => {
    if (reportGameId && reportGameId !== selectedGameId) {
      setReport(null)
      setReportGameId(null)
    }
  }, [selectedGameId, reportGameId])

  async function handleGenerate() {
    if (!selectedGameId) return
    
    setLoading(true)
    setError(null)
    setQuotaBanner(null)
    setReport(null)

    try {
      const res = await fetch('/api/coach/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, gameId: selectedGameId }),
      })

      if (!res.ok) {
        let msg = 'Failed to generate report'
        try {
          const data = await res.json()
          if (data?.code === 'DAILY_QUOTA_REACHED') {
            setQuotaBanner('AI usage limit reached for today. Please try again after 24 hours.')
          }
          if (data?.error) msg = data.error
        } catch {
          // ignore JSON parse error
        }
        throw new Error(msg)
      }

      const data = await res.json()
      setReport(data.report ?? '')
      setReportGameId(selectedGameId)
    } catch (err: unknown) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Unexpected error')
    } finally {
      setLoading(false)
    }
  }

  const selectedGame = games.find(g => g.gameId === selectedGameId)

  return (
    <section className="card backdrop-blur-xl bg-gray-900/70">
      <div className="px-6 py-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-[#ffffff] rounded-lg flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">AI Coaching Report</h2>
            <p className="text-sm text-gray-400">
              Generate insights for <span className="text-purple-400 capitalize">{selectedGame?.mapName || 'selected map'}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Generate Button */}
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading || !selectedGameId || fetchingGames}
          className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Generating report for {selectedGame?.mapName}...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generate Coaching Report
            </>
          )}
        </button>

        {error && (
          <div className="p-4 border border-red-500/30 rounded-lg bg-red-500/10">
            <div className="flex items-center gap-2 text-red-400 font-medium">
              <AlertCircle className="w-4 h-4" />
              Error generating report
            </div>
            <p className="text-sm text-red-300 mt-1">{error}</p>
          </div>
        )}

        {quotaBanner && (
          <div className="p-4 border border-amber-400/40 rounded-lg bg-amber-500/10">
            <div className="flex items-center gap-2 text-amber-300 font-medium">
              <AlertCircle className="w-4 h-4" />
              Daily AI Limit Reached
            </div>
            <p className="text-sm text-amber-100 mt-1">{quotaBanner}</p>
          </div>
        )}

        {report && (
          <div className="mt-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-6 bg-gradient-to-b from-purple-500 to-[#ffffff] rounded-full" />
              <h3 className="text-lg font-semibold text-white capitalize">
                Coaching Report: {selectedGame?.mapName}
              </h3>
            </div>
            <div className="p-6 rounded-xl bg-black/50 border border-gray-700/50 shadow-xl">
              <div className="prose prose-sm prose-invert max-w-none">
                {renderMarkdown(report)}
              </div>
            </div>
          </div>
        )}

        {!report && !loading && !error && !quotaBanner && (
          <p className="text-sm text-gray-500">
            Click the button above to generate an AI coaching report with 
            <strong className="text-cyan-400"> Evidence</strong>, 
            <strong className="text-purple-400"> Insights</strong>, and 
            <strong className="text-green-400"> Recommendations</strong> for the selected map.
          </p>
        )}
      </div>
    </section>
  )
}
