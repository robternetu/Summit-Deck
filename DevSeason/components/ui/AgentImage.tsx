'use client'

import { useState } from 'react'
import Image from 'next/image'

interface AgentImageProps {
  agent: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: { container: 'w-6 h-6', text: 'text-xs' },
  md: { container: 'w-8 h-8', text: 'text-sm' },
  lg: { container: 'w-12 h-12', text: 'text-base' },
}

// Agent image mapping - using placeholder URLs for now
// These would be replaced with actual Valorant agent icons
const AGENT_IMAGES: Record<string, string> = {
  'jett': '/agents/jett.png',
  'omen': '/agents/omen.png',
  'brimstone': '/agents/brimstone.png',
  'phoenix': '/agents/phoenix.png',
  'sage': '/agents/sage.png',
  'sova': '/agents/sova.png',
  'viper': '/agents/viper.png',
  'cypher': '/agents/cypher.png',
  'reyna': '/agents/reyna.png',
  'killjoy': '/agents/killjoy.png',
  'breach': '/agents/breach.png',
  'skye': '/agents/skye.png',
  'yoru': '/agents/yoru.png',
  'astra': '/agents/astra.png',
  'kayo': '/agents/kayo.png',
  'chamber': '/agents/chamber.png',
  'neon': '/agents/neon.png',
  'fade': '/agents/fade.png',
  'harbor': '/agents/harbor.png',
  'gekko': '/agents/gekko.png',
  'deadlock': '/agents/deadlock.png',
  'iso': '/agents/iso.png',
  'clove': '/agents/clove.png',
  'vyse': '/agents/vyse.png',
}

export function AgentImage({ agent, size = 'md', className = '' }: AgentImageProps) {
  const [imageError, setImageError] = useState(false)
  const agentKey = agent.toLowerCase()
  const imagePath = AGENT_IMAGES[agentKey]
  const { container, text } = sizeMap[size]

  // If no image path or image failed to load, show agent name initials
  if (!imagePath || imageError) {
    const initial = agent.charAt(0).toUpperCase()
    return (
      <div
        className={`${container} bg-gradient-to-br from-blue-900 to-purple-900 rounded flex items-center justify-center border border-blue-700 ${className}`}
        title={agent}
      >
        <span className={`${text} font-bold text-white`}>{initial}</span>
      </div>
    )
  }

  return (
    <div
      className={`${container} rounded overflow-hidden border border-gray-700 ${className}`}
      title={agent}
    >
      <Image
        src={imagePath}
        alt={agent}
        width={48}
        height={48}
        className="w-full h-full object-cover"
        onError={() => setImageError(true)}
        unoptimized
      />
    </div>
  )
}
