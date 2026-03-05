import { Track, TrackCategory } from './types';
import { calculateRange, calculateBearing, calculateClosureRate, getThreatName, calculateLeadInterceptPoint } from './utils';

// We need to know where the battery/assets are to determine if a low-value target is a threat
import { BATTERY_POS } from './constants';

export interface AIEvent {
  type: 'LOG' | 'COST' | 'AMRAAM_FIRED';
  message?: string;
  logType?: 'INFO' | 'WARN' | 'ALERT' | 'ACTION';
  amount?: number;
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
  const unknowns = tracks.filter(t => (t.type === 'UNKNOWN' || t.type === 'PENDING' || t.type === 'SUSPECT') && !t.iffInterrogated);
  
  // Spatial Indexing for fast neighbor lookups
  const MAX_DETECT_RANGE = 50;
  const unknownGrid = new SpatialGrid(10); // 10 NM cells for fast 3 NM VID checks
  unknowns.forEach(u => unknownGrid.insert(u));

  const hostileGrid = new SpatialGrid(MAX_DETECT_RANGE); // 50 NM cells for engagement range checks
  hostiles.forEach(h => hostileGrid.insert(h));

  // We use this to prevent two fighters from launching at the same target in the same sweep
  const currentlyTargetedIds = new Set<string>();

  return tracks.map(track => {
    // We only process active fighters
    if (!track.isFighter || track.isRTB) return track;

    // 2. Visual ID Logic (VID) - Fighter identifies unknowns at close range
    const nearbyUnknowns = unknownGrid.getNearby(track.x, track.y, 3.0);
    nearbyUnknowns.forEach(u => {
      if (calculateRange(track.x, track.y, u.x, u.y, track.alt, u.alt) < 3.0) {
        const uInNext = trackMap.get(u.id); // O(1) lookup
        if (uInNext && !uInNext.iffInterrogated) {
          const threatName = uInNext.id === 'FLT-EK404' ? 'HIJACK' : getThreatName(uInNext.category);
          
          let threatType: 'SUSPECT' | 'HOSTILE' = 'HOSTILE';
          if (uInNext.id === 'FLT-EK404') threatType = 'SUSPECT';
          else if (uInNext.category === 'FW' || uInNext.category === 'RW' || uInNext.category === 'UAS') threatType = 'SUSPECT'; // Manned aircraft & drones are suspect until declared
          
          uInNext.iffInterrogated = true;
          // Hardening: Preserve manual HOSTILE status
          if (uInNext.type !== 'HOSTILE') uInNext.type = threatType;
          uInNext.threatName = threatName;
          events.push({ type: 'LOG', message: `${track.id}: TRACK ${u.id} VID ${threatName}.`, logType: 'ALERT' });
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

      // Conservation of Fires (Cost-Awareness)
      // Drones are cheap. Don't waste a $1.2M AMRAAM unless it's within 20NM of the Battery.
      let isHighValue = hostile.category !== 'UAS';
      let isImmediateThreat = calculateRange(hostile.x, hostile.y, BATTERY_POS.x, BATTERY_POS.y, hostile.alt, 0) < 20;

      if (!isHighValue && !isImmediateThreat) {
        // Skip this target. It's too cheap and too far away. Let the SHORAD deal with it later.
        continue;
      }

      // We prioritize High Value, then Range.
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
      if (minRange <= WEAPON_RANGE && aspectDiff <= 45) {
        const targetId = bestTarget.id;
        const fighterId = track.id;
        
        const missileSpdNmSec = 1.0; // Mach 4.5 AMRAAM
        const closureRate = calculateClosureRate({x: track.x, y: track.y}, bestTarget, missileSpdNmSec);
        const interceptTimeSecs = minRange / Math.max(0.1, closureRate);
        const interceptTimeMs = interceptTimeSecs * 1000;

        events.push({ type: 'LOG', message: `${fighterId}: Fox-3 TRACK ${targetId}.`, logType: 'ACTION' });
        events.push({ type: 'COST', amount: 1200000 });
        events.push({ type: 'AMRAAM_FIRED' });

        // Note: The actual interceptor injection happens in App.tsx to avoid mutating state deeply here,
        // but for now we'll mutate the incoming array as it's a draft array in the sweepTimer.
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
            interceptTtl: Math.ceil(interceptTimeSecs)
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
    }
    
    // If no target, return to patrol waypoint
    if (track.patrolWaypoint) {
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
