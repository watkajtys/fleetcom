import { Track, TrackCategory } from './types';
import { calculateRange, calculateBearing, calculateClosureRate, getThreatName, calculateLeadInterceptPoint, calculateTrueTimeOfFlight, MACH_TO_NM_SEC } from './utils';

// We need to know where the battery/assets are to determine if a low-value target is a threat
import { BATTERY_POS, WEAPON_STATS } from './constants';

export interface AIEvent {
  type: 'LOG' | 'COST' | 'AMRAAM_FIRED' | 'IMPACT' | 'GROUND_IMPACT' | 'SPLASH';
  message?: string;
  logType?: 'INFO' | 'WARN' | 'ALERT' | 'ACTION';
  amount?: number;
  assetId?: string;
  trackId?: string;
  x?: number;
  y?: number;
  isPopulated?: boolean;
}

class SpatialGrid {
  private cellSize: number;
  private cells: Map<string, Track[]>;

  constructor(cellSize: number) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  insert(track: Track) {
    const cx = Math.floor(track.x / this.cellSize);
    const cy = Math.floor(track.y / this.cellSize);
    const key = `${cx},${cy}`;
    if (!this.cells.has(key)) {
      this.cells.set(key, []);
    }
    this.cells.get(key)!.push(track);
  }

  getNearby(x: number, y: number, radius: number): Track[] {
    const minX = Math.floor((x - radius) / this.cellSize);
    const maxX = Math.floor((x + radius) / this.cellSize);
    const minY = Math.floor((y - radius) / this.cellSize);
    const maxY = Math.floor((y + radius) / this.cellSize);

    const result: Track[] = [];
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cy = minY; cy <= maxY; cy++) {
        const cell = this.cells.get(`${cx},${cy}`);
        if (cell) result.push(...cell);
      }
    }
    return result;
  }
}

