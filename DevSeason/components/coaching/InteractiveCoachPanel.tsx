'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageSquare, Send, Lightbulb, ArrowRight, ChevronDown, Loader2 } from 'lucide-react'

// =============================================================================
// Types
// =============================================================================

interface DataPoint {
  metric: string
  value: string | number
  context: string
}

interface CoachResponse {
  answer: string
  evidence: {
    dataPoints: DataPoint[]
    relevantRounds?: number[]
    relevantPlayers?: string[]
  }
  insight: string
  recommendations?: string[]
  confidence: 'high' | 'medium' | 'low'
  suggestedFollowUps?: string[]
}

interface Message {
  id: string
  type: 'user' | 'coach'
  content: string
  queryType?: string
  response?: CoachResponse
  timestamp: Date
}

interface InteractiveCoachPanelProps {
  seriesId: string
  gameId?: string
  initialMessages?: Message[]
}

type QueryType = 'general' | 'what_if' | 'player_focus' | 'comparison' | 'tactical'

const QUERY_TYPES: { id: QueryType; label: string; description: string; icon: string }[] = [
  { id: 'general', label: 'General', description: 'Overall analysis', icon: '📊' },
  { id: 'what_if', label: 'What If', description: 'Scenarios', icon: '🔮' },
  { id: 'player_focus', label: 'Player', description: 'Individual', icon: '👤' },
  { id: 'tactical', label: 'Tactical', description: 'Strategy', icon: '🎯' },
  { id: 'comparison', label: 'Compare', description: 'Benchmarks', icon: '📈' },
]

const SUGGESTED_QUERIES: Record<QueryType, string[]> = {
  general: [
    "What were our biggest weaknesses?",
    "Which player had the most impact?",
    "How did our economy compare?"
  ],
  what_if: [
    "What if we saved instead of forcing?",
    "What if we attacked B instead of A?",
    "How did force buys affect us?"
  ],
  player_focus: [
    "How did our IGL perform in clutches?",
    "Who had the best opening duels?",
    "What was each player's ADR?"
  ],
  tactical: [
    "Which executes were most successful?",
    "How predictable were we?",
    "What defensive setups worked best?"
  ],
  comparison: [
    "How do we compare to pro teams?",
    "Is our clutch rate above average?",
    "Are we at pro level on trades?"
  ]
}

