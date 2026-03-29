/**
 * Sprint 6: Prompt Length Management
 *
 * Manages LLM prompt lengths to stay within token limits while
 * preserving the most important information.
 */

// =============================================================================
// Types
// =============================================================================

export interface TokenBudget {
  maxTokens: number
  reservedForResponse: number
  systemPromptTokens: number
  availableForContext: number
}

export interface ContentSection {
  id: string
  content: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  estimatedTokens: number
  category: 'overview' | 'stats' | 'details' | 'recommendations' | 'raw_data'
}

export interface TruncationResult {
  content: string
  includedSections: string[]
  excludedSections: string[]
  totalTokens: number
  truncated: boolean
  truncationReason?: string
}

// =============================================================================
// Token Estimation
// =============================================================================

/**
 * Rough token estimation (approximately 4 characters per token for English)
 * This is a heuristic - actual token counts vary by model
 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  // More accurate estimation:
  // - Words average ~1.3 tokens
  // - Numbers and special chars ~0.5 tokens each

  const words = text.split(/\s+/).length
  const numbers = (text.match(/\d+/g) || []).length
  const specialChars = (text.match(/[^\w\s]/g) || []).length

  return Math.ceil(words * 1.3 + numbers * 0.5 + specialChars * 0.3)
}

/**
 * Get default token budget for different use cases
 */
export function getTokenBudget(useCase: 'coaching_report' | 'interactive_query' | 'what_if'): TokenBudget {
  const budgets: Record<string, TokenBudget> = {
    coaching_report: {
      maxTokens: 8000,
      reservedForResponse: 2000,
      systemPromptTokens: 500,
      availableForContext: 5500
    },
    interactive_query: {
      maxTokens: 4000,
      reservedForResponse: 1000,
      systemPromptTokens: 300,
      availableForContext: 2700
    },
    what_if: {
      maxTokens: 4000,
      reservedForResponse: 800,
      systemPromptTokens: 400,
      availableForContext: 2800
    }
  }

  return budgets[useCase] || budgets.interactive_query
}

// =============================================================================
// Content Sectioning
// =============================================================================

/**
 * Split content into prioritized sections
 */
