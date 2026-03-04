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
    message: 'ATC: TRACK 101 SQUAWKING 7500. DEVIATING FROM ASSIGNED FLIGHT PATH. INTENTIONS UNKNOWN.',
    type: 'WARN',
    tracks: [
      // The deviator. Heading 120 points from (10,10) towards Burj Khalifa (60,40)
      createCrossingTrack('UNKNOWN', 'FW', 10, 10, 120, 500, 31000)
    ]
  },
  {
    time: 20,
    message: 'THIS IS HUNTRESS WITH AN ACTIVE AIR DEFENSE SCRAMBLE FOR VIPER 01 FLIGHT. SCRAMBLE IMMEDIATELY. VECTOR 320, BUSTER.',
    type: 'INFO',
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
    time: 28,
    message: 'INFO: VIPER-03 AIRBORNE.',
    type: 'INFO',
    tracks: [
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 310, 250, 1000), id: 'VIPER-03', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 50, y: 40} }
    ]
  },
  {
    time: 32,
    message: 'INFO: VIPER-04 AIRBORNE.',
    type: 'INFO',
    tracks: [
      { ...createCrossingTrack('FRIEND', 'FW', 65, 65, 320, 250, 1000), id: 'VIPER-04', isFighter: true, missilesRemaining: 4, targetWaypoint: {x: 55, y: 40} }
    ]
  },
  {
    time: 60,
    message: 'WARNING RED. MULTIPLE BOGEYS DETECTED. EVALUATED HOSTILE UAS SWARM. WEAPONS FREE.',
    type: 'ALERT',
    tracks: [
      // 24x Shahed-136 from Iran (North/NW). Low altitude, slow speed.
      // Enough to be a serious threat and drain magazines if engaged improperly, but not 120.
      ...Array.from({length: 24}).map(() => createTargetTrack(
        'PENDING', 'UAS', 
        315 + Math.random() * 30, // Bearing 315-345
        75 + Math.random() * 10,  // 75-85 NM away
        110 + Math.random() * 20, // 110-130 knots
        200 + Math.random() * 300, // 200-500 ft altitude
        'LCL'
      ))
    ]
  },
  {
    time: 140,
    message: 'WARNING RED. MULTIPLE FAST MOVERS DETECTED. EVALUATED HOSTILE CRUISE MISSILES. TERRAIN MASKING INDICATED.',
    type: 'ALERT',
    tracks: [
      // 8x Quds-2 LACMs sneaking through the mountains
      // Delayed to arrive while fighters are busy with the UAS swarm
      ...Array.from({length: 8}).map(() => createTargetTrack(
        'PENDING', 'CM', 
        60 + Math.random() * 40, // Bearing 060-100 (East)
        65 + Math.random() * 5,  // 65-70 NM away
        450 + Math.random() * 30, // 450-480 knots
        300 + Math.random() * 200, // 300-500 ft altitude
        'LCL'
      ))
    ]
  },
  {
    time: 220,
    message: 'ALARM RED. SCUD LAUNCHES DETECTED. INBOUND DUBAI. CRITERIA MET. WEAPONS FREE.',
    type: 'ALERT',
    tracks: [
      // 6x MRBMs from Iran (North)
      // The knockout blow, arriving when defenses are stressed
      ...Array.from({length: 6}).map(() => createTargetTrack(
        'PENDING', 'TBM', 
        340 + Math.random() * 20, // Bearing 340-360
        85 + Math.random() * 5,   // 85 NM away
        4000 + Math.random() * 500, // Mach 6+
        200000 + Math.random() * 50000, // 200k+ ft
        'L16' 
      )),
      // 4x MRBMs from Yemen (South/SW)
      ...Array.from({length: 4}).map(() => createTargetTrack(
        'PENDING', 'TBM', 
        180 + Math.random() * 40, // Bearing 180-220
        85 + Math.random() * 5,   // 85 NM away
        4000 + Math.random() * 500, // Mach 6+
        200000 + Math.random() * 50000, // 200k+ ft
        'L16' 
      ))
    ]
  }
];
