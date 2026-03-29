// Team name normalization - handles GRID API quirks like "(1)" suffixes
// and maps alternate names to canonical team names

const TEAM_NAME_ALIASES: Record<string, string> = {
  // GRID sometimes adds "(1)" suffix for different tournament appearances or roster changes
  // This happens when the same org has multiple entries in their system
  'MIBR (1)': 'MIBR',
  'LOUD (1)': 'LOUD',
}

/**
 * Normalize a team name by removing suffixes and mapping aliases
 * 
 * Why does "(1)" appear?
 * GRID's data system tracks teams across tournaments. When a team has:
 * - Multiple roster versions
 * - Different tournament registrations  
 * - Regional vs international entries
 * They may appear as "TeamName (1)", "TeamName (2)" etc.
 * For our purposes, these are the same organization.
 */
export function normalizeTeamName(name: string): string {
  // Check for known aliases first
  if (TEAM_NAME_ALIASES[name]) {
    return TEAM_NAME_ALIASES[name]
  }
  
  // Remove any "(N)" suffix pattern (handles any number)
  const cleaned = name.replace(/\s*\(\d+\)\s*$/, '').trim()
  
  return cleaned || name
}

/**
 * Get a unique key for grouping teams (normalized lowercase)
 */
export function getTeamKey(name: string): string {
  return normalizeTeamName(name).toLowerCase()
}