export function sectionContent(content: string, type: 'stats' | 'evidence' | 'report'): ContentSection[] {
  const sections: ContentSection[] = []
  const lines = content.split('\n')

  let currentSection: ContentSection | null = null
  let currentContent: string[] = []

  const flushSection = () => {
    if (currentSection && currentContent.length > 0) {
      currentSection.content = currentContent.join('\n')
      currentSection.estimatedTokens = estimateTokens(currentSection.content)
      sections.push(currentSection)
    }
    currentContent = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    // Detect section headers
    if (trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
      flushSection()

      const headerText = trimmed.replace(/^#+\s*/, '').toLowerCase()

      // Determine priority based on header
      let priority: ContentSection['priority'] = 'medium'
      let category: ContentSection['category'] = 'stats'

      if (headerText.includes('overview') || headerText.includes('summary')) {
        priority = 'critical'
        category = 'overview'
      } else if (headerText.includes('recommendation') || headerText.includes('action')) {
        priority = 'high'
        category = 'recommendations'
      } else if (headerText.includes('evidence') || headerText.includes('insight')) {
        priority = 'high'
        category = 'stats'
      } else if (headerText.includes('raw') || headerText.includes('detail')) {
        priority = 'low'
        category = 'raw_data'
      }

      currentSection = {
        id: headerText.replace(/\s+/g, '_').slice(0, 30),
        content: '',
        priority,
        estimatedTokens: 0,
        category
      }
      currentContent.push(line)
    } else if (currentSection) {
      currentContent.push(line)
    } else {
      // Content before any section header
      if (!currentSection) {
        currentSection = {
          id: 'intro',
          content: '',
          priority: 'critical',
          estimatedTokens: 0,
          category: 'overview'
        }
      }
      currentContent.push(line)
    }
  }

  flushSection()

  return sections
}

// =============================================================================
// Truncation Logic
// =============================================================================

/**
 * Truncate content to fit within token budget
 */
export function truncateToFit(
  sections: ContentSection[],
  budget: TokenBudget,
  options: {
    preserveHeaders?: boolean
    minSectionsPerCategory?: number
  } = {}
): TruncationResult {
  const { preserveHeaders = true, minSectionsPerCategory = 1 } = options

  // Sort by priority
  const priorityOrder: Record<ContentSection['priority'], number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3
  }

  const sortedSections = [...sections].sort((a, b) => {
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  })

  const includedSections: ContentSection[] = []
  const excludedSections: string[] = []
  let totalTokens = 0

  // Track categories to ensure minimum coverage
  const categoryCount: Record<string, number> = {}

  // First pass: include critical and high-priority sections
  for (const section of sortedSections) {
    if (section.priority === 'critical' || section.priority === 'high') {
      if (totalTokens + section.estimatedTokens <= budget.availableForContext) {
        includedSections.push(section)
        totalTokens += section.estimatedTokens
        categoryCount[section.category] = (categoryCount[section.category] || 0) + 1
      } else {
        // Try to include a truncated version
        const truncated = truncateSection(section, budget.availableForContext - totalTokens)
        if (truncated) {
          includedSections.push(truncated)
          totalTokens += truncated.estimatedTokens
          categoryCount[section.category] = (categoryCount[section.category] || 0) + 1
        } else {
          excludedSections.push(section.id)
        }
      }
    }
  }

  // Second pass: include medium/low priority if space allows
  for (const section of sortedSections) {
    if (section.priority === 'medium' || section.priority === 'low') {
      const currentCategoryCount = categoryCount[section.category] || 0

      // Prioritize categories with no representation
      const priorityBoost = currentCategoryCount < minSectionsPerCategory ? 1000 : 0

      if (totalTokens + section.estimatedTokens <= budget.availableForContext) {
        includedSections.push(section)
        totalTokens += section.estimatedTokens
        categoryCount[section.category] = currentCategoryCount + 1
      } else if (priorityBoost > 0) {
        // Try to include a truncated version for underrepresented categories
        const truncated = truncateSection(section, Math.min(500, budget.availableForContext - totalTokens))
        if (truncated) {
          includedSections.push(truncated)
          totalTokens += truncated.estimatedTokens
          categoryCount[section.category] = currentCategoryCount + 1
        } else {
          excludedSections.push(section.id)
        }
      } else {
        excludedSections.push(section.id)
      }
    }
  }

  // Reassemble content
  const content = includedSections.map(s => s.content).join('\n\n')

  return {
    content,
    includedSections: includedSections.map(s => s.id),
    excludedSections,
    totalTokens,
    truncated: excludedSections.length > 0,
    truncationReason: excludedSections.length > 0
      ? `Excluded ${excludedSections.length} low-priority sections to fit token budget`
      : undefined
  }
}

/**
 * Truncate a single section to fit within a token limit
 */
function truncateSection(section: ContentSection, maxTokens: number): ContentSection | null {
  if (maxTokens <= 50) return null // Not worth truncating

  const lines = section.content.split('\n')
  const truncatedLines: string[] = []
  let tokens = 0

  for (const line of lines) {
    const lineTokens = estimateTokens(line)
    if (tokens + lineTokens <= maxTokens) {
      truncatedLines.push(line)
      tokens += lineTokens
    } else if (truncatedLines.length === 0) {
      // At least include the header
      truncatedLines.push(line.slice(0, maxTokens * 4)) // Approximate char count
      tokens = maxTokens
      break
    } else {
      break
    }
  }

  if (truncatedLines.length === 0) return null

  return {
    ...section,
    content: truncatedLines.join('\n') + '\n[... truncated ...]',
    estimatedTokens: tokens + 5 // Account for truncation notice
  }
}

// =============================================================================
// Stats Compression
// =============================================================================

/**
 * Compress stats data by removing less important fields
 */
