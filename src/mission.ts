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
      { ...createCrossingTrack('UNKNOWN', 'FW', 10, 10, 120, 500, 31000), id: 'FLT-EK404' }
    ]
  },
  {
    time: 20,
    message: 'HUNTRESS: ACTIVE AIR DEFENSE SCRAMBLE FOR VIPER 01 FLIGHT (VIPER 01 & 02). SCRAMBLE IMMEDIATELY. VECTOR 320 TO INTERCEPT TRACK FLT-EK404.',
    type: 'ACTION',
    generateTracks: () => [
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 290, 250, 1000), id: 'VIPER-01', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 40, y: 40} },
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 300, 250, 1000), id: 'VIPER-02', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 45, y: 40} }
    ]
  },
  {
    time: 90,
    message: 'WARNING RED. MULTIPLE HIGH-ALTITUDE, HIGH-VELOCITY TRACKS DETECTED. EVALUATED HOSTILE MRBM. VELOCITY MACH 6. DESCENDING THROUGH FL600. IMPACT DUBAI 90 SECONDS. RECOMMEND IMMEDIATE THAAD ENGAGEMENT.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 8}).map(() => createTargetTrack(
      'PENDING', 'TBM',
      340 + Math.random() * 20, 
      85 + Math.random() * 5,   
      3800 + Math.random() * 400, 
      150000 + Math.random() * 20000, 
      'L16'
    ))
  },
  {
    time: 120,
    message: 'WARNING RED. MASSIVE LOW-ALTITUDE SIGNATURES DETECTED SEAWARD. EVALUATED MIXED UAS/CM SWARM. SATURATION ATTACK IMMINENT. CONSERVE HIGH-VALUE INTERCEPTORS.',
    type: 'ALERT',
    generateTracks: () => [
      ...Array.from({length: 20}).map(() => createTargetTrack(
        'PENDING', 'UAS', 
        315 + Math.random() * 30, 
        60 + Math.random() * 10,  
        100 + Math.random() * 15, 
        200 + Math.random() * 300, 
        'L16'
      )),
      ...Array.from({length: 8}).map(() => createTargetTrack(
        'PENDING', 'CM', 
        300 + Math.random() * 60, 
        65 + Math.random() * 5,  
        450 + Math.random() * 30, 
        300 + Math.random() * 200, 
        'L16'
      ))
    ]
  },
  {
    time: 130,
    message: 'HUNTRESS: SCRAMBLE VIPER 03 FLIGHT (VIPER 03 & 04) TO INTERCEPT LOW-ALTITUDE SWARM. WEAPONS FREE. ENGAGE TARGETS OF OPPORTUNITY.',
    type: 'ACTION',
    generateTracks: () => [
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 310, 250, 1000), id: 'VIPER-03', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 50, y: 40} },
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 320, 250, 1000), id: 'VIPER-04', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 55, y: 40} }
    ]
  }
];