// The core fighter state processing
export const processFighters = (
  tracks: Track[], 
  events: AIEvent[],
  now: number
): Track[] => {
  
  // Create a fast O(1) lookup map to prevent O(N) searches inside the loops
  const trackMap = new Map(tracks.map(t => [t.id, t]));

  // 1. Pre-process the battlespace for the fighters
  const hostiles = tracks.filter(t => 
    t.type === 'HOSTILE' && 
    t.category !== 'TBM' &&
    t.category !== 'ROCKET' &&
    (!t.interceptors || t.interceptors.length === 0)
  );
  const unknowns = tracks.filter(t => !t.iffInterrogated && !t.isFighter);
  
  // Spatial Indexing for fast neighbor lookups
  const MAX_DETECT_RANGE = 250; // Increased from 50 to 250 to allow AWACS/L16 intercept vectoring across the entire theater
  const unknownGrid = new SpatialGrid(20); // 20 NM cells for fast 20 NM VID checks
  unknowns.forEach(u => unknownGrid.insert(u));

  const hostileGrid = new SpatialGrid(50); // 50 NM cells for engagement range checks
  hostiles.forEach(h => hostileGrid.insert(h));

  // We use this to prevent two fighters from launching at the same target in the same sweep
  const currentlyTargetedIds = new Set<string>();

  return tracks.map(track => {
    // We only process active fighters
    if (!track.isFighter || track.isRTB) return track;

    // 2. Visual ID Logic (VID) - Fighter identifies unknowns at close range (using advanced targeting pod / radar)
    const nearbyUnknowns = unknownGrid.getNearby(track.x, track.y, 20.0);
    nearbyUnknowns.forEach(u => {
      if (calculateRange(track.x, track.y, u.x, u.y, track.alt, u.alt) < 20.0) {
        const uInNext = trackMap.get(u.id); // O(1) lookup
        if (uInNext && !uInNext.iffInterrogated) {
          const isHijack = uInNext.id === 'FLT-EK404';
          const isCivilian = !isHijack && (uInNext.category === 'FW' || uInNext.category === 'RW') && uInNext.type !== 'HOSTILE' && uInNext.spd > 250 && uInNext.alt > 10000;

          const threatName = isHijack ? 'HIJACK' : (isCivilian ? 'CIVILIAN' : getThreatName(uInNext.category));
          
          let threatType = uInNext.type;
          let logType: 'INFO' | 'WARN' | 'ALERT' = 'ALERT';

          if (isHijack) {
            threatType = 'SUSPECT';
          } else if (isCivilian || uInNext.type === 'FRIEND' || uInNext.type === 'ASSUMED_FRIEND' || uInNext.type === 'NEUTRAL') {
             threatType = isCivilian ? 'FRIEND' : uInNext.type; // Force sweet/civilians to FRIEND
             logType = 'INFO';
          } else if (uInNext.category === 'FW' || uInNext.category === 'RW' || uInNext.category === 'UAS') {
             threatType = 'SUSPECT';
             if (uInNext.category === 'UAS') logType = 'ALERT'; // Elevate UAS VID to ALERT
          } else {
             threatType = 'HOSTILE';
          }
          
          uInNext.iffInterrogated = true;
          // Hardening: Preserve manual HOSTILE status
          if (uInNext.type !== 'HOSTILE') uInNext.type = threatType;
          uInNext.threatName = threatName;
          
          // Use FALCON prefix to avoid Huntress popups for routine VIDs
          events.push({ type: 'LOG', message: `${track.id}: VID TRACK ${u.id} - ${threatName}.`, logType });
        }
      }
    });

    // 4. Engagement Logic
    if ((track.missilesRemaining || 0) <= 0) return track;

    const WEAPON_RANGE = 18;

    let bestTarget: Track | null = null;
    let minRange = MAX_DETECT_RANGE;
    let highestValue = -1;

    const nearbyHostiles = hostileGrid.getNearby(track.x, track.y, MAX_DETECT_RANGE);
    for (const hostile of nearbyHostiles) {
      if (currentlyTargetedIds.has(hostile.id)) continue; // Deconfliction: Someone else is shooting it

      const range = calculateRange(track.x, track.y, hostile.x, hostile.y, track.alt, hostile.alt);
      if (range > MAX_DETECT_RANGE) continue;

      // We prioritize High Value (Cruise Missiles, Aircraft) over Low Value (UAS), 
      // but fighters will still engage UAS if no high-value targets are available.
      let isHighValue = hostile.category !== 'UAS';
      let targetValue = isHighValue ? 100 : 10;
      
      // If we find a closer target of the same value, take it.
      if (targetValue > highestValue || (targetValue === highestValue && range < minRange)) {
        highestValue = targetValue;
        minRange = range;
        bestTarget = hostile;
      }
    }

    if (bestTarget) {
      currentlyTargetedIds.add(bestTarget.id);
      
      const bearingToTarget = calculateBearing(track.x, track.y, bestTarget.x, bestTarget.y);
      let aspectDiff = Math.abs(track.hdg - bearingToTarget);
      if (aspectDiff > 180) aspectDiff = 360 - aspectDiff;

      // Fire logic
      // Expanded to 90 degrees to account for radar field of regard and high-deflection lead pursuit angles
      if (minRange <= WEAPON_RANGE && aspectDiff <= 90) {
        const targetId = bestTarget.id;
        const fighterId = track.id;
        
        const missileSpdNmSec = WEAPON_STATS['AMRAAM'].speedMach * MACH_TO_NM_SEC;
        let interceptDurationSecs = calculateTrueTimeOfFlight({x: track.x, y: track.y, alt: track.alt}, bestTarget, missileSpdNmSec);
        const maxFlightTime = WEAPON_STATS['AMRAAM'].range / missileSpdNmSec;

        events.push({ type: 'LOG', message: `${fighterId}: Fox-3 TRACK ${targetId}.`, logType: 'ACTION' });
        events.push({ type: 'COST', amount: 1200000 });
        events.push({ type: 'AMRAAM_FIRED' });

        // Pre-calculate Pk for live destruction
        const pkValue = WEAPON_STATS['AMRAAM'].pk;
        let isPkHit = Math.random() <= pkValue;
        
        if (interceptDurationSecs > maxFlightTime) {
          interceptDurationSecs = maxFlightTime;
          isPkHit = false; // Out of fuel
        }

        const interceptTimeMs = interceptDurationSecs * 1000;

        const targetInNext = trackMap.get(targetId); // O(1) lookup
        if (targetInNext) {
          targetInNext.interceptors = targetInNext.interceptors || [];
          targetInNext.interceptors.push({
            id: `AAM-${now}-${Math.random()}`,
            weapon: 'AMRAAM',
            shooterId: fighterId,
            launchPos: { x: track.x, y: track.y },
            engagementTime: now,
            interceptDuration: interceptTimeMs,
            interceptTtl: Math.ceil(interceptDurationSecs),
            isPkHit
          });
        }
        
        return { 
          ...track, 
          missilesRemaining: track.missilesRemaining! - 1, 
          targetWaypoint: track.patrolWaypoint || null
        };
      } else {
        // Intercept logic (Lead Pursuit)
        // Only log if we are newly assigning this target
        if (track.targetId !== bestTarget.id) {
          events.push({ type: 'LOG', message: `${track.id}: Intercepting TRACK ${bestTarget.id}.`, logType: 'INFO' });
        }

        // Assume maximum intercept speed (1300 knots) for lead calculation
        const leadPoint = calculateLeadInterceptPoint({x: track.x, y: track.y, spd: 1300}, bestTarget);

        return { ...track, targetWaypoint: leadPoint, targetId: bestTarget.id };
        }
        } else if (track.targetId) {
        // If we HAD a target (targetId is set) but bestTarget is null, it means the target was destroyed or lost.
        // Clear the targetId so we can return to patrol.
        events.push({ type: 'LOG', message: `${track.id}: Target lost or destroyed. Resuming patrol.`, logType: 'INFO' });
        return { ...track, targetId: undefined, targetWaypoint: null };
        }    
    // If no target, return to flight path or patrol waypoint
    if (track.flightPath && track.flightPath.length > 0) {
      const nextWp = track.flightPath[0];
      const isAlreadyTarget = track.targetWaypoint?.x === nextWp.x && track.targetWaypoint?.y === nextWp.y;
      const isAtPatrol = calculateRange(track.x, track.y, nextWp.x, nextWp.y) <= 1.5;

      if (!isAlreadyTarget && !isAtPatrol) {
        return { ...track, targetWaypoint: nextWp };
      }
    } else if (track.patrolWaypoint) {
      // Don't re-assign if it's already the target, or if we are already there (target is null from arriving)
      const isAlreadyTarget = track.targetWaypoint?.x === track.patrolWaypoint.x && track.targetWaypoint?.y === track.patrolWaypoint.y;
      const isAtPatrol = calculateRange(track.x, track.y, track.patrolWaypoint.x, track.patrolWaypoint.y) <= 1.5;

      if (!isAlreadyTarget && !isAtPatrol) {
        return { ...track, targetWaypoint: track.patrolWaypoint };
      }
    }    
    return track;
  });
};
