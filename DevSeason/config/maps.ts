export interface MapSettings {
  imageRotation: number; // Rotation for the map image
  dataRotation: number;  // Rotation for the heatmap data points
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const MAP_SETTINGS: Record<string, MapSettings> = {
  'ascent': { 
    imageRotation: 0,
    dataRotation: 0,
    minX: -4850,
    maxX: 7550,
    minY: -11100,
    maxY: 5000
  },
  'bind': { imageRotation: 0, dataRotation: 0, minX: 100, maxX: 16100, minY: -7300, maxY: 6050 },
  'haven': { imageRotation: 0, dataRotation: 0, minX: -3700, maxX: 7450, minY: -14100, maxY: -1800 },
  'split': { imageRotation: 0, dataRotation: 0, minX: -3450, maxX: 8300, minY: -10050, maxY: 950 },
  'icebox': { imageRotation: 0, dataRotation: 0, minX: -8300, maxX: 3100, minY: -5200, maxY: 7200 },
  'breeze': { imageRotation: 0, dataRotation: 0, minX: -1650, maxX: 11450, minY: -6200, maxY: 7200 },
  'fracture': { imageRotation: 0, dataRotation: 0, minX: 3000, maxX: 13900, minY: -6850, maxY: 4700 },
  'pearl': { imageRotation: 0, dataRotation: 0, minX: -500, maxX: 11250, minY: -6100, maxY: 6550 },
  'lotus': { imageRotation: 0, dataRotation: 0, minX: 300, maxX: 11000, minY: -5500, maxY: 6550 },
  'sunset': { imageRotation: 0, dataRotation: 0, minX: -6000, maxX: 6450, minY: -5800, maxY: 6000 },
  'abyss': { imageRotation: 0, dataRotation: 0, minX: -6000, maxX: 6000, minY: -6800, maxY: 5800 },
  'corrode': { imageRotation: 0, dataRotation: 0, minX: -6000, maxX: 6000, minY: -7100, maxY: 6500 },
};
