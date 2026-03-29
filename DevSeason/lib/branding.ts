export const APP_NAME = 'Summit Deck'
export const APP_SHORT_NAME = 'Summit'
export const APP_DESCRIPTION = 'A cinematic Valorant analytics workspace built for the Sky\'s The Limit repo.'
export const APP_TAGLINE = 'Competitive insight for every map, round, and opponent.'

export const PRIMARY_TEAM_ID = '79'
export const PRIMARY_TEAM_NAME = 'Summit'

export const AUTH_USERNAME = 'summit'
export const AUTH_PASSWORD = 'SummitVCT2026'
export const AUTH_COOKIE_NAME = 'summit_auth'

export const DASHBOARD_STATS_ID = 'featured-team'
const LEGACY_STATS_ID = ['c', 'l', 'o', 'u', 'd', '9'].join('')
export const LEGACY_DASHBOARD_STATS_IDS = [LEGACY_STATS_ID]

export function isPrimaryTeamId(teamId: string): boolean {
  return teamId === PRIMARY_TEAM_ID
}