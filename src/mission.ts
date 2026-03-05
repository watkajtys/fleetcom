import { Track, TrackCategory, TrackType } from './types';
import { BATTERY_POS } from './constants';

let trackIdCounter = 100;

const generateId = (prefix: string) => {
  trackIdCounter++;
  return `${prefix}${trackIdCounter}`;
};

export const createTargetTrack = (
  type: TrackType,
  category: TrackCategory,
  bearingFromBattery: number, // 0-360
  distanceNm: number,
  spd: number,
  alt: number,
  sensor: 'LCL' | 'L16' | 'FUS' = 'LCL'
): Track => {
  const radNav = bearingFromBattery * (Math.PI / 180);
  const startX = BATTERY_POS.x + distanceNm * Math.sin(radNav);
  const startY = BATTERY_POS.y - distanceNm * Math.cos(radNav);

  // Add slight jitter to heading so they aren't all perfectly converging on the exact pixel
  const exactHdgToBattery = (bearingFromBattery + 180) % 360;
  const hdgJitter = (Math.random() - 0.5) * 10; 
  const hdg = (exactHdgToBattery + hdgJitter + 360) % 360;

  let prefix = 'TRK';
  if (category === 'UAS') prefix = 'U';
  if (category === 'CM') prefix = 'C';
  if (category === 'TBM') prefix = 'B';

  const rangeToBattery = distanceNm;
  const radarHorizonNm = 1.23 * (Math.sqrt(100) + Math.sqrt(alt));
  const isDetected = sensor === 'L16' || rangeToBattery <= radarHorizonNm;

  return {
    id: generateId(prefix),
    type,
    category,
    x: startX,
    y: startY,
    alt,
    spd,
    hdg,
    history: [],
    iffInterrogated: false,
    tq: category === 'UAS' || category === 'CM' ? Math.floor(Math.random() * 3) + 2 : 9,
    coasting: false,
    interceptors: [],
    sensor,
    detected: isDetected
  };
};

export const createCrossingTrack = (
  type: TrackType,
  category: TrackCategory,
  startX: number,
  startY: number,
  hdg: number,
  spd: number,
  alt: number
): Track => {
  return {
    id: generateId('FLT'),
    type,
    category,
    x: startX,
    y: startY,
    alt,
    spd,
    hdg,
    history: [],
    iffInterrogated: false,
    tq: 9,
    coasting: false,
    interceptors: [],
    sensor: 'L16',
    detected: true
  };
};

export interface MissionEvent {
  time: number;
  message: string;
  type: 'INFO' | 'WARN' | 'ALERT' | 'ACTION';
  generateTracks: () => Track[];
}

