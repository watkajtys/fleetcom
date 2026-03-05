import { Track, TrackCategory } from './types';
import { calculateRange, calculateBearing, calculateClosureRate, getThreatName, calculateLeadInterceptPoint } from './utils';

// We need to know where the battery/assets are to determine if a low-value target is a threat
import { BATTERY_POS } from './constants';

export interface AIEvent {
  type: 'LOG' | 'COST';
  message?: string;
  logType?: 'INFO' | 'WARN' | 'ALERT' | 'ACTION';
  amount?: number;
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
  const hostiles = tracks.filter(t => t.type === 'HOSTILE' && (!t.interceptors || t.interceptors.length < 2));
  const unknowns = tracks.filter(t => (t.type === 'UNKNOWN' || t.type === 'PENDING' || t.type === 'SUSPECT') && !t.iffInterrogated);
  
  // We use this to prevent two fighters from launching at the same target in the same sweep
  const currentlyTargetedIds = new Set<string>();

  return tracks.map(track => {
    // We only process active fighters
    if (!track.isFighter || track.isRTB) return track;

    // 2. Visual ID Logic (VID) - Fighter identifies unknowns at close range
    unknowns.forEach(u => {
      if (calculateRange(track.x, track.y, u.x, u.y) < 3.0) {
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

    const MAX_DETECT_RANGE = 50;
    const WEAPON_RANGE = 18;
    const searchRange = track.targetWaypoint ? WEAPON_RANGE : MAX_DETECT_RANGE;

    let bestTarget: Track | null = null;
    let minRange = searchRange;
    let highestValue = -1;

    for (const hostile of hostiles) {
      if (currentlyTargetedIds.has(hostile.id)) continue; // Deconfliction: Someone else is shooting it

      const range = calculateRange(track.x, track.y, hostile.x, hostile.y);
      if (range > searchRange) continue;

      // Conservation of Fires (Cost-Awareness)
      // Drones are cheap. Don't waste a $1.2M AMRAAM unless it's within 20NM of the Battery.
      let isHighValue = hostile.category !== 'UAS';
      let isImmediateThreat = calculateRange(hostile.x, hostile.y, BATTERY_POS.x, BATTERY_POS.y) < 20;

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

        events.push({ type: 'LOG', message: `${fighterId}: Fox-3 TRACK ${targetId}. Skinned.`, logType: 'ACTION' });
        events.push({ type: 'COST', amount: 1200000 });

        // Note: The actual interceptor injection happens in App.tsx to avoid mutating state deeply here,
        // but for now we'll mutate the incoming array as it's a draft array in the sweepTimer.
        const targetInNext = trackMap.get(targetId); // O(1) lookup
        if (targetInNext) {
          targetInNext.interceptors = targetInNext.interceptors || [];
          targetInNext.interceptors.push({
            id: `AAM-${Date.now()}-${Math.random()}`,
            weapon: 'AMRAAM',
            shooterId: fighterId,
            launchPos: { x: track.x, y: track.y },
            engagementTime: Date.now(),
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
        if (!track.targetWaypoint || calculateRange(track.targetWaypoint.x, track.targetWaypoint.y, bestTarget.x, bestTarget.y) > 2) {
          events.push({ type: 'LOG', message: `${track.id}: Intercepting TRACK ${bestTarget.id}.`, logType: 'INFO' });
        }
        
        // Assume maximum intercept speed (1100 knots) for lead calculation
        const leadPoint = calculateLeadInterceptPoint({x: track.x, y: track.y, spd: 1100}, bestTarget);
        
        return { ...track, targetWaypoint: leadPoint };
      }
    }
    
    // If no target, return to patrol waypoint
    if (track.patrolWaypoint && track.targetWaypoint !== track.patrolWaypoint) {
      return { ...track, targetWaypoint: track.patrolWaypoint };
    }
    
    return track;
  });
};
