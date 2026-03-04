import { Track } from './types';

// Central Dubai Defense Node
export const BATTERY_POS = { x: 50, y: 60 };
export const BULLSEYE_POS = { x: 50, y: 50 }; // Tactical Reference Point

export const WEAPON_STATS = {
  'SHORAD': { range: 5, cost: 5000 },
  'PAC-3': { range: 25, cost: 4000000 },
  'THAAD': { range: 100, cost: 15000000 }
};

export const DEFENDED_ASSETS = [
  { id: 'DAL-1', name: 'Al Maktoum Int Airport (DWC)', x: 40, y: 75, type: 'AIRBASE' },
  { id: 'DAL-2', name: 'Jebel Ali Port', x: 30, y: 60, type: 'PORT' },
  { id: 'DAL-3', name: 'Burj Khalifa / Downtown', x: 60, y: 40, type: 'INFRA' },
  { id: 'DAL-4', name: 'Al Minhad Air Base', x: 65, y: 65, type: 'AIRBASE' }
];

// Scenario: Worst-Case Complex Coordinated Attack on Dubai
export const INITIAL_TRACKS: Track[] = [
  // AWACS orbiting over inland UAE
  { id: 'MAGIC-01', type: 'FRIEND', x: 70, y: 80, alt: 32000, spd: 350, hdg: 270, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, engagedBy: null, sensor: 'L16', detected: true },
  
  // Heavy civilian traffic in the Gulf corridor
  { id: 'UAE-001', type: 'ASSUMED_FRIEND', x: 10, y: 20, alt: 35000, spd: 480, hdg: 135, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, engagedBy: null, sensor: 'L16', detected: true },
  { id: 'FDB-944', type: 'ASSUMED_FRIEND', x: 25, y: 15, alt: 24000, spd: 420, hdg: 140, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, engagedBy: null, sensor: 'L16', detected: true },
  { id: 'QTR-115', type: 'ASSUMED_FRIEND', x: 40, y: 10, alt: 33000, spd: 460, hdg: 130, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, engagedBy: null, sensor: 'L16', detected: true },
  { id: 'BAW-107', type: 'ASSUMED_FRIEND', x: 80, y: 15, alt: 37000, spd: 470, hdg: 220, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, engagedBy: null, sensor: 'L16', detected: true },
];
