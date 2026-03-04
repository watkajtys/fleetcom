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

// Calculates a lead intercept point based on constant fighter speed
export const calculateLeadInterceptPoint = (
  fighter: {x: number, y: number, spd: number}, // spd in knots
  target: Track
): {x: number, y: number} => {
  const fSpdNmSec = fighter.spd / 3600;
  const tSpdNmSec = target.spd / 3600;
  
  const radT = target.hdg * (Math.PI / 180);
  const tvx = Math.sin(radT) * tSpdNmSec;
  const tvy = -Math.cos(radT) * tSpdNmSec; // y increases downwards
  
  const dx = target.x - fighter.x;
  const dy = target.y - fighter.y;
  
  // Quadratic equation for intercept time: a*t^2 + b*t + c = 0
  const a = tvx*tvx + tvy*tvy - fSpdNmSec*fSpdNmSec;
  const b = 2 * (dx*tvx + dy*tvy);
  const c = dx*dx + dy*dy;
  
  // If a is near 0, speeds are matched, solve linear
  if (Math.abs(a) < 0.001) {
    if (b < 0) {
      const t = -c / b;
      return { x: target.x + tvx * t, y: target.y + tvy * t };
    }
    return { x: target.x, y: target.y }; // Tail chase
  }
  
  const discriminant = b*b - 4*a*c;
  if (discriminant < 0) {
    // Cannot intercept (target faster and flying away) - aim at current pos
    return { x: target.x, y: target.y };
  }
  
  const t1 = (-b + Math.sqrt(discriminant)) / (2*a);
  const t2 = (-b - Math.sqrt(discriminant)) / (2*a);
  
  // Find the smallest positive time
  let t = -1;
  if (t1 >= 0 && t2 >= 0) t = Math.min(t1, t2);
  else if (t1 >= 0) t = t1;
  else if (t2 >= 0) t = t2;
  
  if (t < 0) return { x: target.x, y: target.y };
  
  // Cap lead intercept prediction at 120 seconds to prevent chasing ghosts off-map
  t = Math.min(t, 120);
  
  return {
    x: target.x + tvx * t,
    y: target.y + tvy * t
  };
};

// Calculates a waypoint 50NM away along a 50-degree offset from the target
export const calculateCrankWaypoint = (
  fighter: {x: number, y: number, hdg: number},
  target: {x: number, y: number}
): {x: number, y: number} => {
  const bearingToTarget = calculateBearing(fighter.x, fighter.y, target.x, target.y);
  
  // Calculate which side is a smaller turn from current heading
  let leftTurn = (fighter.hdg - 50 + 360) % 360;
  let rightTurn = (fighter.hdg + 50) % 360;
  
  // Determine if target is to the left or right of current heading
  let relativeBearing = bearingToTarget - fighter.hdg;
  if (relativeBearing > 180) relativeBearing -= 360;
  if (relativeBearing < -180) relativeBearing += 360;
  
  // Crank away from the target (if target is left, crank right)
  const crankHdg = relativeBearing < 0 ? rightTurn : leftTurn;
  
  const radHdg = crankHdg * (Math.PI / 180);
  
  // Set a waypoint 50NM along the crank heading to keep the fighter moving that way
  return {
    x: fighter.x + Math.sin(radHdg) * 50,
    y: fighter.y - Math.cos(radHdg) * 50
  };
};
