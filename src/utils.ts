import { Track, TrackCategory } from './types';
import { BATTERY_POS } from './constants';

export const getThreatName = (category: TrackCategory) => {
  switch (category) {
    case 'FW': return 'Su-35 FLANKER-E';
    case 'RW': return 'Ka-52 HOKUM-B';
    case 'UAS': return 'Shahed-136';
    case 'CM': return 'Kalibr 3M-14';
    case 'TBM': return 'Fateh-110';
    default: return 'UNKNOWN THREAT';
  }
};

export const calculateRange = (x1: number, y1: number, x2: number, y2: number) => 
  Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));

export const calculateBearing = (x1: number, y1: number, x2: number, y2: number) => 
  Math.round(Math.atan2(y2 - y1, x1 - x2) * (180 / Math.PI) + 90 + 360) % 360;

export const calculateKinematics = (track: Track) => {
  const spdNmSec = track.spd / 3600;
  const rad = track.hdg * (Math.PI / 180);
  const vx = Math.sin(rad) * spdNmSec;
  const vy = -Math.cos(rad) * spdNmSec;

  const dx = track.x - BATTERY_POS.x;
  const dy = track.y - BATTERY_POS.y;

  const v2 = vx * vx + vy * vy;
  if (v2 === 0) return { cpa: calculateRange(track.x, track.y, BATTERY_POS.x, BATTERY_POS.y).toFixed(1), tcpa: 0 };

  let tcpa = -(dx * vx + dy * vy) / v2;
  if (tcpa < 0) tcpa = 0;

  const cpaX = dx + tcpa * vx;
  const cpaY = dy + tcpa * vy;
  const cpa = Math.sqrt(cpaX * cpaX + cpaY * cpaY);

  return { cpa: cpa.toFixed(1), tcpa: Math.round(tcpa) };
};

export const calculateClosureRate = (shooter: {x: number, y: number}, target: Track, missileSpdNmSec: number) => {
  const bearingShooterToTarget = calculateBearing(shooter.x, shooter.y, target.x, target.y);
  const bearingTargetToShooter = (bearingShooterToTarget + 180) % 360;
  
  // Angle between target's heading and the line back to the shooter
  let aspectAngle = Math.abs(target.hdg - bearingTargetToShooter);
  if (aspectAngle > 180) aspectAngle = 360 - aspectAngle;
  
  const radAspect = aspectAngle * (Math.PI / 180);
  const targetRadialVel = (target.spd / 3600) * Math.cos(radAspect);
  
  // Vc = V_missile + V_target_radial
  // (If target is moving away, targetRadialVel becomes negative)
  return missileSpdNmSec + targetRadialVel;
};
