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

export const FT_TO_NM = 1 / 6076.12;
export const MACH_TO_NM_SEC = 0.18374; // Mach 1 in NM/sec (approx 661.47 kts)

export const calculateRange = (x1: number, y1: number, x2: number, y2: number, alt1: number = 0, alt2: number = 0) => {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const dz = (alt1 - alt2) * FT_TO_NM;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export const calculateBearing = (x1: number, y1: number, x2: number, y2: number) => 
  Math.round(Math.atan2(x2 - x1, -(y2 - y1)) * (180 / Math.PI) + 360) % 360;

export const calculateKinematics = (track: Track) => {
  const spdNmSec = track.spd / 3600;
  const rad = track.hdg * (Math.PI / 180);
  const vx = Math.sin(rad) * spdNmSec;
  const vy = -Math.cos(rad) * spdNmSec;

  const dx = track.x - BATTERY_POS.x;
  const dy = track.y - BATTERY_POS.y;

  const v2 = vx * vx + vy * vy;
  if (v2 === 0) return { cpa: calculateRange(track.x, track.y, BATTERY_POS.x, BATTERY_POS.y, track.alt, 0).toFixed(1), tcpa: 0 };

  let tcpa = -(dx * vx + dy * vy) / v2;
  if (tcpa < 0) tcpa = 0;

  const cpaX = dx + tcpa * vx;
  const cpaY = dy + tcpa * vy;
  // CPA also factors in altitude
  const cpaZ = track.alt * FT_TO_NM;
  const cpa = Math.sqrt(cpaX * cpaX + cpaY * cpaY + cpaZ * cpaZ);

  return { cpa: cpa.toFixed(1), tcpa: Math.round(tcpa) };
};

export const calculateClosureRate = (shooter: {x: number, y: number, alt?: number}, target: Track, missileSpdNmSec: number) => {
  const shooterAlt = shooter.alt || 0;
  
  // 3D Distance
  const dist = calculateRange(shooter.x, shooter.y, target.x, target.y, shooterAlt, target.alt);
  if (dist < 0.1) return missileSpdNmSec; // Too close, avoid div by zero

  // Relative Velocity Vector (Target)
  const tSpdNmSec = target.spd / 3600;
  const tRad = target.hdg * (Math.PI / 180);
  const tvx = Math.sin(tRad) * tSpdNmSec;
  const tvy = -Math.cos(tRad) * tSpdNmSec;
  
  // Note: We don't have target's vertical speed (vclimb) in types yet, 
  // but we can infer it for ballistic targets if needed. For now, assume level flight velocity for closure.
  // Unless it's a TBM in terminal dive (we know that's ~4000ft/sec = ~0.65 NM/sec)
  let tvz = 0;
  if (target.category === 'TBM' && calculateRange(target.x, target.y, BATTERY_POS.x, BATTERY_POS.y) < 40) {
    tvz = -4000 * FT_TO_NM; // 4000 ft/sec descent
  } else if (target.category === 'ROCKET') {
    // Rockets now apex at 45NM and descend ~666ft per horizontal NM.
    // At 1400 knots (0.38 NM/sec), this equates to roughly 250 ft/sec descent.
    tvz = -250 * FT_TO_NM;
  }

  // Unit vector from target to shooter
  const ux = (shooter.x - target.x) / dist;
  const uy = (shooter.y - target.y) / dist;
  const uz = (shooterAlt - target.alt) * FT_TO_NM / dist;

  // Project target velocity onto unit vector to get radial velocity component
  const targetRadialVel = (tvx * ux + tvy * uy + tvz * uz);
  
  // Vc = V_missile + V_target_radial_towards_missile
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