export const MISSION_STEPS: MissionEvent[] = [
  {
    time: 10,
    message: 'ATC: FLIGHT EK404 SQUAWKING 7500. DEVIATING FROM ASSIGNED FLIGHT PATH. INTENTIONS UNKNOWN.',
    type: 'WARN',
    generateTracks: () => [
      { ...createCrossingTrack('UNKNOWN', 'FW', 20, 25, 120, 500, 31000), id: 'FLT-EK404' }
    ]
  },
  {
    time: 20,
    message: 'HUNTRESS: ACTIVE AIR DEFENSE SCRAMBLE FOR FALCON 21, 22. SCRAMBLE IMMEDIATELY. VECTOR 320 TO INTERCEPT TRACK FLT-EK404.',
    type: 'ACTION',
    generateTracks: () => [
      { ...createCrossingTrack('FRIEND', 'FW', 57.5, 62.5, 290, 250, 1000), id: 'FALCON-21', isFighter: true, missilesRemaining: 4, fuel: 12000, maxFuel: 12000, targetWaypoint: {x: 35, y: 35} },
      { ...createCrossingTrack('FRIEND', 'FW', 57.5, 62.5, 300, 250, 1000), id: 'FALCON-22', isFighter: true, missilesRemaining: 4, fuel: 12000, maxFuel: 12000, targetWaypoint: {x: 40, y: 35} }
    ]
  },
  {
    time: 50,
    message: 'WARNING RED. TBM WAVE 1. HIGH-ALTITUDE TRACKS DETECTED. EVALUATED HOSTILE MRBM. IMPACT DUBAI 90 SECONDS.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 4}).map(() => createTargetTrack(
      'PENDING', 'TBM',
      340 + Math.random() * 20, 
      85 + Math.random() * 5,   
      3800 + Math.random() * 400, 
      150000 + Math.random() * 20000, 
      'L16'
    ))
  },
  {
    time: 80,
    message: 'WARNING RED. SWARM WAVE 1 DETECTED SEAWARD. EVALUATED MIXED UAS/CM.',
    type: 'ALERT',
    generateTracks: () => [
      ...Array.from({length: 4}).map(() => createTargetTrack('PENDING', 'UAS', 315 + Math.random() * 10, 60 + Math.random() * 5, 100 + Math.random() * 15, 200 + Math.random() * 300, 'L16')),
      ...Array.from({length: 2}).map(() => createTargetTrack('PENDING', 'CM', 300 + Math.random() * 20, 65 + Math.random() * 2, 450 + Math.random() * 30, 300 + Math.random() * 200, 'L16'))
    ]
  },
  {
    time: 83,
    message: 'HUNTRESS: ADDITIONAL FAST-MOVERS DETECTED IN SWARM 1.',
    type: 'WARN',
    generateTracks: () => [
      ...Array.from({length: 3}).map(() => createTargetTrack('PENDING', 'UAS', 325 + Math.random() * 10, 62 + Math.random() * 5, 100 + Math.random() * 15, 200 + Math.random() * 300, 'L16')),
      ...Array.from({length: 2}).map(() => createTargetTrack('PENDING', 'CM', 320 + Math.random() * 20, 67 + Math.random() * 2, 450 + Math.random() * 30, 300 + Math.random() * 200, 'L16'))
    ]
  },
  {
    time: 86,
    message: 'HUNTRESS: MORE SLOW-MOVERS EMERGING FROM CLUTTER.',
    type: 'WARN',
    generateTracks: () => [
      ...Array.from({length: 3}).map(() => createTargetTrack('PENDING', 'UAS', 335 + Math.random() * 10, 64 + Math.random() * 5, 100 + Math.random() * 15, 200 + Math.random() * 300, 'L16'))
    ]
  },
  {
    time: 90,
    message: 'HUNTRESS: SCRAMBLE FALCON 23, 24 TO INTERCEPT LOW-ALTITUDE SWARM. WEAPONS FREE.',
    type: 'ACTION',
    generateTracks: () => [
      { ...createCrossingTrack('FRIEND', 'FW', 57.5, 62.5, 310, 250, 1000), id: 'FALCON-23', isFighter: true, missilesRemaining: 4, fuel: 12000, maxFuel: 12000, targetWaypoint: {x: 45, y: 35} },
      { ...createCrossingTrack('FRIEND', 'FW', 57.5, 62.5, 320, 250, 1000), id: 'FALCON-24', isFighter: true, missilesRemaining: 4, fuel: 12000, maxFuel: 12000, targetWaypoint: {x: 50, y: 35} }
    ]
  },
  {
    time: 140,
    message: 'WARNING RED. TBM WAVE 2. MULTIPLE LAUNCHES DETECTED. RECOMMEND PAC-3 / THAAD LAYERED DEFENSE.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 6}).map(() => createTargetTrack(
      'PENDING', 'TBM',
      345 + Math.random() * 15, 
      90 + Math.random() * 5,   
      4000 + Math.random() * 300, 
      160000 + Math.random() * 10000, 
      'L16'
    ))
  },
  {
    time: 170,
    message: 'WARNING RED. SWARM WAVE 2. MASSIVE UAS FORMATION EMERGING FROM CLUTTER. SATURATION ATTACK IMMINENT.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 5}).map(() => createTargetTrack('PENDING', 'UAS', 310 + Math.random() * 10, 65 + Math.random() * 5, 100 + Math.random() * 15, 200 + Math.random() * 300, 'L16'))
  },
  {
    time: 173,
    message: 'HUNTRESS: MORE BOGEYS POPPING UP. SWARM CONTINUES.',
    type: 'WARN',
    generateTracks: () => Array.from({length: 5}).map(() => createTargetTrack('PENDING', 'UAS', 320 + Math.random() * 10, 68 + Math.random() * 5, 100 + Math.random() * 15, 200 + Math.random() * 300, 'L16'))
  },
  {
    time: 176,
    message: 'HUNTRESS: FIVE MORE TRACKS DETECTED LOW ALTITUDE.',
    type: 'WARN',
    generateTracks: () => Array.from({length: 5}).map(() => createTargetTrack('PENDING', 'UAS', 330 + Math.random() * 10, 71 + Math.random() * 5, 100 + Math.random() * 15, 200 + Math.random() * 300, 'L16'))
  },
  {
    time: 179,
    message: 'HUNTRESS: STILL RAMPING UP. DO NOT COMMIT ALL AAM INVENTORY.',
    type: 'WARN',
    generateTracks: () => Array.from({length: 5}).map(() => createTargetTrack('PENDING', 'UAS', 340 + Math.random() * 10, 74 + Math.random() * 5, 100 + Math.random() * 15, 200 + Math.random() * 300, 'L16'))
  },
  {
    time: 182,
    message: 'HUNTRESS: FINAL WAVE OF SWARM 2 CLEARING RADAR HORIZON.',
    type: 'WARN',
    generateTracks: () => Array.from({length: 5}).map(() => createTargetTrack('PENDING', 'UAS', 350 + Math.random() * 10, 77 + Math.random() * 5, 100 + Math.random() * 15, 200 + Math.random() * 300, 'L16'))
  },
  {
    time: 210,
    message: 'WARNING RED. TBM WAVE 3. HEAVY SALVO DETECTED. BRACE FOR IMPACT.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 8}).map(() => createTargetTrack(
      'PENDING', 'TBM',
      330 + Math.random() * 30, 
      85 + Math.random() * 10,   
      3900 + Math.random() * 500, 
      155000 + Math.random() * 15000, 
      'L16'
    ))
  },
  {
    time: 250,
    message: 'WARNING RED. VAMPIRE VAMPIRE VAMPIRE. FAST-MOVERS DETECTED FLANKING FROM THE EAST. EVALUATED SEA-SKIMMING CRUISE MISSILES.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 12}).map(() => createTargetTrack(
      'PENDING', 'CM', 
      90 + Math.random() * 20, // East
      80 + Math.random() * 10,  
      480 + Math.random() * 20, // Fast
      100 + Math.random() * 50, // Sea-skimming
      'L16'
    ))
  }
];
