import { Track, DefendedAsset } from './types';

// Central Dubai Defense Node
export const BATTERY_POS = { x: 50, y: 60 };
export const BULLSEYE_POS = { x: 80, y: 20 }; // Tactical Reference Point North East

export const WEAPON_STATS = {
  'C-RAM': { range: 2.5, cost: 500, pk: 0.75, speedMach: 5.0 }, // Phalanx CIWS / Laser Directed Energy
  'TAMIR': { range: 35, cost: 50000, pk: 0.65, speedMach: 2.2 }, // Iron Dome (Tamir)
  'PAC-3': { range: 40, cost: 4500000, pk: 0.85, speedMach: 4.0 }, // PAC-3 MSE
  'THAAD': { range: 100, cost: 13000000, pk: 0.90, speedMach: 8.0 }, // THAAD
  'AMRAAM': { range: 18, cost: 1200000, pk: 0.75, speedMach: 4.5 } // AIM-120D
};

export const DEFENDED_ASSETS: DefendedAsset[] = [
  { id: 'DAL-1', name: 'Al Maktoum Int Airport (DWC)', x: 45, y: 67.5, type: 'AIRBASE', hasCram: false },
  { id: 'DAL-2', name: 'Jebel Ali Port', x: 40, y: 60, type: 'PORT', hasCram: false },
  { id: 'DAL-3', name: 'Burj Khalifa / Downtown', x: 55, y: 50, type: 'INFRA', hasCram: false },
  { id: 'DAL-4', name: 'Al Minhad Air Base', x: 57.5, y: 62.5, type: 'AIRBASE', hasCram: true },
  { id: 'DAL-5', name: 'Dubai Int Airport (DXB)', x: 60, y: 46, type: 'AIRBASE', hasCram: false },
  { id: 'DAL-6', name: 'Port Rashid', x: 58, y: 43, type: 'PORT', hasCram: false }
];

// Scenario: Worst-Case Complex Coordinated Attack on Dubai
export const INITIAL_TRACKS: Track[] = [
  // AWACS orbiting over inland UAE (High altitude, racetrack orbit, looking North)
  { id: 'MAGIC-01', type: 'FRIEND', x: 50, y: 150, alt: 35000, spd: 380, hdg: 90, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Arrival Flow: UAE-992 on final approach to DWC (DAL-1)
  { id: 'UAE-992', type: 'ASSUMED_FRIEND', x: 47, y: 68, alt: 3000, spd: 160, hdg: 315, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Departure Flow: ETD-551 climbing out of DWC
  { id: 'ETD-551', type: 'ASSUMED_FRIEND', x: 42, y: 65, alt: 8500, spd: 280, hdg: 280, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // High-Altitude Corridor (Link-16 Datalink Tracks)
  { id: 'QTR-115', type: 'ASSUMED_FRIEND', x: 0, y: 0, alt: 38000, spd: 480, hdg: 135, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  { id: 'BAW-107', type: 'ASSUMED_FRIEND', x: 75, y: 30, alt: 8000, spd: 250, hdg: 225, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  { id: 'SIA-322', type: 'ASSUMED_FRIEND', x: 10, y: 15, alt: 35000, spd: 460, hdg: 120, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  { id: 'THY-418', type: 'ASSUMED_FRIEND', x: -20, y: -20, alt: 33000, spd: 490, hdg: 300, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  { id: 'QFA-9',   type: 'ASSUMED_FRIEND', x: 5, y: 10, alt: 37000, spd: 450, hdg: 300, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Local Vectoring: FDB-22 assigned to a specific heading/altitude
  { id: 'FDB-22', type: 'ASSUMED_FRIEND', x: 35, y: 75, alt: 14000, spd: 320, hdg: 45, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Distant Traffic
  { id: 'AIC-121', type: 'ASSUMED_FRIEND', x: 15, y: 60, alt: 34000, spd: 450, hdg: 90, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
  
  // Normal flight that gets hijacked later
  { id: 'FLT-EK404', type: 'ASSUMED_FRIEND', x: 20, y: 25, alt: 31000, spd: 500, hdg: 300, category: 'FW', history: [], iffInterrogated: true, tq: 9, coasting: false, interceptors: [], sensor: 'L16', detected: true },
];
