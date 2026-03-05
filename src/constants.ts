import { Track } from './types';

// Central Dubai Defense Node
export const BATTERY_POS = { x: 50, y: 60 };
export const BULLSEYE_POS = { x: 80, y: 20 }; // Tactical Reference Point North East

export const WEAPON_STATS = {
  'SHORAD': { range: 5, cost: 5000, pk: 0.92, speedMach: 3.0 },
  'PAC-3': { range: 25, cost: 4000000, pk: 0.75, speedMach: 4.0 },
  'THAAD': { range: 100, cost: 15000000, pk: 0.85, speedMach: 8.0 },
  'AMRAAM': { range: 18, cost: 1200000, pk: 0.80, speedMach: 4.5 }
};

export const DEFENDED_ASSETS = [
  { id: 'DAL-1', name: 'Al Maktoum Int Airport (DWC)', x: 45, y: 67.5, type: 'AIRBASE' },
  { id: 'DAL-2', name: 'Jebel Ali Port', x: 40, y: 60, type: 'PORT' },
  { id: 'DAL-3', name: 'Burj Khalifa / Downtown', x: 55, y: 50, type: 'INFRA' },
  { id: 'DAL-4', name: 'Al Minhad Air Base', x: 57.5, y: 62.5, type: 'AIRBASE' }
];

// Scenario: Worst-Case Complex Coordinated Attack on Dubai
export const INITIAL_TRACKS: Track[] = [
  // AWACS orbiting over inland UAE (High altitude, racetrack orbit)
  { id: 'MAGIC-01', type: 'FRIEND', x: 67.5, y: 72.5, alt: 32000, spd: 350, hdg: 270, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Arrival Flow: UAE-992 on final approach to DWC (DAL-1)
  { id: 'UAE-992', type: 'ASSUMED_FRIEND', x: 49, y: 71.5, alt: 3000, spd: 160, hdg: 315, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Departure Flow: ETD-551 climbing out of DWC
  { id: 'ETD-551', type: 'ASSUMED_FRIEND', x: 42.5, y: 65, alt: 8500, spd: 280, hdg: 280, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // High-Altitude Corridor (Link-16 Datalink Tracks)
  { id: 'QTR-115', type: 'ASSUMED_FRIEND', x: 32.5, y: 37.5, alt: 38000, spd: 480, hdg: 135, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  { id: 'BAW-107', type: 'ASSUMED_FRIEND', x: 70, y: 35, alt: 36000, spd: 470, hdg: 225, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Local Vectoring: FDB-22 assigned to a specific heading/altitude
  { id: 'FDB-22', type: 'ASSUMED_FRIEND', x: 40, y: 50, alt: 14000, spd: 320, hdg: 45, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Distant Traffic
  { id: 'AIC-121', type: 'ASSUMED_FRIEND', x: 27.5, y: 55, alt: 34000, spd: 450, hdg: 90, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
];
