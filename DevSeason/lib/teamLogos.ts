// Team logo mapping - uses local images in /public/logos/
// Uses NORMALIZED team names (without "(1)" suffixes)

export const TEAM_LOGOS: Record<string, string> = {
  'Summit': '/logos/summit-mark.png',
  
  // Americas teams
  'NRG': '/logos/NRG.png',
  'FURIA': '/logos/FURIA.png',
  'MIBR': '/logos/MIBR.png',  // Normalized - covers both "MIBR" and "MIBR (1)"
  'KRÜ Esports': '/logos/KRU.png',
  'LOUD': '/logos/LOUD.png',  // Normalized - covers both "LOUD" and "LOUD (1)"
  '100 Thieves': '/logos/100T.png',
  'Leviatán Esports': '/logos/Leviatan.png',
  'Sentinels': '/logos/Sentinels.png',
  '2GAME eSports': '/logos/2G.png',
  'Evil Geniuses': '/logos/EG.png',
  
  // EMEA teams
  'G2 Esports': '/logos/G2.PNG',
  'FunPlus Phoenix': '/logos/FPX.png',
  'Karmine Corp': '/logos/KC.png',
  'Team Heretics': '/logos/TH.png',
  'Fnatic': '/logos/FNTC.png',
  'Team Liquid': '/logos/TL.png',
  'TRACE Esports': '/logos/TRACE.png',
  'Wolves Esports': '/logos/WOLVES.png',
  
  // Pacific teams
  'Paper Rex': '/logos/PRX.png',
  'Gen.G': '/logos/GENG.png',
  'EDward Gaming': '/logos/EDG.png',
  'DRX': '/logos/DRG.png',
  'T1': '/logos/T1.png',
  'XERXIA': '/logos/XLG.png',
}

export function getTeamLogo(teamName: string): string | null {
  // First try direct match
  if (TEAM_LOGOS[teamName]) {
    return TEAM_LOGOS[teamName]
  }
  
  // Try without "(N)" suffix
  const normalized = teamName.replace(/\s*\(\d+\)\s*$/, '').trim()
  return TEAM_LOGOS[normalized] || null
}

export function getTeamInitial(teamName: string): string {
  // Get first letter or abbreviation
  if (teamName.includes('100')) return '100'
  if (teamName.includes('2GAME')) return '2G'
  return teamName.charAt(0).toUpperCase()
}