export function compressStats(stats: any, level: 'light' | 'medium' | 'aggressive'): any {
  if (!stats || typeof stats !== 'object') return stats

  // Fields to remove at different compression levels
  const fieldsToRemove: Record<string, string[]> = {
    light: ['_id', 'createdAt', 'updatedAt', 'raw', 'debug'],
    medium: ['_id', 'createdAt', 'updatedAt', 'raw', 'debug', 'gameId', 'meta', 'position', 'positions'],
    aggressive: ['_id', 'createdAt', 'updatedAt', 'raw', 'debug', 'gameId', 'meta', 'position', 'positions', 'timestamp', 'timestamps', 'breakdown', 'byPlayer']
  }

  const removeFields = fieldsToRemove[level] || fieldsToRemove.light

  if (Array.isArray(stats)) {
    // For arrays, limit size based on compression level
    const maxItems = level === 'aggressive' ? 3 : level === 'medium' ? 5 : 10
    return stats.slice(0, maxItems).map(item => compressStats(item, level))
  }

  const compressed: any = {}
  for (const [key, value] of Object.entries(stats)) {
    if (removeFields.includes(key)) continue

    if (typeof value === 'object' && value !== null) {
      compressed[key] = compressStats(value, level)
    } else {
      compressed[key] = value
    }
  }

  return compressed
}

// =============================================================================
// Main Export Functions
// =============================================================================

/**
 * Prepare evidence data for LLM prompt, fitting within token budget
 */
export function prepareEvidenceForPrompt(
  evidence: any,
  useCase: 'coaching_report' | 'interactive_query' | 'what_if'
): { content: string; truncated: boolean; stats: { estimatedTokens: number; sections: number } } {
  const budget = getTokenBudget(useCase)

  // Convert evidence to string format
  let evidenceString = ''

  if (evidence.derived) {
    // Format derived stats
    evidenceString = formatDerivedStats(evidence.derived)
  } else {
    evidenceString = JSON.stringify(evidence, null, 2)
  }

  const initialTokens = estimateTokens(evidenceString)

  // If within budget, return as-is
  if (initialTokens <= budget.availableForContext) {
    return {
      content: evidenceString,
      truncated: false,
      stats: { estimatedTokens: initialTokens, sections: 1 }
    }
  }

  // Section and truncate
  const sections = sectionContent(evidenceString, 'stats')
  const result = truncateToFit(sections, budget)

  return {
    content: result.content,
    truncated: result.truncated,
    stats: {
      estimatedTokens: result.totalTokens,
      sections: result.includedSections.length
    }
  }
}

/**
 * Format derived stats into a readable string
 */
function formatDerivedStats(derived: any): string {
  const sections: string[] = []

  // Map stats
  if (derived.mapsStats?.length) {
    sections.push('## Match Overview')
    for (const map of derived.mapsStats) {
      sections.push(`- ${map.teamName}: ${map.roundsWon} rounds won`)
    }
  }

  // First blood stats
  if (derived.firstBloodStats?.length) {
    sections.push('\n## First Blood Stats')
    for (const fb of derived.firstBloodStats) {
      sections.push(`- ${fb.teamName}: ${fb.firstBloods} FBs, ${(fb.conversionRate * 100).toFixed(1)}% conversion`)
    }
  }

  // Clutch stats
  if (derived.clutchStats?.length) {
    sections.push('\n## Clutch Performance')
    for (const c of derived.clutchStats.slice(0, 5)) {
      sections.push(`- ${c.playerName}: ${c.clutchWins}/${c.clutchAttempts} (${(c.clutchRate * 100).toFixed(1)}%)`)
    }
  }

  // Economy stats
  if (derived.economyStats?.length) {
    sections.push('\n## Economy Stats')
    for (const e of derived.economyStats) {
      sections.push(`- ${e.teamName}: Force buy WR ${((e.byTier?.half_buy?.winRate || 0) * 100).toFixed(1)}%`)
    }
  }

  // Trade stats
  if (derived.tradeStats?.length) {
    sections.push('\n## Trade Stats')
    for (const t of derived.tradeStats.slice(0, 5)) {
      sections.push(`- ${t.playerName}: ${t.tradedRate ? (t.tradedRate * 100).toFixed(1) : 0}% deaths traded`)
    }
  }

  // Add more sections as needed...

  return sections.join('\n')
}

/**
 * Check if content will fit within token budget
 */
export function willFitInBudget(content: string, useCase: 'coaching_report' | 'interactive_query' | 'what_if'): boolean {
  const budget = getTokenBudget(useCase)
  return estimateTokens(content) <= budget.availableForContext
}
