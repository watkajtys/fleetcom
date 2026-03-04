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
    engagedBy: null,
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
    engagedBy: null,
    sensor: 'L16',
    detected: true
  };
};

export interface MissionEvent {
  time: number;
  message: string;
  type: 'INFO' | 'WARN' | 'ALERT' | 'ACTION';
  tracks: Track[];
}

export const MISSION_STEPS: MissionEvent[] = [
  {
    time: 10,
    message: 'ATC: FLIGHT EK404 SQUAWKING 7500. DEVIATING FROM ASSIGNED FLIGHT PATH. INTENTIONS UNKNOWN.',
    type: 'WARN',
    tracks: [
      // The deviator. Heading 120 points from (10,10) towards Burj Khalifa (60,40)
      { ...createCrossingTrack('UNKNOWN', 'FW', 10, 10, 120, 500, 31000), id: 'FLT-EK404' }
    ]
  },
  {
    time: 20,
    message: 'HUNTRESS: ACTIVE AIR DEFENSE SCRAMBLE FOR VIPER 01 FLIGHT. SCRAMBLE IMMEDIATELY. VECTOR 320 TO INTERCEPT TRACK FLT-EK404. BUSTER.',
    type: 'ACTION',
    tracks: [
      // VIPER-01 launching from Al Minhad (65, 65). Starts low and slow, will accelerate/climb.
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 290, 250, 1000), id: 'VIPER-01', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 40, y: 40} }
    ]
  },
  {
    time: 24,
    message: 'INFO: VIPER-02 AIRBORNE.',
    type: 'INFO',
    tracks: [
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 300, 250, 1000), id: 'VIPER-02', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 45, y: 40} }
    ]
  },
  {
    time: 90,
    message: 'WARNING RED. MULTIPLE HIGH-ALTITUDE, HIGH-VELOCITY TRACKS DETECTED. EVALUATED HOSTILE MRBM. VELOCITY MACH 6. DESCENDING THROUGH FL600. IMPACT DUBAI 90 SECONDS. RECOMMEND IMMEDIATE THAAD ENGAGEMENT.',
    type: 'ALERT',
    tracks: [
      // 4x MRBMs from Iran (North) - Mach 6+ (roughly 3500-4000 knots), extreme altitude
      ...Array.from({length: 4}).map(() => createTargetTrack(
        'PENDING', 'TBM',
        340 + Math.random() * 20, // Bearing 340-360
        85 + Math.random() * 5,   // 85 NM away
        3800 + Math.random() * 400, // Mach 6+
        150000 + Math.random() * 20000, // Descending from extreme altitude
        'L16'
      ))
    ]
  },
  {
    time: 120,
    message: 'WARNING RED. MASSIVE LOW-ALTITUDE SIGNATURES DETECTED SEAWARD. EVALUATED MIXED UAS/CM SWARM. SATURATION ATTACK IMMINENT. CONSERVE HIGH-VALUE INTERCEPTORS.',
    type: 'ALERT',
    tracks: [
      // 20x Shahed-136 from Iran (North/NW). Low altitude, slow speed.
      ...Array.from({length: 20}).map(() => createTargetTrack(
        'PENDING', 'UAS', 
        315 + Math.random() * 30, // Bearing 315-345
        60 + Math.random() * 10,  // 60-70 NM away
        100 + Math.random() * 15, // ~100-115 knots
        200 + Math.random() * 300, // 200-500 ft altitude
        'LCL'
      )),
      // 8x Cruise Missiles sneaking through, faster but terrain hugging
      ...Array.from({length: 8}).map(() => createTargetTrack(
        'PENDING', 'CM', 
        300 + Math.random() * 60, // Bearing 300-360
        65 + Math.random() * 5,  // 65-70 NM away
        450 + Math.random() * 30, // 450-480 knots
        300 + Math.random() * 200, // 300-500 ft altitude
        'LCL'
      ))
    ]
  },
  {
    time: 130,
    message: 'HUNTRESS: SCRAMBLE VIPER 03 FLIGHT TO INTERCEPT LOW-ALTITUDE SWARM. WEAPONS FREE. ENGAGE TARGETS OF OPPORTUNITY.',
    type: 'ACTION',
    tracks: [
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 310, 250, 1000), id: 'VIPER-03', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 50, y: 40} }
    ]
  },
  {
    time: 134,
    message: 'INFO: VIPER-04 AIRBORNE.',
    type: 'INFO',
    tracks: [
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 320, 250, 1000), id: 'VIPER-04', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 55, y: 40} }
    ]
  }
];