// =============================================================================
// Helper Components
// =============================================================================

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const colors = {
    high: 'bg-green-500/20 text-green-400 border-green-500/30',
    medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    low: 'bg-red-500/20 text-red-400 border-red-500/30'
  }

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[confidence]}`}>
      {confidence} confidence
    </span>
  )
}

function DataPointCard({ dataPoint }: { dataPoint: DataPoint }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
      <div className="flex justify-between items-start">
        <span className="text-sm text-gray-400">{dataPoint.metric}</span>
        <span className="text-sm font-mono text-cyan-400">{dataPoint.value}</span>
      </div>
      <p className="text-xs text-gray-500 mt-1">{dataPoint.context}</p>
    </div>
  )
}

function CoachMessageContent({ response }: { response: CoachResponse }) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="space-y-4">
      {/* Main Answer */}
      <div className="text-gray-200 whitespace-pre-wrap leading-relaxed">
        {response.answer}
      </div>

      {/* Confidence Badge */}
      <div className="flex items-center gap-2">
        <ConfidenceBadge confidence={response.confidence} />
        {response.evidence.relevantRounds && response.evidence.relevantRounds.length > 0 && (
          <span className="text-xs text-gray-500">
            Rounds: {response.evidence.relevantRounds.join(', ')}
          </span>
        )}
      </div>

      {/* Insight */}
      {response.insight && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 text-purple-400 text-sm font-medium mb-1">
            <Lightbulb className="w-4 h-4" />
            Insight
          </div>
          <p className="text-sm text-gray-300">{response.insight}</p>
        </div>
      )}

      {/* Expandable Details */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors"
      >
        <ChevronDown className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
        {showDetails ? 'Hide details' : 'Show data points & recommendations'}
      </button>

      {showDetails && (
        <div className="space-y-4 animate-in slide-in-from-top-2">
          {/* Data Points */}
          {response.evidence.dataPoints.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-gray-400 mb-2">Supporting Data</h4>
              <div className="grid gap-2">
                {response.evidence.dataPoints.map((dp, i) => (
                  <DataPointCard key={i} dataPoint={dp} />
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {response.recommendations && response.recommendations.length > 0 && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3">
              <h4 className="text-sm font-medium text-green-400 mb-2">Recommendations</h4>
              <ul className="space-y-1">
                {response.recommendations.map((rec, i) => (
                  <li key={i} className="text-sm text-gray-300 flex items-start gap-2">
                    <ArrowRight className="w-3 h-3 text-green-400 mt-1 flex-shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Suggested Follow-ups */}
      {response.suggestedFollowUps && response.suggestedFollowUps.length > 0 && (
        <div className="pt-2 border-t border-gray-700/50">
          <p className="text-xs text-gray-500 mb-2">Follow-up questions:</p>
          <div className="flex flex-wrap gap-2">
            {response.suggestedFollowUps.slice(0, 3).map((q, i) => (
              <button
                key={i}
                className="text-xs bg-gray-700/50 hover:bg-gray-600/50 text-gray-300 px-2 py-1 rounded-full transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Main Component
// =============================================================================

export function InteractiveCoachPanel({ seriesId, gameId, initialMessages = [] }: InteractiveCoachPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [queryType, setQueryType] = useState<QueryType>('general')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSubmit(e?: React.FormEvent, customQuery?: string) {
    if (e) e.preventDefault()

    const query = customQuery || input.trim()
    if (!query || loading) return

    // Add user message
    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: query,
      queryType,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/coach/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seriesId,
          gameId,
          query,
          queryType
        })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to get response')
      }

      const data = await res.json()

      // Add coach response
      const coachMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'coach',
        content: data.data?.answer || 'No response generated.',
        response: data.data,
        timestamp: new Date()
      }

      setMessages(prev => [...prev, coachMessage])
    } catch (err) {
      console.error('Coach query error:', err)
      setError(err instanceof Error ? err.message : 'Failed to process query')

      // Add error message
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        type: 'coach',
        content: 'Sorry, I encountered an error processing your question. Please try again.',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  function handleSuggestedQuery(query: string) {
    setInput(query)
    handleSubmit(undefined, query)
  }

  return (
    <div className="flex flex-col h-full bg-gray-900/70 backdrop-blur-xl rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
        <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-purple-500 rounded-lg flex items-center justify-center">
          <MessageSquare className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Interactive Coach</h3>
          <p className="text-xs text-gray-500">Ask questions about the match</p>
        </div>
      </div>

      {/* Query Type Selector */}
      <div className="px-4 py-2 border-b border-gray-800/50 flex gap-2 overflow-x-auto">
        {QUERY_TYPES.map((qt) => (
          <button
            key={qt.id}
            onClick={() => setQueryType(qt.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              queryType === qt.id
                ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                : 'bg-gray-800/50 text-gray-400 border border-gray-700/50 hover:bg-gray-700/50'
            }`}
          >
            <span>{qt.icon}</span>
            {qt.label}
          </button>
        ))}
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-12 h-12 text-gray-700 mx-auto mb-4" />
            <h4 className="text-gray-400 font-medium mb-2">Ask me anything about the match</h4>
            <p className="text-gray-600 text-sm mb-6">
              I can analyze performance, explore scenarios, and provide coaching insights.
            </p>

            {/* Suggested Queries */}
            <div className="space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Suggested questions:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTED_QUERIES[queryType].map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestedQuery(q)}
                    className="text-sm bg-gray-800/70 hover:bg-gray-700/70 text-gray-300 px-3 py-1.5 rounded-full border border-gray-700/50 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl px-4 py-3 ${
                    msg.type === 'user'
                      ? 'bg-cyan-500/20 border border-cyan-500/30 text-gray-200'
                      : 'bg-gray-800/70 border border-gray-700/50'
                  }`}
                >
                  {msg.type === 'user' ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : msg.response ? (
                    <CoachMessageContent response={msg.response} />
                  ) : (
                    <p className="text-sm text-gray-300">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-800/70 border border-gray-700/50 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 text-gray-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Analyzing match data...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-t border-red-500/30">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask a ${queryType.replace('_', '-')} question...`}
            disabled={loading}
            className="flex-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg px-4 py-2 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  )
}

export default InteractiveCoachPanel
