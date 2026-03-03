import { Track } from './types';

// Fixed Coastal Battery Position (Dubai Coast)
export const BATTERY_POS = { x: 50, y: 70 };
export const BULLSEYE_POS = { x: 30, y: 30 }; // Tactical Reference Point

export const WEAPON_STATS = {
  'SHORAD': { range: 5, cost: 5000 },
  'PAC-3': { range: 25, cost: 4000000 },
  'THAAD': { range: 100, cost: 15000000 }
};

export const DEFENDED_ASSETS = [
  { id: 'DAL-1', name: 'Al Maktoum Int Airport', x: 45, y: 75, type: 'AIRBASE' },
  { id: 'DAL-2', name: 'Jebel Ali Port', x: 35, y: 70, type: 'PORT' },
  { id: 'DAL-3', name: 'Desalination Plant', x: 55, y: 65, type: 'INFRA' },
  { id: 'DAL-4', name: 'Patriot Radar (AN/MPQ-65)', x: 50, y: 70, type: 'C2' }
];

// Scenario: The Drone Threat (Low/Slow UAS vs High/Fast Commercial)
export const INITIAL_TRACKS: Track[] = [
  { id: 'VIPER-1', type: 'FRIEND', x: 50, y: 65, alt: 22000, spd: 350, hdg: 0, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, engagedBy: null, sensor: 'L16' },
];
