import { Track, TrackCategory, TrackType } from './types';
import { BATTERY_POS, DEFENDED_ASSETS } from './constants';
import { calculateBearing } from './utils';
import { useTrackStore } from './store';

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

  // Aim at a random defended asset in Dubai
  const targetAsset = DEFENDED_ASSETS[Math.floor(Math.random() * DEFENDED_ASSETS.length)];
  const hdg = calculateBearing(startX, startY, targetAsset.x, targetAsset.y);

  let prefix = 'TRK';
  if (category === 'UAS') prefix = 'U';
  if (category === 'CM') prefix = 'C';
  if (category === 'TBM') prefix = 'B';
  if (category === 'ROCKET') prefix = 'R';

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
    detected: isDetected,
    targetWaypoint: { x: targetAsset.x, y: targetAsset.y } // Assigned target asset
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
  action?: () => void;
}

export const MISSION_STEPS: MissionEvent[] = [
  {
    time: 10,
    message: 'ATC: FLIGHT EK404 SQUAWKING 7500. DEVIATING FROM ASSIGNED FLIGHT PATH. INTENTIONS UNKNOWN.',
    type: 'WARN',
    generateTracks: () => [] // It's already in the sim from INITIAL_TRACKS, the simulation loop will take over its hijack profile
  },
  {
    time: 20,
    message: 'HUNTRESS: ACTIVE AIR DEFENSE SCRAMBLE FOR FALCON 21, 22. SCRAMBLE IMMEDIATELY. VECTOR 320 TO INTERCEPT TRACK FLT-EK404.',
    type: 'ACTION',
    generateTracks: () => []
  },
  {
    time: 25,
    message: 'FALCON 21: AIRBORNE.',
    type: 'INFO',
    generateTracks: () => [
      { ...createCrossingTrack('FRIEND', 'FW', 57.5, 62.5, 290, 250, 1000), id: 'FALCON-21', isFighter: true, missilesRemaining: 4, fuel: 24000, maxFuel: 24000, targetWaypoint: {x: 35, y: 35} }
    ]
  },
  {
    time: 28,
    message: 'FALCON 22: AIRBORNE.',
    type: 'INFO',
    generateTracks: () => [
      { ...createCrossingTrack('FRIEND', 'FW', 57.5, 62.5, 300, 250, 1000), id: 'FALCON-22', isFighter: true, missilesRemaining: 4, fuel: 24000, maxFuel: 24000, targetWaypoint: {x: 40, y: 35} }
    ]
  },
  {
    time: 35,
    message: 'HUNTRESS: WARNING RED. SYSTEM DETECTING MULTIPLE LAUNCH SIGNATURES FROM NORTHERN SECTOR.',
    type: 'ALERT',
    generateTracks: () => []
  },
  {
    time: 37,
    message: 'HUNTRESS: ALL UNITS WCS SET TO FREE. AUTO-ENGAGEMENT DOCTRINE AUTHORIZED.',
    type: 'ACTION',
    generateTracks: () => [],
    action: () => {
      useTrackStore.getState().setWcs('FREE');
      useTrackStore.getState().setDoctrine({
        thaad: 1,
        pac3: 1,
        tamir: 1,
        cram: 1
      });
    }  },
  {
    time: 40,
    message: 'INTEL: TBM LAUNCH CONFIRMED. IMPACT DUBAI 90 SECONDS.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 3}).map(() => createTargetTrack(
      'PENDING', 'TBM',
      340 + Math.random() * 20, 
      85 + Math.random() * 5,   
      3800 + Math.random() * 400, 
      150000 + Math.random() * 20000, 
      'L16'
    ))
  },
  {
    time: 42,
    message: 'HUNTRESS: DECLARING AIRSPACE EMERGENCY. ALL SECTORS INITIATE IMMEDIATE CIVILIAN DIVERT.',
    type: 'WARN',
    generateTracks: () => []
  },
  {
    time: 43,
    message: 'ATC: ALL AIRCRAFT ON GUARD. DUBAI AIRSPACE IS CLOSED. STANDBY FOR EMERGENCY VECTORS.',
    type: 'WARN',
    generateTracks: () => []
  },
  {
    time: 45,
    message: 'ATC: EMIRATES 551, EMERGENCY VECTOR, IMMEDIATE RIGHT TURN HEADING 180. EXPEDITE CLIMB.',
    type: 'INFO',
    generateTracks: () => [],
    action: () => {
      useTrackStore.getState().updateTrack('ETD-551', t => ({ targetHdg: 180, targetSpd: 450 }));
    }
  },
  {
    time: 48,
    message: 'ATC: FLYDUBAI 22, IMMEDIATE LEFT TURN HEADING 180. EXPEDITE TO FL250.',
    type: 'INFO',
    generateTracks: () => [],
    action: () => {
      useTrackStore.getState().updateTrack('FDB-22', t => ({ targetHdg: 180, targetSpd: 450 }));
    }
  },
  {
    time: 51,
    message: 'ATC: TURKISH 418, EXECUTE EMERGENCY RIGHT TURN HEADING 120. DIVERT TO MUSCAT.',
    type: 'INFO',
    generateTracks: () => [],
    action: () => {
      useTrackStore.getState().updateTrack('THY-418', t => ({ targetHdg: 120, targetSpd: 500 }));
    }
  },
  {
    time: 54,
    message: 'ATC: QANTAS 9, EXECUTE EMERGENCY LEFT TURN HEADING 270 IMMEDIATELY.',
    type: 'INFO',
    generateTracks: () => [],
    action: () => {
      useTrackStore.getState().updateTrack('QFA-9', t => ({ targetHdg: 270, targetSpd: 500 }));
    }
  },
        {
          time: 57,
          message: 'ATC: ALL OTHER SECTORS (QTR-115, SIA-322, AIC-121), EXECUTE IMMEDIATE RIGHT TURN HEADING 270. CLEAR THE AREA.',  
          type: 'INFO',
          generateTracks: () => [],
          action: () => {
            useTrackStore.getState().updateTrack('QTR-115', t => ({ targetHdg: 270, targetSpd: 520 }));
            useTrackStore.getState().updateTrack('SIA-322', t => ({ targetHdg: 270, targetSpd: 520 }));
            useTrackStore.getState().updateTrack('AIC-121', t => ({ targetHdg: 270, targetSpd: 520 }));
          }
        },    {
      time: 60,
      message: 'ATC: UAE-992, BAW-107, CLEARED TO LAND IMMEDIATELY.',
      type: 'INFO',
      generateTracks: () => [],
      action: () => {
        useTrackStore.getState().updateTrack('UAE-992', t => ({ targetWaypoint: { x: 45, y: 67.5 } })); // DWC Airport
        useTrackStore.getState().updateTrack('BAW-107', t => ({ targetWaypoint: { x: 60, y: 46 } })); // DXB Airport
      }
    },  {
    time: 70,
    message: 'HUNTRESS: MULTI-DOMAIN ATTACK DETECTED. UAS SWARM INTERMIXED WITH SEA-SKIMMING CRUISE MISSILES INBOUND FROM THE GULF.',
    type: 'ALERT',
    generateTracks: () => [
      ...Array.from({length: 6}).map(() => createTargetTrack('PENDING', 'UAS', 315 + Math.random() * 20, 60 + Math.random() * 10, 150 + Math.random() * 20, 1500 + Math.random() * 500, 'L16')),
      ...Array.from({length: 2}).map(() => createTargetTrack('PENDING', 'CM', 320 + Math.random() * 10, 65 + Math.random() * 5, 500 + Math.random() * 30, 100 + Math.random() * 50, 'L16'))
    ]
  },
  {
    time: 85,
    message: 'WARNING RED. ROCKET SALVO DETECTED. EVALUATED POP-UP CONTACTS FROM COASTAL VESSELS. FALLING THROUGH FL250. TAMIR RECOMMENDED.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 6}).map(() => createTargetTrack(
      'PENDING', 'ROCKET',
      315 + Math.random() * 15, 
      55 + Math.random() * 10,   
      1400 + Math.random() * 100, 
      25000 + Math.random() * 5000,
      'LCL' 
    ))
  },
  {
    time: 126,
    message: 'SYS: MULTIPLE UNCORRELATED LOW-ALTITUDE CONTACTS DETECTED CLEARING HAJAR MOUNTAIN RANGE.',
    type: 'WARN',
    generateTracks: () => [
        ...Array.from({length: 4}).map(() => createTargetTrack('PENDING', 'CM', 100 + Math.random() * 20, 35 + Math.random() * 5, 500 + Math.random() * 30, 200, 'L16')),
        ...Array.from({length: 4}).map(() => createTargetTrack('PENDING', 'UAS', 90 + Math.random() * 30, 40 + Math.random() * 10, 150, 1000, 'L16'))
    ]
  },
  {
    time: 130,
    message: 'HUNTRESS: ANOTHER SWARM OF FAST MOVERS COMING OVER THE HAJAR MOUNTAINS.',
    type: 'ALERT',
    generateTracks: () => []
  },
  {
    time: 134,
    message: 'HUNTRESS: THIS IS ESCALATING BIG, BIG TIME.',
    type: 'ALERT',
    generateTracks: () => []
  },
  {
    time: 140,
    message: 'HUNTRESS: FALCON 23, 24. THIS IS AN ACTIVE AIR DEFENSE SCRAMBLE. SCRAMBLE IMMEDIATELY. VECTOR 090 TO HAJAR MOUNTAINS. YOU ARE FREE SUPERSONIC.',
    type: 'ALERT',
    generateTracks: () => []
  },
  {
    time: 145,
    message: 'FALCON 23: AIRBORNE.',
    type: 'INFO',
    generateTracks: () => [
      { ...createCrossingTrack('FRIEND', 'FW', 57.5, 62.5, 90, 250, 1000), id: 'FALCON-23', isFighter: true, missilesRemaining: 4, fuel: 24000, maxFuel: 24000, targetWaypoint: {x: 85, y: 65} }
    ]
  },
  {
    time: 148,
    message: 'FALCON 24: AIRBORNE.',
    type: 'INFO',
    generateTracks: () => [
      { ...createCrossingTrack('FRIEND', 'FW', 57.5, 62.5, 100, 250, 1000), id: 'FALCON-24', isFighter: true, missilesRemaining: 4, fuel: 24000, maxFuel: 24000, targetWaypoint: {x: 90, y: 65} }
    ]
  },
  {
    time: 170,
    message: 'WARNING RED. SECOND ROCKET SALVO DETECTED. HEAVY VOLUME FROM NORTHERN WATERS. FALLING THROUGH FL300.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 12}).map(() => createTargetTrack(
      'PENDING', 'ROCKET',
      330 + Math.random() * 20,
      65 + Math.random() * 10,
      1400 + Math.random() * 100,
      30000 + Math.random() * 5000,
      'LCL'
    ))
  },
  {
    time: 210,
    message: 'WARNING RED. ADDITIONAL MRBM TRACKS DETECTED. EVALUATED HOSTILE. FALLING THROUGH FL1600. LAYERED DEFENSE REQUIRED.',
    type: 'ALERT',
    generateTracks: () => Array.from({length: 5}).map(() => createTargetTrack(
      'PENDING', 'TBM',
      350 + Math.random() * 15, 
      90 + Math.random() * 5,   
      4000 + Math.random() * 300, 
      160000 + Math.random() * 10000, 
      'L16'
    ))
  },
  {
    time: 250,
    message: 'HUNTRESS: SOUTHERN DESERT TRACKS PUSHING INTO ENGAGEMENT ZONE.',
    type: 'WARN',
    generateTracks: () => Array.from({length: 6}).map(() => createTargetTrack(
      'PENDING', 'UAS',
      200 + Math.random() * 20, 
      70 + Math.random() * 10, 
      130 + Math.random() * 10, 
      1500 + Math.random() * 500, 
      'L16'
    ))
  },
  {
    time: 290,
    message: 'INTEL: MASSIVE COORDINATED SALVO DETECTED. TOTAL SECTOR SATURATION IMMINENT. ALL LAYERS CLEAR TO ENGAGE.',
    type: 'ALERT',
    generateTracks: () => [
      ...Array.from({length: 10}).map(() => createTargetTrack('PENDING', 'ROCKET', 315 + Math.random() * 45, 70 + Math.random() * 10, 1400, 25000, 'LCL')),
      ...Array.from({length: 4}).map(() => createTargetTrack('PENDING', 'TBM', 340 + Math.random() * 20, 85 + Math.random() * 10, 3900, 155000, 'L16')),
      ...Array.from({length: 3}).map(() => createTargetTrack('PENDING', 'CM', 90 + Math.random() * 30, 40 + Math.random() * 5, 500, 100, 'LCL'))
    ]
  }
];
