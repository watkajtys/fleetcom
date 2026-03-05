import { Track } from './types';

// Central Dubai Defense Node
export const BATTERY_POS = { x: 50, y: 60 };
export const BULLSEYE_POS = { x: 80, y: 20 }; // Tactical Reference Point North East

export const WEAPON_STATS = {
  'C-RAM': { range: 2.5, cost: 500, pk: 0.95, speedMach: 5.0 }, // Phalanx CIWS / Laser Directed Energy
  'TAMIR': { range: 35, cost: 50000, pk: 0.90, speedMach: 2.2 }, // Iron Dome (Tamir)
  'PAC-3': { range: 25, cost: 4500000, pk: 0.75, speedMach: 4.0 }, // PAC-3 MSE
  'THAAD': { range: 100, cost: 13000000, pk: 0.85, speedMach: 8.0 }, // THAAD
  'AMRAAM': { range: 18, cost: 1200000, pk: 0.80, speedMach: 4.5 } // AIM-120D
};

export const DEFENDED_ASSETS = [
  { id: 'DAL-1', name: 'Al Maktoum Int Airport (DWC)', x: 45, y: 67.5, type: 'AIRBASE' },
  { id: 'DAL-2', name: 'Jebel Ali Port', x: 40, y: 60, type: 'PORT' },
  { id: 'DAL-3', name: 'Burj Khalifa / Downtown', x: 55, y: 50, type: 'INFRA' },
  { id: 'DAL-4', name: 'Al Minhad Air Base', x: 57.5, y: 62.5, type: 'AIRBASE' },
  { id: 'DAL-5', name: 'Dubai Int Airport (DXB)', x: 60, y: 46, type: 'AIRBASE' },
  { id: 'DAL-6', name: 'Port Rashid', x: 58, y: 43, type: 'PORT' }
];

// Scenario: Worst-Case Complex Coordinated Attack on Dubai
export const INITIAL_TRACKS: Track[] = [
  // AWACS orbiting over inland UAE (High altitude, racetrack orbit)
  { id: 'MAGIC-01', type: 'FRIEND', x: 60, y: 65, alt: 32000, spd: 350, hdg: 270, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Arrival Flow: UAE-992 on final approach to DWC (DAL-1)
  { id: 'UAE-992', type: 'ASSUMED_FRIEND', x: 47, y: 68, alt: 3000, spd: 160, hdg: 315, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Departure Flow: ETD-551 climbing out of DWC
  { id: 'ETD-551', type: 'ASSUMED_FRIEND', x: 42, y: 65, alt: 8500, spd: 280, hdg: 280, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // High-Altitude Corridor (Link-16 Datalink Tracks)
  { id: 'QTR-115', type: 'ASSUMED_FRIEND', x: 40, y: 45, alt: 38000, spd: 480, hdg: 135, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  { id: 'BAW-107', type: 'ASSUMED_FRIEND', x: 60, y: 40, alt: 36000, spd: 470, hdg: 225, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Local Vectoring: FDB-22 assigned to a specific heading/altitude
  { id: 'FDB-22', type: 'ASSUMED_FRIEND', x: 45, y: 55, alt: 14000, spd: 320, hdg: 45, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Distant Traffic
  { id: 'AIC-121', type: 'ASSUMED_FRIEND', x: 35, y: 50, alt: 34000, spd: 450, hdg: 90, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
];
