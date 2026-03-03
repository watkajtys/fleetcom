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
    sensor
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
    sensor: 'L16'
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
    time: 5,
    message: 'INTEL: EXPECTED UAS SWARM LAUNCH DETECTED FROM COASTAL REGION.',
    type: 'WARN',
    tracks: [
      // 20 UAS tracks, 35-40 NM away (beyond radar horizon for 200ft)
      ...Array.from({length: 20}).map(() => createTargetTrack(
        'PENDING', 'UAS', 
        300 + Math.random() * 120, 
        35 + Math.random() * 5,    
        100 + Math.random() * 15,  
        200, // 200 ft altitude makes them invisible until ~30 NM
        'LCL'
      )),
      // 2 Commercial flights crossing
      createCrossingTrack('ASSUMED_FRIEND', 'FW', 10, 50, 90, 450, 35000),
      createCrossingTrack('ASSUMED_FRIEND', 'FW', 80, 20, 270, 420, 33000),
    ]
  },
  {
    time: 180, // 3 mins
    message: 'WARNING: FAST MOVERS DETECTED LOW ALTITUDE. POSSIBLE LACM.',
    type: 'ALERT',
    tracks: [
      // 8 CMs, 45-50 NM away (beyond radar horizon for 500ft)
      ...Array.from({length: 8}).map(() => createTargetTrack(
        'PENDING', 'CM', 
        340 + Math.random() * 40, 
        45 + Math.random() * 5, 
        450 + Math.random() * 50, 
        500, // 500 ft altitude makes them invisible until ~40 NM
        'LCL'
      ))
    ]
  },
  {
    time: 330, // 5.5 mins
    message: 'VAMPIRE VAMPIRE VAMPIRE. TACTICAL BALLISTIC MISSILES INBOUND.',
    type: 'ALERT',
    tracks: [
      // 6 TBMs, 100 NM away, high altitude (visible immediately)
      ...Array.from({length: 6}).map(() => createTargetTrack(
        'PENDING', 'TBM', 
        350 + Math.random() * 20, 
        95 + Math.random() * 5, 
        3500 + Math.random() * 500, 
        150000, 
        'L16'
      ))
    ]
  }
];
