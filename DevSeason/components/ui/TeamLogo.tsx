'use client'

import { useState } from 'react'
import Image from 'next/image'
import { getTeamLogo, getTeamInitial } from '@/lib/teamLogos'

interface TeamLogoProps {
  teamName: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

const sizeMap = {
  sm: { container: 'w-10 h-10', text: 'text-sm' },
  md: { container: 'w-12 h-12', text: 'text-base' },
  lg: { container: 'w-16 h-16', text: 'text-xl' },
  xl: { container: 'w-20 h-20', text: 'text-2xl' },
}

export function TeamLogo({ teamName, size = 'md', className = '' }: TeamLogoProps) {
  const [imageError, setImageError] = useState(false)
  const logoPath = getTeamLogo(teamName)
  const initial = getTeamInitial(teamName)
  const { container, text } = sizeMap[size]

  // If no logo path or image failed to load, show initial
  if (!logoPath || imageError) {
    return (
      <div 
        className={`${container} bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl flex items-center justify-center border border-gray-700 ${className}`}
      >
        <span className={`${text} font-bold text-gray-400`}>{initial}</span>
      </div>
    )
  }

  return (
    <div 
      className={`${container} bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl flex items-center justify-center border border-gray-700 overflow-hidden p-2 ${className}`}
    >
      <Image
        src={logoPath}
        alt={teamName}
        width={64}
        height={64}
        className="w-full h-full object-contain"
        onError={() => setImageError(true)}
        unoptimized // Use unoptimized for local images to avoid 404 during build
      />
    </div>
  )
}
