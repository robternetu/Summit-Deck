// Map image mapping - uses local images in /public/maps/

export const MAP_FULL_IMAGES: Record<string, string> = {
  'abyss': '/maps/abyss.jpg',
  'ascent': '/maps/ascent.png',
  'bind': '/maps/bind.png',
  'breeze': '/maps/breeze.png',
  'corrode': '/maps/corrode.jpg',
  'fracture': '/maps/fracture.webp',
  'haven': '/maps/haven.png',
  'icebox': '/maps/icebox.png',
  'lotus': '/maps/lotus.webp',
  'pearl': '/maps/pearl.webp',
  'split': '/maps/split.png',
  'sunset': '/maps/sunset.png',
}

export const MAP_MINIMAPS: Record<string, string> = {
  'abyss': '/maps/minimaps/Abyss_minimap.webp',
  'ascent': '/maps/minimaps/Ascent_minimap.webp',
  'bind': '/maps/minimaps/Bind_minimap.webp',
  'breeze': '/maps/minimaps/Breeze_minimap.webp',
  'corrode': '/maps/minimaps/Corrode_minimap.webp',
  'fracture': '/maps/minimaps/Fracture_minimap.webp',
  'haven': '/maps/minimaps/Haven_minimap.webp',
  'icebox': '/maps/minimaps/Icebox_minimap.webp',
  'lotus': '/maps/minimaps/Lotus_minimap.webp',
  'pearl': '/maps/minimaps/Pearl_minimap.webp',
  'split': '/maps/minimaps/Split_minimap.webp',
  'sunset': '/maps/minimaps/Sunset_minimap.webp',
}

export function getMapImage(mapName: string): string | null {
  const normalized = mapName.toLowerCase().trim()
  return MAP_FULL_IMAGES[normalized] || null
}

export function getMinimapImage(mapName: string): string | null {
  const normalized = mapName.toLowerCase().trim()
  return MAP_MINIMAPS[normalized] || null
}

export function getMapInitial(mapName: string): string {
  return mapName.charAt(0).toUpperCase()
}
