/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Track, TrackType, SystemLog, EngagementDoctrine } from './types';
import { BATTERY_POS, BULLSEYE_POS, WEAPON_STATS, INITIAL_TRACKS, DEFENDED_ASSETS } from './constants';
import { getThreatName, calculateRange, calculateBearing, calculateKinematics, calculateClosureRate, MACH_TO_NM_SEC } from './utils';
import { MISSION_STEPS } from './mission';
import { processFighters } from './ai';
import { useSyncExternalStore } from 'react';
import BriefingModal from './BriefingModal';
import AfterActionReport from './AfterActionReport';

const nowStore = {
  now: Date.now(),
  realTime: Date.now(),
  isPaused: false,
  mouseCoords: { x: 0, y: 0 },
  timeListeners: new Set<() => void>(),
  mouseListeners: new Set<() => void>(),
  rafId: 0,

  setPaused: (p: boolean) => {
    nowStore.isPaused = p;
    nowStore.realTime = Date.now();
  },
  
  subscribeTime: (listener: () => void) => {
    nowStore.timeListeners.add(listener);
    if (nowStore.timeListeners.size === 1 && nowStore.mouseListeners.size === 0) {
      nowStore.start();
    }
    return () => {
      nowStore.timeListeners.delete(listener);
      if (nowStore.timeListeners.size === 0 && nowStore.mouseListeners.size === 0) {
        nowStore.stop();
      }
    };
  },

  subscribeMouse: (listener: () => void) => {
    nowStore.mouseListeners.add(listener);
    if (nowStore.mouseListeners.size === 1 && nowStore.timeListeners.size === 0) {
      nowStore.start();
    }
    return () => {
      nowStore.mouseListeners.delete(listener);
      if (nowStore.timeListeners.size === 0 && nowStore.mouseListeners.size === 0) {
        nowStore.stop();
      }
    };
  },

  getSnapshot: () => nowStore.now,
  getMouseSnapshot: () => nowStore.mouseCoords,
  
  updateMouse: (x: number, y: number) => {
    nowStore.mouseCoords = { x, y };
    nowStore.mouseListeners.forEach(l => l());
  },

  start: () => {
    nowStore.realTime = Date.now();
    const tick = () => {
      const currentReal = Date.now();
      const dt = currentReal - nowStore.realTime;
      nowStore.realTime = currentReal;

      if (!nowStore.isPaused) {
        nowStore.now += dt;
        nowStore.timeListeners.forEach(l => l());
      }
      
      nowStore.rafId = requestAnimationFrame(tick);
    };
    nowStore.rafId = requestAnimationFrame(tick);
  },
  stop: () => {
    cancelAnimationFrame(nowStore.rafId);
  }
};

function useNow() {
  return useSyncExternalStore(nowStore.subscribeTime, nowStore.getSnapshot);
}

function useMouseCoords() {
  return useSyncExternalStore(nowStore.subscribeMouse, nowStore.getMouseSnapshot);
}

const getZuluTimeStr = (offsetMs: number = 0) => {
  const now = new Date(Date.now() + offsetMs);
  return now.toISOString().substring(11, 19) + 'Z';
};

const MissileVector = React.memo(({ interceptor, track, color, cameraZoom, showTti }: { interceptor: any, track: Track, color: string, cameraZoom: number, showTti: boolean }) => {
  const _renderTrigger = useNow(); // Triggers the RAF loop
  const currentSimTime = nowStore.now; // The actual physics time
  const lastSweepTime = useTrackStore(state => state.lastSweepTime);
  if (!interceptor.engagementTime || !interceptor.interceptDuration || interceptor.interceptTtl === undefined) return null;
  
  // 1. Calculate continuous progress based on original launch time
  const elapsedSinceLaunch = currentSimTime - interceptor.engagementTime;
  
  if (elapsedSinceLaunch < 0) return null; // Still in the launcher queue

  const progress = Math.min(1, Math.max(0, elapsedSinceLaunch / interceptor.interceptDuration));

  // 2. Smooth TTI for the text display
  const elapsedSinceLastSweep = (currentSimTime - lastSweepTime) / 1000;
  const smoothTti = Math.max(0, interceptor.interceptTtl - elapsedSinceLastSweep);

  if (progress >= 1) return null;

  const startX = interceptor.launchPos.x;
  const startY = interceptor.launchPos.y;

  const rad = track.hdg * Math.PI / 180;
  const sinH = Math.sin(rad);
  const cosH = Math.cos(rad);
  const spdNmSec = track.spd / 3600;

  // 3. Predict where the target is RIGHT NOW (Interpolated)
  const currentTargetX = track.x + sinH * (spdNmSec * elapsedSinceLastSweep);
  const currentTargetY = track.y - cosH * (spdNmSec * elapsedSinceLastSweep);

  // 4. Predict where the target WILL BE at impact (Lead Point)
  // Use the remaining duration rather than smoothTti to ensure the lead point stays stable
  const remainingSecs = (interceptor.interceptDuration - elapsedSinceLaunch) / 1000;
  const targetLeadX = currentTargetX + sinH * (spdNmSec * remainingSecs);
  const targetLeadY = currentTargetY - cosH * (spdNmSec * remainingSecs);

  // 5. Interpolate missile position
  let missileX = startX + (targetLeadX - startX) * progress;
  let missileY = startY + (targetLeadY - startY) * progress;

  // 6. Visual Miss Logic: If this is a miss, start drifting off-target in the final 15% of flight
  if (interceptor.isPkHit === false && progress > 0.85) {
    const missProgress = (progress - 0.85) / 0.15;
    // Drift by up to 2.5 NM by impact time
    const driftX = Math.sin(interceptor.engagementTime) * 2.5 * missProgress;
    const driftY = Math.cos(interceptor.engagementTime) * 2.5 * missProgress;
    missileX += driftX;
    missileY += driftY;
  }

  const dx = targetLeadX - missileX;
  const dy = targetLeadY - missileY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Visual stabilization: Avoid harsh length cutoff when getting close
  const visualHeadLength = Math.min(2.0, dist * 0.5); 
  const leadX = dist > 0 ? missileX + (dx / dist) * visualHeadLength : missileX;
  const leadY = dist > 0 ? missileY + (dy / dist) * visualHeadLength : missileY;

  return (
    <g>
      <line x1={startX} y1={startY} x2={missileX} y2={missileY} stroke={color} strokeWidth={0.1 / cameraZoom} strokeDasharray={`${0.2 / cameraZoom} ${0.4 / cameraZoom}`} opacity="0.4" />
      {/* If it's a miss and we are in drift, fade the pulse line to indicate loss of track */}
      <line 
        x1={missileX} y1={missileY} 
        x2={leadX} y2={leadY} 
        stroke={color} 
        strokeWidth={0.2 / cameraZoom} 
        className={interceptor.isPkHit === false && progress > 0.9 ? '' : 'animate-pulse'} 
        opacity={interceptor.isPkHit === false && progress > 0.9 ? 0.3 : 1.0}
      />
      <circle cx={missileX} cy={missileY} r={0.3 / cameraZoom} fill={color} opacity={interceptor.isPkHit === false && progress > 0.95 ? 0.5 : 1.0} />
      {/* Hide TTI if tracking is lost or if explicitly disabled to reduce clutter */}
      {showTti && !(interceptor.isPkHit === false && progress > 0.9) && (
        <text x={missileX} y={missileY - (1.2 / cameraZoom)} fill={color} fontSize={0.7 / cameraZoom} fontFamily="monospace" textAnchor="middle" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>
          TTI: {Math.ceil(smoothTti)}s
        </text>
      )}
    </g>
  );
});

import { useTrackStore } from './store';

const trackSymbolAreEqual = (
  prevProps: { trackId: string, isHooked: boolean, cameraZoom: number, filters: any },
  nextProps: { trackId: string, isHooked: boolean, cameraZoom: number, filters: any }
) => {
  if (prevProps.trackId !== nextProps.trackId) return false;
  if (prevProps.isHooked !== nextProps.isHooked) return false;
  if (prevProps.cameraZoom !== nextProps.cameraZoom) return false;
  if (prevProps.filters !== nextProps.filters) return false;
  return true;
};

const NTDS_SHAPES: Record<string, string> = {
  FRIEND: "M 4 14 A 8 8 0 0 1 20 14 Z",
  ASSUMED_FRIEND: "M 4 14 A 8 8 0 0 1 20 14 Z",
  HOSTILE: "M 4 14 L 12 4 L 20 14 Z",
  NEUTRAL: "M 4 14 L 4 4 L 20 4 L 20 14 Z",
  UNKNOWN: "M 4 14 L 4 8 L 8 4 L 16 4 L 20 8 L 20 14 Z",
  PENDING: "M 4 14 L 4 8 L 8 4 L 16 4 L 20 8 L 20 14 Z",
  SUSPECT: "M 4 14 L 4 8 L 8 4 L 16 4 L 20 8 L 20 14 Z"
};

const TrackSymbol = React.memo(({ trackId, isHooked, cameraZoom, filters }: { trackId: string, isHooked: boolean, cameraZoom: number, filters: any }) => {
  const track = useTrackStore(state => state.tracks[trackId]);
  const lastSweepTime = useTrackStore(state => state.lastSweepTime);
  const _renderTrigger = useNow(); // This triggers the re-render loop
  const currentSimTime = nowStore.now;
  
  if (!track || track.detected === false) return null;

  const showTrack = (
    (filters.showUnknowns || (track.type !== 'UNKNOWN' && track.type !== 'PENDING')) &&
    (filters.showFriends || track.type !== 'FRIEND') &&
    (filters.showNeutrals || (track.type !== 'NEUTRAL' && track.type !== 'ASSUMED_FRIEND')) &&
    (filters.showHostiles || (track.type !== 'HOSTILE' && track.type !== 'SUSPECT'))
  );

  if (!showTrack) return null;

  // Use the global sim time, not the component-local `now` snapshot, to prevent render/physics desync
  const elapsed = (currentSimTime - lastSweepTime) / 1000;
  const rad = track.hdg * (Math.PI / 180);
  const smoothX = track.x + Math.sin(rad) * ((track.spd / 3600) * elapsed);
  const smoothY = track.y - Math.cos(rad) * ((track.spd / 3600) * elapsed);

  let color = '#FFFF00'; // Pure Yellow (Pending/Unknown)
  if (track.type === 'FRIEND') color = '#00FF33'; // Tactical Green
  else if (track.type === 'ASSUMED_FRIEND' || track.type === 'NEUTRAL') color = '#00FFFF'; // Cyan
  else if (track.type === 'HOSTILE') color = '#FF0000'; // Pure Red
  else if (track.type === 'SUSPECT') color = '#FF8800'; // Orange

  // Logarithmic velocity vector
  const vectorLength = 2.0 * Math.log10(track.spd / 10 + 1); 

  return (
    <g className={track.coasting ? 'opacity-50' : 'opacity-100'}>
      {/* Pairing Lines (Shooter to Target) */}
      {track.interceptors && track.interceptors.map((interceptor) => {
        const age = currentSimTime - interceptor.engagementTime;
        if (age > 1500 && !isHooked) return null;
        
        return (
          <line 
            key={`line-${interceptor.id}`}
            x1={interceptor.launchPos.x} y1={interceptor.launchPos.y}
            x2={smoothX} y2={smoothY} 
            stroke={color} strokeWidth={0.2 / cameraZoom} strokeDasharray={`${0.5 / cameraZoom} ${0.5 / cameraZoom}`} 
            className="animate-pulse"
          />
        );
      })}

      {/* Missile Vectors & TTI */}
      {track.interceptors && track.interceptors.map((interceptor) => {
        const age = currentSimTime - interceptor.engagementTime;
        const showTti = isHooked || age < 1500;
        return (
          <MissileVector key={`missile-${interceptor.id}`} interceptor={interceptor} track={track} color={color} cameraZoom={cameraZoom} showTti={showTti} />
        );
      })}

      {/* Track History Breadcrumbs */}
      {track.history.map((pos, i) => (
        <circle key={`hist-${track.id}-${i}`} cx={pos.x} cy={pos.y} r={0.2 / cameraZoom} fill={color} opacity={0.8 - (i * 0.05)} />
      ))}
      
      <g 
        transform={`translate(${smoothX}, ${smoothY})`} 
        className="cursor-pointer"
      >
        <circle cx="0" cy="0" r={3 / cameraZoom} fill="transparent" />

        {isHooked && (
          <rect x={-1.2 / cameraZoom} y={-1.2 / cameraZoom} width={2.4 / cameraZoom} height={2.4 / cameraZoom} fill="none" stroke="#00FFFF" strokeWidth={0.15 / cameraZoom} opacity="0.8" />
        )}
        
        <line 
          x1="0" y1="0" 
          x2={Math.sin(rad) * vectorLength} 
          y2={-Math.cos(rad) * vectorLength} 
          stroke={color} strokeWidth={0.15 / cameraZoom} opacity="0.8"
          strokeDasharray={track.coasting ? `${0.5 / cameraZoom} ${0.5 / cameraZoom}` : "none"}
        />

        {/* NTDS Air Shapes from lookup */}
        <g transform={`scale(${0.08 / cameraZoom}) translate(-12, -12)`} stroke={color} strokeWidth="3" fill="none" style={{ filter: `drop-shadow(0 0 2px ${color})` }} strokeDasharray={track.coasting ? "4 4" : "none"}>
          <path d={NTDS_SHAPES[track.type] || NTDS_SHAPES.UNKNOWN} />
        </g>

        {/* On-Glass Data Block with Leader Line */}
        {isHooked && (
          <g>
            {/* Leader Line */}
            <line x1={1.0 / cameraZoom} y1={1.0 / cameraZoom} x2={1.8 / cameraZoom} y2={1.8 / cameraZoom} stroke={color} strokeWidth={0.1 / cameraZoom} opacity="0.8" />
            <g transform={`translate(${2.2 / cameraZoom}, ${2.2 / cameraZoom})`}>
              <text x="0" y="0" fill={color} fontSize={0.7 / cameraZoom} fontFamily="monospace" fontWeight="bold" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>{track.threatName || track.id}</text>
              <text x="0" y={1.0 / cameraZoom} fill={color} fontSize={0.7 / cameraZoom} fontFamily="monospace" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>{track.alt >= 18000 ? `FL${Math.round(track.alt/100)}` : `${Math.round(track.alt)} FT`} / {Math.round(track.spd).toString().padStart(3, '0')}</text>
              <text x="0" y={2.0 / cameraZoom} fill={color} fontSize={0.7 / cameraZoom} fontFamily="monospace" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>TQ: {track.tq} {track.coasting ? 'CST' : ''}</text>
            </g>
          </g>
        )}
      </g>
    </g>
  );
}, trackSymbolAreEqual);

const StaticMapBackground = React.memo(({ cameraZoom }: { cameraZoom: number }) => (
  <>
    {/* Base Grid */}
    <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
      <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#001A26" strokeWidth={0.05 / cameraZoom}/>
    </pattern>
    <rect x="-500" y="-500" width="1000" height="1000" fill="url(#grid)" />

    {/* Regional Borders (Oman / UAE) */}
    {/* Musandam Border (~50 NM North/East of Dubai, connecting East/West coasts) */}
    <path d="M 82,-12 L 108,8" fill="none" stroke="#666666" strokeOpacity="0.8" strokeWidth={0.5 / cameraZoom} strokeDasharray={`${3 / cameraZoom} ${3 / cameraZoom}`} />
    {/* Southern Border (Hatta region, connecting inland to East coast) */}
    <path d="M 125,120 L 95,140 L 40,210" fill="none" stroke="#666666" strokeOpacity="0.8" strokeWidth={0.5 / cameraZoom} strokeDasharray={`${3 / cameraZoom} ${3 / cameraZoom}`} />
    <text x="95" y="-5" fill="#666666" fontSize={0.8 / cameraZoom} fontFamily="monospace" opacity="0.8" transform="rotate(30 95 -5)">OMAN (MUSANDAM)</text>
    <text x="60" y="160" fill="#666666" fontSize={1.0 / cameraZoom} fontFamily="monospace" opacity="0.8" transform="rotate(-50 60 160)">OMAN</text>

    {/* UAE Peninsula Coastlines (West Coast / Persian Gulf & East Coast / Gulf of Oman) */}
    <path 
      d="M -150,250 
         L -50,150 
         L 20,80 
         L 35,65 
         L 32,62 L 35,60 L 38,62 L 40,60 
         L 45,55 
         L 43,52 L 45,50 L 47,52 L 48,53 
         L 52,49 
         L 58,43 
         L 56,40 L 58,39 L 60,42 
         L 68,34 
         L 75,15 
         L 80,-10 
         L 85,-40 
         L 90,-50 
         L 110,10 
         L 120,40 
         L 128,100 
         L 145,250" 
      fill="none" 
      stroke="#FFFFFF" 
      strokeOpacity="0.8"
      strokeWidth={0.4 / cameraZoom} 
    />

    {/* Iranian Coastline (Northern Gulf ~75-80NM from Dubai) */}
    <path 
      d="M -150,-20 
         L -50,-60 
         L 0,-70 
         L 50,-80 
         L 80,-110 
         L 150,-130" 
      fill="none" 
      stroke="#FFFFFF" 
      strokeOpacity="0.5"
      strokeWidth={0.4 / cameraZoom} 
    />
    <text x="-20" y="-80" fill="#666666" fontSize={1.0 / cameraZoom} fontFamily="monospace" opacity="0.8" transform="rotate(-15 -20 -80)">IRAN (MAINLAND)</text>
    
    {/* The World Islands (Abstract Polygon) */}
    <path d="M 51,46 L 53,44 L 55,46 L 53,48 Z" fill="none" stroke="#FFFFFF" strokeOpacity="0.8" strokeWidth={0.2 / cameraZoom} />

    {/* Hajar Mountains (Eastern Topo Lines) - Constrained strictly between the coasts */}
    <g opacity="0.5" stroke="#FFFFFF" strokeWidth={0.3 / cameraZoom} fill="none">
      <path d="M 105,10 Q 100,40 105,80 Q 110,120 115,180" />
      <path d="M 110,15 Q 105,45 110,85 Q 115,125 120,185" />
      <path d="M 115,20 Q 110,50 115,90 Q 120,130 125,190" />
      <text x="110" y="70" fill="#FFFFFF" fontSize={1.0 / cameraZoom} fontFamily="monospace" stroke="none" transform="rotate(75 110 70)">HAJAR MOUNTAINS</text>
    </g>

    {/* Defended Urban Footprint (Dubai Metropolitan Area) - Aligned to coast */}
    <path d="M 40,60 L 58,43 L 63,49 L 45,66 Z" fill="#00FF00" fillOpacity="0.05" stroke="#00FF00" strokeWidth={0.2 / cameraZoom} strokeDasharray={`${0.5 / cameraZoom} ${0.5 / cameraZoom}`} />
    <text x="47" y="55" fill="#00FF00" fontSize={0.6 / cameraZoom} fontFamily="monospace" opacity="0.4" transform="rotate(-43 47 55)">DEFENDED METRO AREA</text>
    {/* Radar Sector (FOV Wedge) - 120 degrees looking North */}
    <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y})`}>
      <path d="M 0 0 L -43.3 -75 A 86.6 86.6 0 0 1 43.3 -75 Z" fill="#00FFFF" fillOpacity="0.02" stroke="#00FFFF" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${1 / cameraZoom} ${2 / cameraZoom}`} />
      <line x1="0" y1="0" x2="0" y2="-86.6" stroke="#00FFFF" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${2 / cameraZoom} ${2 / cameraZoom}`} opacity="0.5" /> {/* PTL */}
    </g>

    {/* Concentric Range Rings & Azimuth Lines */}
    <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y})`} stroke="#002B40" strokeWidth={0.1 / cameraZoom} opacity="0.8">
      {/* Azimuth Lines every 30 degrees */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => (
        <line key={`az-${deg}`} x1="0" y1="0" x2={Math.sin(deg * Math.PI / 180) * 150} y2={-Math.cos(deg * Math.PI / 180) * 150} />
      ))}
      {/* Range Rings: 10NM, 20NM, 50NM, 100NM */}
      <circle cx="0" cy="0" r="10" fill="none" />
      <text x="1.5" y="-10" fill="#00E5FF" fontSize={1.5 / cameraZoom} fontFamily="monospace" fontWeight="bold" opacity="0.7" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }} textAnchor="start" alignmentBaseline="middle">10NM</text>
      <circle cx="0" cy="0" r="20" fill="none" />
      <text x="1.5" y="-20" fill="#00E5FF" fontSize={1.5 / cameraZoom} fontFamily="monospace" fontWeight="bold" opacity="0.7" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }} textAnchor="start" alignmentBaseline="middle">20NM</text>
      <circle cx="0" cy="0" r="50" fill="none" />
      <text x="1.5" y="-50" fill="#00E5FF" fontSize={1.5 / cameraZoom} fontFamily="monospace" fontWeight="bold" opacity="0.7" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }} textAnchor="start" alignmentBaseline="middle">50NM</text>
      <circle cx="0" cy="0" r="100" fill="none" strokeDasharray={`${0.5 / cameraZoom} ${0.5 / cameraZoom}`} />
      <text x="1.5" y="-100" fill="#00E5FF" fontSize={1.5 / cameraZoom} fontFamily="monospace" fontWeight="bold" opacity="0.7" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }} textAnchor="start" alignmentBaseline="middle">100NM</text>
    </g>

    {/* Bullseye Reference Point */}
    <g transform={`translate(${BULLSEYE_POS.x}, ${BULLSEYE_POS.y})`}>
      <circle cx="0" cy="0" r="1.5" fill="none" stroke="#00FFFF" strokeWidth={0.2 / cameraZoom} />
      <circle cx="0" cy="0" r="0.2" fill="#00FFFF" />
      <line x1="-2" y1="0" x2="2" y2="0" stroke="#00FFFF" strokeWidth={0.2 / cameraZoom} />
      <line x1="0" y1="-2" x2="0" y2="2" stroke="#00FFFF" strokeWidth={0.2 / cameraZoom} />
      <text x="2.5" y="0.5" fill="#00FFFF" fontSize={0.6 / cameraZoom} fontFamily="monospace" opacity="0.8">BULLSEYE</text>
    </g>

    {/* Battery Position */}
    <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y})`}>
      <rect x={-0.5 / cameraZoom} y={-0.5 / cameraZoom} width={1 / cameraZoom} height={1 / cameraZoom} fill="#00FFFF" />
      <text x={1.5 / cameraZoom} y={0.5 / cameraZoom} fill="#00FFFF" fontSize={0.8 / cameraZoom} fontFamily="monospace" opacity="0.8">BATTERY</text>
      
      {/* WEZ Rings */}
      <circle cx="0" cy="0" r="35" fill="none" stroke="#FF0000" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${0.2 / cameraZoom} ${0.2 / cameraZoom}`} />
      <text x="0" y="-35.5" fill="#FF0000" fontSize={0.6 / cameraZoom} textAnchor="middle" opacity="0.5">IRON DOME WEZ</text>
      <circle cx="0" cy="0" r="25" fill="none" stroke="#FFFF00" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${0.5 / cameraZoom} ${0.5 / cameraZoom}`} />
      <text x="0" y="-25.5" fill="#FFFF00" fontSize={0.6 / cameraZoom} textAnchor="middle" opacity="0.5">PAC-3 WEZ</text>
      <circle cx="0" cy="0" r="100" fill="none" stroke="#FF00FF" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${1 / cameraZoom} ${1 / cameraZoom}`} />
      <text x="0" y="-98" fill="#FF00FF" fontSize={0.6 / cameraZoom} textAnchor="middle" opacity="0.5">THAAD WEZ</text>
    </g>
  </>
));

const DefendedAssets = React.memo(({ cameraZoom }: { cameraZoom: number }) => {
  const assets = useTrackStore(state => state.assets);
  
  return (
  <>
    {Object.values(assets).map(asset => {
      const color = '#00E5FF';
      return (
      <g key={asset.id} transform={`translate(${asset.x}, ${asset.y})`}>
        <rect x={-0.8 / cameraZoom} y={-0.8 / cameraZoom} width={1.6 / cameraZoom} height={1.6 / cameraZoom} fill={'none'} fillOpacity={1} stroke={color} strokeWidth={0.2 / cameraZoom} />
        <text x={1.2 / cameraZoom} y={0.5 / cameraZoom} fill={color} fontSize={0.6 / cameraZoom} fontFamily="monospace" opacity={0.7}>
          {asset.name}
        </text>
        {asset.hasCram && (
          <>
            <circle cx="0" cy="0" r="2.5" fill="none" stroke="#00E5FF" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${0.2 / cameraZoom} ${0.2 / cameraZoom}`} opacity="0.5" />
            <text x="0" y="-2.8" fill="#00E5FF" fontSize={0.5 / cameraZoom} fontFamily="monospace" opacity="0.5" textAnchor="middle">C-RAM</text>
          </>
        )}
      </g>
    )})}
  </>
)});

const TrackSummaryTable = React.memo(({ hookedTrackIds, setHookedTrackIds, filters, setFilters }: { hookedTrackIds: string[], setHookedTrackIds: React.Dispatch<React.SetStateAction<string[]>>, filters: any, setFilters: React.Dispatch<React.SetStateAction<any>> }) => {
  const tracksMap = useTrackStore(state => state.tracks);
  const tracks = useMemo(() => Object.values(tracksMap).filter(t => {
    if (t.detected === false) return false;
    if (!filters.showUnknowns && (t.type === 'UNKNOWN' || t.type === 'PENDING')) return false;
    if (!filters.showFriends && t.type === 'FRIEND') return false;
    if (!filters.showNeutrals && (t.type === 'NEUTRAL' || t.type === 'ASSUMED_FRIEND')) return false;
    if (!filters.showHostiles && (t.type === 'HOSTILE' || t.type === 'SUSPECT')) return false;
    return true;
  }), [tracksMap, filters]);

  return (
    <aside className="flex-1 bg-[#001A26]/20 backdrop-blur-md border border-[#002B40] flex flex-col min-h-0">
      <div className="bg-[#001A26]/20 px-3 py-2 border-b border-[#002B40] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[#00E5FF] font-bold">[TRK]</span>
          <h2 className="text-xs font-bold text-[#00E5FF] tracking-widest hidden lg:block">SUMMARY</h2>
        </div>
        <div className="flex gap-1">
          <button 
            onClick={() => setFilters((f: any) => ({ ...f, showHostiles: !f.showHostiles }))} 
            className={`px-1.5 py-0.5 text-[9px] font-bold border ${filters.showHostiles ? 'text-[#FF0000] border-[#FF0000] bg-[#FF0000]/10' : 'text-[#FF0000]/30 border-[#002B40]'}`}
          >H</button>
          <button 
            onClick={() => setFilters((f: any) => ({ ...f, showUnknowns: !f.showUnknowns }))} 
            className={`px-1.5 py-0.5 text-[9px] font-bold border ${filters.showUnknowns ? 'text-[#FFFF00] border-[#FFFF00] bg-[#FFFF00]/10' : 'text-[#FFFF00]/30 border-[#002B40]'}`}
          >P</button>
          <button 
            onClick={() => setFilters((f: any) => ({ ...f, showFriends: !f.showFriends }))} 
            className={`px-1.5 py-0.5 text-[9px] font-bold border ${filters.showFriends ? 'text-[#00FF33] border-[#00FF33] bg-[#00FF33]/10' : 'text-[#00FF33]/30 border-[#002B40]'}`}
          >F</button>
          <button 
            onClick={() => setFilters((f: any) => ({ ...f, showNeutrals: !f.showNeutrals }))} 
            className={`px-1.5 py-0.5 text-[9px] font-bold border ${filters.showNeutrals ? 'text-[#00FFFF] border-[#00FFFF] bg-[#00FFFF]/10' : 'text-[#00FFFF]/30 border-[#002B40]'}`}
          >N</button>
        </div>
      </div>
      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-[10px] text-left table-fixed">
          <thead className="text-[#004466] sticky top-0 bg-[#00050A]/50 border-b border-[#002B40] backdrop-blur-md">
            <tr>
              <th className="py-2 px-3 font-normal w-1/4">TRK</th>
              <th className="py-2 px-2 font-normal w-1/4">TYPE</th>
              <th className="py-2 px-2 font-normal w-1/6">CAT</th>
              <th className="py-2 px-2 font-normal text-right w-1/6">RNG</th>
              <th className="py-2 px-3 font-normal text-right w-1/6">ALT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#001A26]">
            {tracks.map(t => {
              const range = calculateRange(t.x, t.y, BATTERY_POS.x, BATTERY_POS.y, t.alt, 0).toFixed(1);
              const isHooked = hookedTrackIds.includes(t.id);
              let typeColor = 'text-[#FFFF00]';
              if (t.type === 'FRIEND') typeColor = 'text-[#00FF33]';
              if (t.type === 'ASSUMED_FRIEND' || t.type === 'NEUTRAL') typeColor = 'text-[#00FFFF]';
              if (t.type === 'HOSTILE') typeColor = 'text-[#FF0000]';
              if (t.type === 'SUSPECT') typeColor = 'text-[#FF8800]';

              return (
                <tr 
                  key={t.id} 
                  className={`cursor-pointer hover:bg-[#001A26] transition-colors ${isHooked ? 'bg-[#002B40] outline outline-1 outline-[#00E5FF]' : ''} ${t.coasting ? 'opacity-50' : ''}`}
                  onClick={() => {
                    setHookedTrackIds(prev => 
                      prev.includes(t.id) 
                        ? prev.filter(tid => tid !== t.id) 
                        : [t.id]
                    );
                  }}
                >
                  <td className="py-2 px-3 font-bold text-[#00E5FF] truncate">{t.id}</td>
                  <td className={`py-2 px-2 font-bold ${typeColor} truncate`}>{t.threatName ? t.threatName.substring(0, 4).toUpperCase() : t.type.substring(0, 4)}</td>
                  <td className="py-2 px-2 text-[#00E5FF] truncate">{t.category}</td>
                  <td className="py-2 px-2 text-[#00E5FF] text-right tabular-nums">{range.padStart(4, '0')}</td>
                  <td className="py-2 px-3 text-[#00E5FF] text-right tabular-nums">{t.alt >= 18000 ? `FL${Math.round(t.alt/100)}` : `${Math.round(t.alt)} FT`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </aside>
  );
});

const SystemClock = React.memo(() => {
  const [time, setTime] = useState(() => new Date().toISOString().substring(11, 19) + 'Z');

  useEffect(() => {
    const timer = setInterval(() => {
      setTime(new Date().toISOString().substring(11, 19) + 'Z');
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col items-end leading-none">
      <span className="text-[#00E5FF] tabular-nums text-xs lg:text-sm font-bold">{time}</span>
      <span className="text-[#00E5FF] tabular-nums text-[9px] opacity-40 tracking-widest">ZULU</span>
    </div>
  );
});

const SystemEventLog = React.memo(({ logs }: { logs: SystemLog[] }) => {
  return (
    <aside className="h-48 bg-[#001A26]/20 backdrop-blur-md border border-[#002B40] flex flex-col shrink-0">
      <div className="bg-[#001A26]/20 px-3 py-2 border-b border-[#002B40] flex items-center gap-2 shrink-0">
        <span className="text-[#00E5FF] font-bold">[LOG]</span>
        <h2 className="text-xs font-bold text-[#00E5FF] tracking-widest">SYSTEM EVENT LOG</h2>
      </div>
      <div className="flex-1 overflow-auto p-3 space-y-1.5 flex flex-col-reverse custom-scrollbar">
        {logs.map((log) => (
          <div key={log.id} className={`text-[10px] flex gap-2 ${!log.acknowledged ? 'bg-[#FF0033]/20 border border-[#FF0033] p-1' : ''}`}>
            <div className="flex flex-col w-4 text-[7px] text-[#004466] tabular-nums leading-none shrink-0 border-r border-[#004466]/30 pr-1 justify-center items-center font-bold">
              <span>{log.time.substring(0, 2)}</span>
              <span>{log.time.substring(3, 5)}</span>
              <span>{log.time.substring(6, 8)}</span>
            </div>
            <span className={`${
              log.type === 'ALERT' ? 'text-[#FF0033] font-bold' :
              log.type === 'ACTION' ? 'text-[#00E5FF] font-bold' :
              log.type === 'WARN' ? 'text-[#FFCC00]' : 'text-[#00E5FF]'
            }`}>{log.message}</span>
          </div>
        ))}
      </div>
    </aside>
  );
});

const Tote = React.memo(({ hookedTrackIds, masterWarning, vectoringTrackId, setVectoringTrackId, doctrine, setDoctrine, filters, setFilters, wcs, setWcs }: { hookedTrackIds: string[], masterWarning: boolean, vectoringTrackId: string | null, setVectoringTrackId: (id: string | null) => void, doctrine: EngagementDoctrine, setDoctrine: React.Dispatch<React.SetStateAction<EngagementDoctrine>>, filters: any, setFilters: React.Dispatch<React.SetStateAction<any>>, wcs: 'TIGHT' | 'FREE', setWcs: (wcs: 'TIGHT' | 'FREE') => void }) => {
  const _renderTrigger = useNow(); // Triggers the re-render loop for TTI
  const tracksMap = useTrackStore(state => state.tracks);
  const hookedTracks = useMemo(() => hookedTrackIds.map(id => tracksMap[id]).filter(Boolean), [hookedTrackIds, tracksMap]);

  const hookedTrack = hookedTracks.length === 1 ? hookedTracks[0] : undefined;
  const isGroup = hookedTracks.length > 1;

  const kinematics = hookedTrack ? calculateKinematics(hookedTrack) : null;
  const brg = hookedTrack ? calculateBearing(hookedTrack.x, hookedTrack.y, BATTERY_POS.x, BATTERY_POS.y).toString().padStart(3, '0') : '';
  const rng = hookedTrack ? calculateRange(hookedTrack.x, hookedTrack.y, BATTERY_POS.x, BATTERY_POS.y, hookedTrack.alt, 0).toFixed(1).padStart(4, '0') : '';
  const bullBrg = hookedTrack ? calculateBearing(hookedTrack.x, hookedTrack.y, BULLSEYE_POS.x, BULLSEYE_POS.y).toString().padStart(3, '0') : '';
  const bullRng = hookedTrack ? calculateRange(hookedTrack.x, hookedTrack.y, BULLSEYE_POS.x, BULLSEYE_POS.y, hookedTrack.alt, 0).toFixed(0).padStart(3, '0') : '';

  return (
    <aside className={`w-full bg-[#001A26]/40 backdrop-blur-xl border ${masterWarning ? 'border-[#FF0033]' : 'border-[#002B40]'} flex flex-col pointer-events-auto transition-all duration-300 h-fit`}>
      <div className={`px-3 py-1.5 border-b ${masterWarning ? 'bg-[#440000]/40 border-[#FF0033]' : 'bg-[#001A26]/40 border-[#002B40]'} flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-2">
          <span className={masterWarning ? 'text-[#FF0033] font-bold text-[10px]' : 'text-[#00E5FF] font-bold text-[10px]'}>[SYS]</span>
          <h2 className={`text-[10px] font-bold tracking-widest ${masterWarning ? 'text-[#FF0033]' : 'text-[#00E5FF]'}`}>TACTICAL DATA</h2>
        </div>
        <div className={`px-1.5 py-0.5 text-[9px] font-bold border ${wcs === 'FREE' ? 'bg-[#FF0033] text-[#00050A] border-[#FF0033]' : 'text-[#FFCC00] border-[#FFCC00]'}`}>
          WCS: {wcs}
        </div>
      </div>
      
      <div className="flex flex-col min-h-0">
        {isGroup ? (
          <div className="p-3 space-y-3">
            <div className="text-[10px] text-[#004466] uppercase font-bold border-b border-[#002B40] pb-1">Group Summary ({hookedTracks.length})</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
              <div className="text-[#FF0000] flex justify-between"><span>HOSTILE</span> <span>{hookedTracks.filter(t => t.type === 'HOSTILE').length}</span></div>
              <div className="text-[#00FF33] flex justify-between"><span>FRIENDLY</span> <span>{hookedTracks.filter(t => t.type === 'FRIEND').length}</span></div>
              <div className="text-[#FFFF00] flex justify-between"><span>PENDING</span> <span>{hookedTracks.filter(t => t.type === 'PENDING' || t.type === 'UNKNOWN').length}</span></div>
              <div className="text-[#FF8800] flex justify-between"><span>SUSPECT</span> <span>{hookedTracks.filter(t => t.type === 'SUSPECT').length}</span></div>
            </div>
            <div className="pt-2">
               <div className="text-[9px] text-[#004466] uppercase mb-1">Categories</div>
               <div className="flex flex-wrap gap-2">
                 {Array.from(new Set(hookedTracks.map(t => t.category))).map(cat => (
                   <span key={cat} className="text-[10px] text-[#00E5FF] bg-[#002B40] px-1.5 py-0.5 rounded-sm">{cat}: {hookedTracks.filter(t => t.category === cat).length}</span>
                 ))}
               </div>
            </div>

            {/* Group Engagements Grid */}
            {hookedTracks.some(t => t.interceptors && t.interceptors.length > 0) && (
              <div className="pt-1.5 space-y-1 border-t border-[#002B40]">
                <div className="text-[8px] text-[#FF0033] uppercase font-bold flex items-center gap-1 opacity-80">
                  <div className="w-1 h-1 rounded-full bg-[#FF0033] animate-pulse" />
                  ENGAGEMENT STATUS
                </div>
                <div className="grid grid-cols-4 gap-1 max-h-36 overflow-y-auto custom-scrollbar pr-0.5">
                  {hookedTracks
                    .filter(t => t.interceptors && t.interceptors.length > 0)
                    .map(t => {
                      // Get the nearest interceptor for this target
                      const sortedInterceptors = [...t.interceptors].sort((a, b) => 
                        (a.engagementTime + a.interceptDuration) - (b.engagementTime + b.interceptDuration)
                      );
                      const i = sortedInterceptors[0];
                      const elapsed = nowStore.now - i.engagementTime;
                      const progress = Math.min(1, Math.max(0, elapsed / i.interceptDuration));
                      const remainingTti = Math.ceil(Math.max(0, (i.engagementTime + i.interceptDuration - nowStore.now) / 1000));
                      const closingRng = (i.initialRange || 0) * (1 - progress);

                      return (
                        <div key={`group-eng-${t.id}`} className="flex gap-0.5 border border-[#FF0033]/20 bg-[#FF0033]/5 p-0.5 min-w-0">
                          <div className="flex flex-col w-3 text-[7px] text-[#FF0033] font-bold border-r border-[#FF0033]/30 shrink-0 justify-center items-center leading-none">
                            {t.id.split('').map((char, idx) => <span key={idx}>{char}</span>)}
                          </div>
                          <div className="flex flex-col justify-center items-center flex-1 min-w-0 overflow-hidden">
                            <div className="text-[11px] font-bold text-[#00E5FF] leading-none tabular-nums">{remainingTti}s</div>
                            <div className="text-[8px] text-[#00E5FF] opacity-50 tabular-nums leading-none mt-0.5">{Math.round(closingRng)}</div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        ) : hookedTrack ? (
          <div className="p-3 space-y-3">
            {/* Compact Header */}
            <div className="flex justify-between items-end border-b border-[#002B40] pb-2">
              <span className="text-xl font-bold text-[#00E5FF] leading-none">{hookedTrack.id}</span>
              <span className={`text-[10px] font-bold ${
                hookedTrack.type === 'FRIEND' ? 'text-[#00FF33]' :
                (hookedTrack.type === 'ASSUMED_FRIEND' || hookedTrack.type === 'NEUTRAL') ? 'text-[#00FFFF]' :
                hookedTrack.type === 'HOSTILE' ? 'text-[#FF0033]' :
                hookedTrack.type === 'SUSPECT' ? 'text-[#FF8800]' :
                'text-[#FFFF00]'
              }`}>
                {hookedTrack.threatName || hookedTrack.type}
              </span>
            </div>

            {/* Tight Data Grid */}
            <div className="grid grid-cols-2 text-[10px] gap-y-2">
              <div className="text-[#004466]">ALTITUDE</div>
              <div className="text-right text-[#00E5FF] font-bold tabular-nums">
                {hookedTrack.alt >= 18000 ? `FL${Math.round(hookedTrack.alt/100)}` : `${Math.round(hookedTrack.alt).toLocaleString()} FT`}
              </div>

              <div className="text-[#004466]">SPD / HDG</div>
              <div className="text-right text-[#00E5FF] font-bold tabular-nums">
                {Math.round(hookedTrack.spd)}K / {Math.round(hookedTrack.hdg).toString().padStart(3, '0')}°
              </div>

              <div className="text-[#004466]">BRG / RNG</div>
              <div className="text-right text-[#00E5FF] font-bold tabular-nums">
                {brg}° / {rng} NM
              </div>

              {/* Nearest Interceptor integrated into grid */}
              {hookedTrack.interceptors && hookedTrack.interceptors.length > 0 && (
                <>
                  {(() => {
                    const sorted = [...hookedTrack.interceptors].sort((a, b) => 
                      (a.engagementTime + a.interceptDuration) - (b.engagementTime + b.interceptDuration)
                    );
                    const i = sorted[0];
                    const elapsed = nowStore.now - i.engagementTime;
                    const progress = Math.min(1, Math.max(0, elapsed / i.interceptDuration));
                    const remainingTti = Math.ceil(Math.max(0, (i.engagementTime + i.interceptDuration - nowStore.now) / 1000));
                    const closingRng = (i.initialRange || 0) * (1 - progress);
                    
                    return (
                      <React.Fragment key={i.id}>
                        <div className="text-[#FF0033] font-bold flex items-center gap-1 uppercase">
                          <div className="w-1 h-1 rounded-full bg-[#FF0033] animate-pulse" />
                          {i.weapon} TTI / RNG
                        </div>
                        <div className="text-right text-[#FF0033] font-bold tabular-nums">
                          {remainingTti}s / {closingRng.toFixed(1)} NM
                        </div>
                      </React.Fragment>
                    );
                  })()}
                </>
              )}
            </div>

            {hookedTrack.isFighter && (
              <div className="pt-2 space-y-2 border-t border-[#002B40]">
                <div className="flex justify-between text-[10px]">
                   <span className="text-[#004466]">WEAPONS / FUEL</span>
                   <span className="text-[#00E5FF] font-bold">{hookedTrack.missilesRemaining} AMRAAM / {Math.floor(hookedTrack.fuel || 0)} LBS</span>
                </div>
                <button
                  className={`w-full h-8 text-[9px] font-bold tracking-widest border transition-all flex items-center justify-center ${
                    vectoringTrackId === hookedTrack.id
                      ? 'bg-[#00E5FF] text-[#00050A] border-[#00E5FF]'
                      : 'bg-[#001A26] text-[#00E5FF] border-[#004466] hover:bg-[#002B40]'
                  }`}
                  onClick={() => setVectoringTrackId(vectoringTrackId === hookedTrack.id ? null : hookedTrack.id)}
                >
                  {vectoringTrackId === hookedTrack.id ? 'CANCEL VECTOR' : 'VECTOR COMMAND'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="p-3 space-y-4">
            {/* Integrated System Doctrine (No nested boxes) */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button 
                  onClick={() => {
                    const nextWcs = wcs === 'TIGHT' ? 'FREE' : 'TIGHT';
                    setWcs(nextWcs);
                    if (nextWcs === 'FREE') {
                      setDoctrine({
                        autoEngageTBM: true,
                        autoEngageCM: true,
                        autoEngageUAS: true,
                        autoEngageRocket: true
                      });
                    }
                  }}
                  className={`w-full h-8 border text-[9px] font-bold tracking-widest transition-all flex items-center justify-center ${
                    wcs === 'FREE' ? 'bg-[#FF0033] text-[#00050A] border-[#FF0033]' : 'bg-[#FFCC00] text-[#00050A] border-[#FFCC00]'
                  }`}
                >
                  WCS: {wcs}
                </button>
                <button 
                  onClick={() => {
                    setDoctrine(prev => {
                      const anyActive = Object.values(prev).some(v => v);
                      return {
                        autoEngageTBM: !anyActive,
                        autoEngageCM: !anyActive,
                        autoEngageUAS: !anyActive,
                        autoEngageRocket: !anyActive
                      };
                    });
                  }}
                  className={`w-full h-8 border text-[9px] font-bold tracking-widest transition-all flex items-center justify-center ${
                    Object.values(doctrine).some(v => v) ? 'bg-[#FFCC00] text-[#00050A] border-[#FFCC00]' : 'bg-[#001A26] border-[#004466] text-[#FFCC00] hover:bg-[#002B40]'
                  }`}
                >
                  DOC: {Object.values(doctrine).some(v => v) ? 'AUTO' : 'MANUAL'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                {[
                  { key: 'autoEngageTBM', label: 'TBM', color: '#FF00FF', sub: 'THAAD/PAC' },
                  { key: 'autoEngageCM', label: 'CM', color: '#00E5FF', sub: 'PAC/TAMIR' },
                  { key: 'autoEngageRocket', label: 'ROCKET', color: '#FFFF00', sub: 'TAMIR' },
                  { key: 'autoEngageUAS', label: 'UAS', color: '#00FF33', sub: 'TAMIR' }
                ].map(item => {
                  const isActive = doctrine[item.key as keyof EngagementDoctrine];
                  return (
                    <button 
                      key={item.key}
                      onClick={() => setDoctrine(prev => ({ ...prev, [item.key]: !prev[item.key as keyof EngagementDoctrine] }))}
                      className={`w-full h-11 border text-[10px] font-bold tracking-widest transition-all flex flex-col items-center justify-center ${
                        isActive 
                          ? `bg-[${item.color}] text-[#00050A] border-[${item.color}] shadow-[0_0_10px_${item.color}44]` 
                          : 'bg-[#001A26] border-[#004466] text-[#004466]'
                      }`}
                      style={isActive ? { backgroundColor: item.color, borderColor: item.color } : {}}
                    >
                      <span className={`text-[8px] mb-0.5 opacity-70 uppercase`}>{item.label}</span>
                      {isActive ? 'AUTO' : 'HOLD'}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
});

const FighterWaypoints = React.memo(({ cameraZoom, setDraggingWaypointId }: { cameraZoom: number, setDraggingWaypointId: (id: string | null) => void }) => {
  const tracksMap = useTrackStore(state => state.tracks);
  const trackIds = useTrackStore(state => state.trackIds);
  const fighterTracks = useMemo(() => trackIds.map(id => tracksMap[id]).filter(t => t.isFighter), [tracksMap, trackIds]);

  return (
    <>
      {fighterTracks.map(t => (
        <g key={`wp-${t.id}`}>
          {t.targetWaypoint && (
            <line 
              x1={t.x} y1={t.y} 
              x2={t.targetWaypoint.x} y2={t.targetWaypoint.y} 
              stroke={t.isRTB ? "#FFCC00" : "#00E5FF"} 
              strokeWidth={0.2 / cameraZoom} 
              strokeDasharray={`${1 / cameraZoom} ${1 / cameraZoom}`} 
              opacity="0.5" 
            />
          )}

          {t.patrolWaypoint && !t.isRTB && (
            <g>
              <circle 
                cx={t.patrolWaypoint.x} cy={t.patrolWaypoint.y} 
                r={2 / cameraZoom} 
                fill="transparent" 
                className="cursor-move pointer-events-auto"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setDraggingWaypointId(t.id);
                }}
              />
              <g transform={`translate(${t.patrolWaypoint.x}, ${t.patrolWaypoint.y})`} pointerEvents="none">
                <line x1={-0.8 / cameraZoom} y1={0} x2={0.8 / cameraZoom} y2={0} stroke="#00E5FF" strokeWidth={0.2 / cameraZoom} />
                <line x1={0} y1={-0.8 / cameraZoom} x2={0} y2={0.8 / cameraZoom} stroke="#00E5FF" strokeWidth={0.2 / cameraZoom} />
              </g>
            </g>
          )}

          {t.isRTB && t.targetWaypoint && (
            <text x={t.x + 1} y={t.y - 1} fill="#FFCC00" fontSize={0.7 / cameraZoom} fontFamily="monospace" fontWeight="bold">
              RTB
            </text>
          )}
        </g>
      ))}
    </>
  );
});

const DraggableWindow = ({ defaultPos, title, children, className = '' }: { defaultPos: {x: number, y: number}, title: string, children: React.ReactNode, className?: string }) => {
  const [pos, setPos] = useState(defaultPos);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0 });

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  };
  
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    setPos({
      x: dragRef.current.startPosX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.startPosY + (e.clientY - dragRef.current.startY)
    });
    e.stopPropagation();
  };
  
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    e.stopPropagation();
  };

  return (
    <div 
      className={`absolute pointer-events-auto flex flex-col bg-[#00050A]/80 backdrop-blur-md border border-[#004466] shadow-[0_10px_30px_rgba(0,0,0,0.5)] ${className}`}
      style={{ left: pos.x, top: pos.y, zIndex: isDragging ? 50 : 40 }}
    >
      <div 
        className="h-6 bg-[#001A26] border-b border-[#004466] flex items-center justify-center px-3 cursor-move select-none touch-none hover:bg-[#002B40] transition-colors"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <div className="flex gap-1">
          <div className="w-1 h-1 rounded-full bg-[#00E5FF] opacity-50" />
          <div className="w-1 h-1 rounded-full bg-[#00E5FF] opacity-50" />
          <div className="w-1 h-1 rounded-full bg-[#00E5FF] opacity-50" />
        </div>
      </div>
      <div className="flex-1 flex flex-col min-h-0 w-full h-full overflow-hidden">
        {children}
      </div>
    </div>
  );
};

const GhostVectorLine = React.memo(({ vectoringTrackId, cameraZoom }: { vectoringTrackId: string, cameraZoom: number }) => {
  const track = useTrackStore(state => state.tracks[vectoringTrackId]);
  const mouse = useMouseCoords();
  
  if (!track || (mouse.x === 0 && mouse.y === 0)) return null;

  return (
    <g>
      <line 
        x1={track.x} y1={track.y} 
        x2={mouse.x} y2={mouse.y} 
        stroke="#00E5FF" 
        strokeWidth={0.2 / cameraZoom} 
        strokeDasharray={`${0.5 / cameraZoom} ${0.5 / cameraZoom}`} 
        className="animate-pulse"
      />
      {/* Static Crosshair - No Ping to avoid "errant ghosting" */}
      <g transform={`translate(${mouse.x}, ${mouse.y})`}>
        <line x1={-0.8 / cameraZoom} y1={0} x2={0.8 / cameraZoom} y2={0} stroke="#00E5FF" strokeWidth={0.1 / cameraZoom} />
        <line x1={0} y1={-0.8 / cameraZoom} x2={0} y2={0.8 / cameraZoom} stroke="#00E5FF" strokeWidth={0.1 / cameraZoom} />
        <circle r={0.5 / cameraZoom} fill="none" stroke="#00E5FF" strokeWidth={0.1 / cameraZoom} opacity="0.5" />
      </g>
    </g>
  );
});

export default function App() {
  const trackIds = useTrackStore(state => state.trackIds);
  const addTracks = useTrackStore(state => state.addTracks);
  const setTracks = useTrackStore(state => state.setTracks);

  const [hookedTrackIds, setHookedTrackIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([
    { id: 'initial-1', time: getZuluTimeStr(-120000), message: 'SYS: JIAMD NODE INITIALIZED', type: 'INFO', acknowledged: true },
    { id: 'initial-2', time: getZuluTimeStr(-90000), message: 'DATALINK LINK-16: ACTIVE', type: 'INFO', acknowledged: true },
    { id: 'initial-3', time: getZuluTimeStr(-60000), message: 'WCS SET TO TIGHT. WEAPONS HOLD.', type: 'WARN', acknowledged: true },
    { id: 'initial-4', time: getZuluTimeStr(-30000), message: 'INTEL: HEIGHTENED LEVEL OF ENCRYPTED CHATTER DETECTED IN SECTOR', type: 'WARN', acknowledged: true },
  ]);
  const [inventory, setInventory] = useState({ pac3: 32, tamir: 120, thaad: 8, cram: 999 });
  const [doctrine, setDoctrine] = useState<EngagementDoctrine>({
    autoEngageTBM: false,
    autoEngageCM: false,
    autoEngageUAS: false,
    autoEngageRocket: false
  });
  const [wcs, setWcs] = useState<'TIGHT' | 'FREE'>('TIGHT');
  const [filters, setFilters] = useState({ showUnknowns: true, showFriends: true, showNeutrals: true, showHostiles: true });
  const [buttonFeedback, setButtonFeedback] = useState<Record<string, 'action' | 'error'>>({});
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [splashes, setSplashes] = useState<{ id: string, x: number, y: number, time: number }[]>([]);
  const simTimeRef = useRef(0);

  useEffect(() => {
    nowStore.setPaused(isPaused);
  }, [isPaused]);

  const incrementInterceptorsFired = useTrackStore(state => state.incrementInterceptorsFired);
  const addLeaker = useTrackStore(state => state.addLeaker);
  const addDefenseCost = useTrackStore(state => state.addDefenseCost);
  const addEnemyCost = useTrackStore(state => state.addEnemyCost);

  const triggerKeyFeedback = useCallback((key: string, type: 'action' | 'error') => {
    setButtonFeedback(prev => ({ ...prev, [key]: type }));
    setTimeout(() => {
      setButtonFeedback(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, 150);
  }, []);

  // Camera State
  const [camera, setCamera] = useState({ x: BATTERY_POS.x, y: BATTERY_POS.y, zoom: 0.5 });
  const [isDragging, setIsDragging] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, endX: number, endY: number } | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [followedTrackId, setFollowedTrackId] = useState<string | null>(null);
  const [vectoringTrackId, setVectoringTrackId] = useState<string | null>(null);
  const [draggingWaypointId, setDraggingWaypointId] = useState<string | null>(null);

  useEffect(() => {
    if (followedTrackId) {
      const track = useTrackStore.getState().getTrack(followedTrackId);
      if (track) {
        setCamera(prev => ({ ...prev, x: track.x, y: track.y }));
      }
    }
  }, [followedTrackId]);

  useEffect(() => {
    if (splashes.length > 0) {
      const timer = setInterval(() => {
        const now = Date.now();
        setSplashes(prev => prev.filter(s => now - s.time < 2000));
      }, 500);
      return () => clearInterval(timer);
    }
  }, [splashes.length]);

  const addLog = useCallback((message: string, type: 'INFO' | 'WARN' | 'ALERT' | 'ACTION' = 'INFO') => {
    const timeStr = getZuluTimeStr();
    const logId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setLogs(prev => [{ id: logId, time: timeStr, message, type, acknowledged: type !== 'ALERT' }, ...prev].slice(0, 50));
  }, []);

  const unackAlerts = useMemo(() => logs.filter(l => !l.acknowledged), [logs]);

  useEffect(() => {
    if (!isGameStarted) return;

    const reaperTimer = setInterval(() => {
      if (nowStore.isPaused) return;
      const now = nowStore.now;
      const lastSweep = useTrackStore.getState().lastSweepTime;
      const elapsed = (now - lastSweep) / 1000;

      setTracks(current => {
        let anyDestroyed = false;
        let anyInterceptorsRemoved = false;
        const destroyedIds = new Set<string>();
        
        const next = current.map(t => {
          if (!t.interceptors || t.interceptors.length === 0) return t;

          const remainingInterceptors = t.interceptors.filter(i => {
            const splashTime = i.engagementTime + i.interceptDuration;
            if (now >= splashTime) {
              if (i.isPkHit && !destroyedIds.has(t.id)) {
                destroyedIds.add(t.id);
                anyDestroyed = true;

                // Visual Splash at interpolated position
                const rad = t.hdg * (Math.PI / 180);
                const smoothX = t.x + Math.sin(rad) * ((t.spd / 3600) * elapsed);
                const smoothY = t.y - Math.cos(rad) * ((t.spd / 3600) * elapsed);
                
                setTimeout(() => {
                  const weaponStats = WEAPON_STATS[i.weapon as keyof typeof WEAPON_STATS];
                  const costStr = weaponStats.cost >= 1000000 ? `${(weaponStats.cost / 1000000).toFixed(1)}M` : `${Math.round(weaponStats.cost / 1000)}K`;
                  
                  setSplashes(prev => [...prev, { id: `live-${t.id}-${Date.now()}`, x: smoothX, y: smoothY, time: Date.now() }]);
                  addLog(`TRACK ${t.id} SPLASH (${i.shooterId}) [-$${costStr}].`, 'INFO');
                }, 0);
              } else if (i.isPkHit === false) {
                // Visual Miss reporting
                setTimeout(() => {
                  addLog(`${i.shooterId} MISSED TRACK ${t.id} (INTERCEPTOR SELF-DESTRUCT).`, 'WARN');
                }, 0);
              }
              anyInterceptorsRemoved = true;
              return false; // Remove interceptor (it reached its destination)
            }
            return true;
          });

          if (remainingInterceptors.length !== t.interceptors.length) {
            return { ...t, interceptors: remainingInterceptors };
          }
          return t;
        });

        if (anyDestroyed) {
          return next.filter(t => !destroyedIds.has(t.id));
        }
        return anyInterceptorsRemoved ? next : current;
      });
    }, 100);

    return () => clearInterval(reaperTimer);
  }, [isGameStarted, addLog]);

  useEffect(() => {
    if (!isGameStarted) return;

    const clockTimer = setInterval(() => {
      if (nowStore.isPaused) return;
      simTimeRef.current += 1;

      const hasHostiles = useTrackStore.getState().getAllTracks().some(t => t.type === 'HOSTILE' || t.type === 'SUSPECT' || (t.type === 'PENDING' && t.category !== 'FW'));
      if (simTimeRef.current >= 550 || (simTimeRef.current >= 300 && !hasHostiles)) {
        setIsGameOver(true);
      }

      const event = MISSION_STEPS.find(e => e.time === simTimeRef.current);
      if (event) {
        const newTracks = event.generateTracks();
        setTracks(current => [...current, ...newTracks]);
        addLog(event.message, event.type);

        // ROE Escalation: First TBM launch triggers WCS FREE and enables auto-engagement
        if (newTracks.some(t => t.category === 'TBM') && wcsRef.current === 'TIGHT') {
          setWcs('FREE');
          setDoctrine({
            autoEngageTBM: true,
            autoEngageCM: true,
            autoEngageUAS: true,
            autoEngageRocket: true
          });
          addLog('WCS SET TO FREE. AUTO-ENGAGEMENT DOCTRINE ACTIVATED FOR ALL THREATS.', 'ALERT');
        }

        // Calculate enemy cost for this wave
        const waveCost = newTracks.reduce((acc, t) => {
          if (t.category === 'UAS') return acc + 20000; // $20k per drone
          if (t.category === 'CM') return acc + 1500000; // $1.5M per cruise missile
          if (t.category === 'TBM') return acc + 3000000; // $3M per TBM
          return acc;
        }, 0);
        addEnemyCost(waveCost);
      }
    }, 1000);

    const sweepTimer = setInterval(() => {
      if (nowStore.isPaused) return;
      const events: { type: 'LOG' | 'COST' | 'AMRAAM_FIRED' | 'IMPACT' | 'GROUND_IMPACT' | 'SPLASH', message?: string, logType?: 'INFO' | 'WARN' | 'ALERT' | 'ACTION', amount?: number, assetId?: string, trackId?: string, x?: number, y?: number, isPopulated?: boolean }[] = [];

      // Physical sim time anchor
      const sweepSimTime = nowStore.now;

      setTracks(currentTracks => {
        const lastSweep = useTrackStore.getState().lastSweepTime;
        const actualElapsedSecs = Math.max(0.1, Math.min((sweepSimTime - lastSweep) / 1000, 5.0)); // Cap to prevent large jumps
        
        events.length = 0; // Clear events to prevent duplicates in React Strict Mode double-invocations

        // 1. Progress intercepts (Visual countdown only)
        let nextTracks = currentTracks.map(t => {
          if (t.interceptors && t.interceptors.length > 0) {
            const updatedInterceptors = t.interceptors.map(i => ({
              ...i,
              interceptTtl: Math.max(0, i.interceptTtl - actualElapsedSecs)
            })); 
            
            return { ...t, interceptors: updatedInterceptors };
          }
          return t;
        });

        // 2. Standard movement and physics
        nextTracks = nextTracks.map(track => {
          // IMPORTANT: Update position using PREVIOUS speed and heading to perfectly match the extrapolator's visual prediction
          // This eliminates the 3-second 'jump' when a track accelerates or turns.
          const initialSpeedFactor = (track.spd / 3600) * actualElapsedSecs;
          const radOld = track.hdg * (Math.PI / 180);
          let resX = track.x + Math.sin(radOld) * initialSpeedFactor;
          let resY = track.y - Math.cos(radOld) * initialSpeedFactor;

          let newSpd = track.spd;
          let newAlt = track.alt;
          let newHdg = track.hdg;
          let newTargetWaypoint = track.targetWaypoint;

          let newFuel = track.fuel;

          if (track.isFighter) {
            // Dynamic Throttle
            let targetSpd = 500; // F-16E Desert Falcon Cruise
            if (track.isRTB) targetSpd = 600;
            else if (newTargetWaypoint) targetSpd = 1300; // Mach 2.0+ Intercept

            // Smooth speed transition (accel/decel normalized to seconds)
            const accelRate = 50 * actualElapsedSecs;
            const decelRate = 30 * actualElapsedSecs;
            if (newSpd < targetSpd) newSpd = Math.min(targetSpd, newSpd + accelRate);
            else if (newSpd > targetSpd) newSpd = Math.max(targetSpd, newSpd - decelRate);

            // Scramble climb (Normalized to 30,000 ft/min)
            if (track.alt < 50000) newAlt = Math.min(50000, track.alt + (500 * actualElapsedSecs));

            // Fuel Consumption (Normalized to actual time)
            // Approx burn: 13 lbs/sec at cruise, 50 lbs/sec at burner
            if (newFuel !== undefined) {
              const burnRatePerSec = newSpd > 600 ? 50 : 13;
              newFuel = Math.max(0, newFuel - (burnRatePerSec * actualElapsedSecs));
            }

            // Maneuvering (Turn rate normalized to seconds)
            if (newTargetWaypoint) {
              const dx = newTargetWaypoint.x - track.x;
              const dy = newTargetWaypoint.y - track.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              
              if (dist > 1.5) {
                let desiredHdg = Math.atan2(dx, -dy) * (180 / Math.PI);
                if (desiredHdg < 0) desiredHdg += 360;
                let hdgDiff = desiredHdg - newHdg;
                if (hdgDiff > 180) hdgDiff -= 360;
                if (hdgDiff < -180) hdgDiff += 360;
                // Max turn rate: 10 degrees per second (Standard rate turn is 3 deg/sec, 10 is aggressive)
                const turnRate = Math.max(-10 * actualElapsedSecs, Math.min(10 * actualElapsedSecs, hdgDiff));
                newHdg = (newHdg + turnRate + 360) % 360;
              } else {
                if (!track.isRTB) {
                  if (newTargetWaypoint !== null) {
                    events.push({ type: 'LOG', message: `${track.id}: On station.`, logType: 'INFO' });
                  }
                  newTargetWaypoint = null;
                  newHdg = (newHdg + (3 * actualElapsedSecs)) % 360; // Slow loiter turn
                }
              }
            } else {
              newHdg = (newHdg + (3 * actualElapsedSecs)) % 360; // Slow loiter turn
            }
          } else {
            // Dynamic Profiles for Non-Fighter Tracks
            const distToBattery = calculateRange(track.x, track.y, BATTERY_POS.x, BATTERY_POS.y, track.alt, 0);
            
            if (track.id === 'FLT-EK404') {
              // Hijack Profile: Aggressive descent to evade radar, throttle up
              if (newAlt > 5000) newAlt = Math.max(5000, newAlt - 500); // 10,000 ft/min emergency descent
              if (newSpd < 650) newSpd += 10; 
            } else if (track.category === 'TBM') {
              // Ballistic Profile: Exospheric cruise, then terminal hypersonic dive
              const tgtX = track.targetWaypoint ? track.targetWaypoint.x : BATTERY_POS.x;
              const tgtY = track.targetWaypoint ? track.targetWaypoint.y : BATTERY_POS.y;
              const distToTarget2D = calculateRange(track.x, track.y, tgtX, tgtY, 0, 0);
              
              if (distToTarget2D < 45) {
                // Terminal phase: Altitude is locked to remaining distance to mathematically guarantee impact
                newAlt = Math.max(0, (distToTarget2D / 45) * 150000); 
                if (newSpd < 6000) newSpd += 400 * (actualElapsedSecs / 3.0);
              } else {
                // High-altitude ballistic arc bleed
                newAlt = Math.max(150000, newAlt - 100 * (actualElapsedSecs / 3.0)); 
              }
            } else if (track.category === 'CM') {
              // Cruise Missile: Sea-skimming terrain following with slight jitter
              newAlt = Math.max(50, 100 + (Math.random() * 40 - 20)); 
            } else if (track.category === 'ROCKET') {
              // Rocket Salvo: Ballistic arc scaling with distance
              const tgtX = track.targetWaypoint ? track.targetWaypoint.x : BATTERY_POS.x;
              const tgtY = track.targetWaypoint ? track.targetWaypoint.y : BATTERY_POS.y;
              const distToTarget2D = calculateRange(track.x, track.y, tgtX, tgtY, 0, 0);
              newAlt = Math.max(0, Math.min(newAlt, (distToTarget2D / 40) * 30000));
            } else if (track.category === 'UAS') {
              // Drone Swarm: Slight altitude weave, and steer toward target asset
              newAlt = Math.max(100, track.alt + (Math.random() * 20 - 10));
              
              if (track.targetWaypoint) {
                const desiredHdg = calculateBearing(track.x, track.y, track.targetWaypoint.x, track.targetWaypoint.y);
                let hdgDiff = desiredHdg - newHdg;
                if (hdgDiff > 180) hdgDiff -= 360;
                if (hdgDiff < -180) hdgDiff += 360;
                // Slow drones turn slowly
                newHdg = (newHdg + Math.max(-2, Math.min(2, hdgDiff)) * (actualElapsedSecs / 3.0) + 360) % 360;
              }
            }

            // Cruise Missile Steering (Guided LACM)
            if (track.category === 'CM' && track.targetWaypoint) {
              const desiredHdg = calculateBearing(track.x, track.y, track.targetWaypoint.x, track.targetWaypoint.y);
              let hdgDiff = desiredHdg - newHdg;
              if (hdgDiff > 180) hdgDiff -= 360;
              if (hdgDiff < -180) hdgDiff += 360;
              // Cruise missiles steer aggressively
              newHdg = (newHdg + Math.max(-10, Math.min(10, hdgDiff)) * (actualElapsedSecs / 3.0) + 360) % 360;
            }
          }

                    const moveFactor = (newSpd / 3600) * actualElapsedSecs;
                    const radNew = newHdg * (Math.PI / 180);
                    // Note: We already calculated resX/resY based on pre-sweep velocity for visual continuity.
                    // However, for certain physics checks (like reaching a waypoint), we might want to check the final projected pos.
          
                    // Prevent threats from flying past their target. Stop horizontal motion if they reached it.
                    if (track.category === 'TBM' || track.category === 'ROCKET' || track.category === 'CM' || track.category === 'UAS') {
                      const tgtX = track.targetWaypoint ? track.targetWaypoint.x : BATTERY_POS.x;
                      const tgtY = track.targetWaypoint ? track.targetWaypoint.y : BATTERY_POS.y;
                      const distToWaypoint = calculateRange(track.x, track.y, tgtX, tgtY, 0, 0); // 2D distance
                      if (distToWaypoint <= moveFactor) {
                        resX = tgtX;
                        resY = tgtY;
                        newSpd = 0; // Arrest horizontal speed, let it drop/detonate
                      }
                    }
          
                    const isStealthy = track.category === 'UAS' || track.alt < 500;
                    const rangeToBattery = calculateRange(resX, resY, BATTERY_POS.x, BATTERY_POS.y, newAlt, 0);
                    
                    // Radar Horizon calculation (Standard NM formula)
                    const radarHorizonNm = 1.23 * (Math.sqrt(100) + Math.sqrt(newAlt));
                    
                    // Stealth targets have their effective radar cross section reduced, 
                    // which in this simplified model means they must be closer to be detected.
                    let detectionRange = radarHorizonNm;
                    if (isStealthy) {
                      detectionRange *= 0.45; // 55% reduction in detection range for stealth/low-alt
                    }

                    // Check if any active friendly fighter can see it (simulating datalink from fighter radar)
                    let spottedByFighter = false;
                    for (const f of currentTracks) {
                      if (f.isFighter && !f.isRTB) {
                        const distToFighter = calculateRange(resX, resY, f.x, f.y, newAlt, f.alt);
                        // Fighter radar has ~40 NM range against typical targets, half that for stealth
                        const fighterDetectRange = isStealthy ? 20 : 40;
                        if (distToFighter <= fighterDetectRange) {
                          spottedByFighter = true;
                          break;
                        }
                      }
                    }

                    const isDetected = track.sensor === 'L16' || rangeToBattery <= detectionRange || spottedByFighter;

          const newHistory = [{x: track.x, y: track.y}, ...track.history].slice(0, 15);
          return { ...track, x: resX, y: resY, history: newHistory, coasting: track.tq <= 2, detected: isDetected, spd: newSpd, alt: newAlt, hdg: newHdg, targetWaypoint: newTargetWaypoint, fuel: newFuel };
        });

        // 3. ROE Processor (Auto-ID)
        nextTracks = nextTracks.map(t => {
          if (t.type === 'PENDING' || t.type === 'UNKNOWN') {
            if (t.category === 'TBM' || t.category === 'ROCKET' || t.category === 'CM') {
               return { ...t, type: 'HOSTILE', threatName: getThreatName(t.category) };
            }
            if (t.category === 'UAS') {
              return { ...t, type: 'SUSPECT', threatName: 'UAS' };
            }
          }
          // Escalate SUSPECT UAS to HOSTILE if they are within 15NM of any asset
          if (t.type === 'SUSPECT' && t.category === 'UAS') {
             for (const asset of DEFENDED_ASSETS) {
               if (calculateRange(t.x, t.y, asset.x, asset.y) < 15) {
                 return { ...t, type: 'HOSTILE' };
               }
             }
          }
          return t;
        });

        // 4. Fighter AI (VID, Targeting, and Auto-Engagement)
        nextTracks = processFighters(nextTracks, events, sweepSimTime);

        // 5. Cleanup and RTB
        nextTracks = nextTracks.map(track => {
          if (track.isFighter && !track.isRTB) {
            if (track.missilesRemaining === 0) {
              events.push({ type: 'LOG', message: `${track.id}: Winchester. RTB Al Minhad.`, logType: 'INFO' });
              return { ...track, isRTB: true, targetWaypoint: { x: 57.5, y: 62.5 } };
            }
            if (track.fuel !== undefined && track.maxFuel !== undefined && track.fuel < (track.maxFuel * 0.25)) {
              events.push({ type: 'LOG', message: `${track.id}: Bingo fuel. RTB Al Minhad.`, logType: 'WARN' });
              return { ...track, isRTB: true, targetWaypoint: { x: 57.5, y: 62.5 } };
            }
          }
          return track;
        });

        // 6. Unified Auto-Engagement Doctrine (THAAD / PAC-3 / TAMIR)
        const doc = doctrineRef.current;
        const currentWcs = wcsRef.current;
        let shotsFiredThisSweep = 0;

        nextTracks = nextTracks.map(t => {
          // Determine if this target is eligible for auto-engagement
          const isHostile = t.type === 'HOSTILE';
          const isSuspect = t.type === 'SUSPECT';
          
          // WCS FREE allows engagement of SUSPECTS. WCS TIGHT requires HOSTILE.
          const isEngageable = isHostile || (currentWcs === 'FREE' && isSuspect);
          if (!isEngageable) return t;

          // Check if already being engaged by enough interceptors (conservation of fire)
          const existingInterceptors = t.interceptors ? t.interceptors.filter(i => i.shooterId === 'BATTERY').length : 0;
          
          let weaponToUse: 'THAAD' | 'PAC-3' | 'TAMIR' | null = null;
          let maxSalvo = 1; // Default to single shot

          if (t.category === 'TBM' && doc.autoEngageTBM) {
            // Priority: THAAD for long-range, PAC-3 for close-range
            const rng = calculateRange(t.x, t.y, BATTERY_POS.x, BATTERY_POS.y, t.alt, 0);
            if (rng > 40 && rng <= 100 && inventoryRef.current.thaad > 0) {
              weaponToUse = 'THAAD';
              maxSalvo = 1; 
            }
            else if (rng <= 40 && inventoryRef.current.pac3 > 0) {
              weaponToUse = 'PAC-3';
              maxSalvo = 1;
            }
          } 
          else if (t.category === 'CM' && doc.autoEngageCM) {
            if (inventoryRef.current.pac3 > 0) {
              weaponToUse = 'PAC-3';
              maxSalvo = 1;
            }
            else if (inventoryRef.current.tamir > 0) {
              weaponToUse = 'TAMIR';
              maxSalvo = 2; // Double tap CMs with Tamir
            }
          }
          else if (t.category === 'ROCKET' && doc.autoEngageRocket) {
            if (inventoryRef.current.tamir > 0) {
              weaponToUse = 'TAMIR';
              maxSalvo = 2; // Double tap rockets
            }
          }
          else if (t.category === 'UAS' && doc.autoEngageUAS) {
            if (inventoryRef.current.tamir > 0) {
              weaponToUse = 'TAMIR';
              maxSalvo = 2; // Double tap drones
            }
          }

          if (weaponToUse && existingInterceptors < maxSalvo) {
            const stats = WEAPON_STATS[weaponToUse];
            const rng = calculateRange(t.x, t.y, BATTERY_POS.x, BATTERY_POS.y, t.alt, 0);
            
            if (rng <= stats.range) {
              const shooterId = 'BATTERY';
              const missileSpdNmSec = stats.speedMach * MACH_TO_NM_SEC;
              const closureRate = calculateClosureRate(BATTERY_POS, t, missileSpdNmSec);
              
              // Physical launch stagger
              const shotDelayMs = (shotsFiredThisSweep * 250);
              shotsFiredThisSweep++;

              const interceptTimeSecs = (rng / Math.max(0.1, closureRate)) + (shotDelayMs / 1000);
              const isPkHit = Math.random() <= stats.pk;

              const newInterceptor = {
                id: `${weaponToUse}-AUTO-${sweepSimTime}-${Math.random()}`,
                weapon: weaponToUse,
                shooterId,
                launchPos: { x: BATTERY_POS.x, y: BATTERY_POS.y },
                engagementTime: sweepSimTime + shotDelayMs,
                interceptDuration: interceptTimeSecs * 1000,
                interceptTtl: Math.ceil(interceptTimeSecs),
                initialRange: rng,
                isPkHit
              };

              // Update inventory
              const invKey = weaponToUse.toLowerCase().replace('-3', '3') as keyof typeof inventory;
              inventoryRef.current[invKey]--;
              
              const costStr = stats.cost >= 1000000 ? `$${(stats.cost / 1000000).toFixed(1)}M` : `$${Math.round(stats.cost / 1000)}K`;
              events.push({ type: 'LOG', message: `AUTO-ENGAGE TRK ${t.id} (${weaponToUse}) [${costStr}]`, logType: 'ACTION' });
              events.push({ type: 'COST', amount: stats.cost });

              return { ...t, interceptors: [...(t.interceptors || []), newInterceptor] };
            }
          }
          return t;
        });

        // Sync inventory back to state
        setInventory({ ...inventoryRef.current });

        // 7. Terminal Point Defense (C-RAM / Laser CIWS)
                nextTracks = nextTracks.map(t => {
                  if (t.type === 'HOSTILE' && t.category !== 'TBM' && (!t.interceptors || !t.interceptors.some(i => i.shooterId.startsWith('C-RAM')))) {
                    // Check if track is threatening ANY defended asset that has C-RAM equipped
                    for (const asset of DEFENDED_ASSETS) {
                      if (!asset.hasCram) continue;
                      
                      const rngToAsset = calculateRange(t.x, t.y, asset.x, asset.y, t.alt, 0);
                      if (rngToAsset <= 2.5) {
                        incrementInterceptorsFired('C-RAM');
                        const costStr = WEAPON_STATS['C-RAM'].cost >= 1000000 ? `$${(WEAPON_STATS['C-RAM'].cost / 1000000).toFixed(1)}M` : `$${(WEAPON_STATS['C-RAM'].cost / 1000).toFixed(1)}K`;
                        events.push({ type: 'LOG', message: `C-RAM (${asset.id}) ENGAGING LEAKER TRK ${t.id} (-${costStr})`, logType: 'ACTION' });
                        events.push({ type: 'COST', amount: WEAPON_STATS['C-RAM'].cost });
                        
                        const closureRate = calculateClosureRate({x: asset.x, y: asset.y, alt: 0}, t, WEAPON_STATS['C-RAM'].speedMach * MACH_TO_NM_SEC);
                        const interceptTimeSecs = rngToAsset / Math.max(0.1, closureRate);
                        
                        // Pre-calculate Pk
                        const isPkHit = Math.random() <= WEAPON_STATS['C-RAM'].pk;

                        const newInterceptor = {
                          id: `CRAM-${sweepSimTime}-${Math.random()}`,
                          weapon: 'C-RAM' as const,
                          shooterId: `C-RAM (${asset.id})`,
                          launchPos: { x: asset.x, y: asset.y }, // Launch from the asset, not the battery
                          engagementTime: sweepSimTime,
                          interceptDuration: interceptTimeSecs * 1000,
                          interceptTtl: Math.ceil(interceptTimeSecs),
                          isPkHit
                        };
                        return { ...t, interceptors: [...(t.interceptors || []), newInterceptor] };
                      }
                    }
                  }
                  return t;
                });

                                                // 5. Leaker Detection (Impacts on Dubai)
                                                const impactedTracks: { trackId: string, assetId: string | null, damage: number, x: number, y: number }[] = [];
                                                nextTracks.forEach(t => {
                                                  if (t.type === 'HOSTILE' || t.type === 'SUSPECT') {
                                                    let hitAsset = false;
                                                    for (const assetId in assetsRef.current) {
                                                      const asset = assetsRef.current[assetId];
                                                      const dist = calculateRange(t.x, t.y, asset.x, asset.y, t.alt, 0);
                                                      
                                                      // 2.5 NM threshold because fast TBMs jump ~3.3NM per 3s sweep
                                                      // Altitude must also be near ground level to count as an impact
                                                      if (dist < 2.5 && t.alt < 2000) {
                                                        let damage = 10; // Default UAS
                                                        if (t.category === 'TBM') damage = 100;
                                                        if (t.category === 'CM') damage = 50;
                                                        if (t.category === 'ROCKET') damage = 20;
                                
                                                        impactedTracks.push({ trackId: t.id, assetId: asset.id, damage, x: t.x, y: t.y });
                                                        events.push({ type: 'IMPACT', assetId: asset.id, damage, trackId: t.id, x: t.x, y: t.y } as any);
                                                        hitAsset = true;
                                                        break; // Stop checking other assets for this track
                                                      }
                                                    }
                                
                                                    // If it reached the ground (or is a CM that reached its target waypoint) and didn't hit a specific asset
                                                    if (!hitAsset) {
                                                      const tgtX = t.targetWaypoint ? t.targetWaypoint.x : BATTERY_POS.x;
                                                      const tgtY = t.targetWaypoint ? t.targetWaypoint.y : BATTERY_POS.y;
                                                      
                                                      const isBallisticGroundHit = (t.category === 'TBM' || t.category === 'ROCKET') && t.alt <= 100;
                                                      const isSteeredGroundHit = (t.category === 'CM' || t.category === 'UAS') && calculateRange(t.x, t.y, tgtX, tgtY) < 1.0;
                                                      
                                                      if (isBallisticGroundHit || isSteeredGroundHit) {
                                                        let damage = 10; // Default UAS
                                                        if (t.category === 'TBM') damage = 100;
                                                        if (t.category === 'CM') damage = 50;
                                                        if (t.category === 'ROCKET') damage = 20;

                                                        impactedTracks.push({ trackId: t.id, assetId: null, damage, x: t.x, y: t.y });
                                                        
                                                        // Mathematically check if it fell within the green "Defended Metro Area" polygon
                                                        // The center of that polygon is roughly x: 51, y: 54. We'll use a 12 NM radius for the metro area.
                                                        const distToMetroCenter = calculateRange(t.x, t.y, 51, 54);
                                                        const isPopulated = distToMetroCenter <= 12;

                                                        events.push({ type: 'GROUND_IMPACT', trackId: t.id, damage, x: t.x, y: t.y, isPopulated } as any);
                                                      }
                                                    }
                                                  }
                                                });
                                        
                                                const impactedTrackIds = new Set(impactedTracks.map(it => it.trackId));                
                                return nextTracks.filter(t =>
                                  !impactedTrackIds.has(t.id) &&                  !(t.isFighter && t.isRTB && calculateRange(t.x, t.y, 57.5, 62.5) < 2) &&
                  t.x >= -100 && t.x <= 200 && t.y >= -100 && t.y <= 200
                );      }, sweepSimTime);

      events.forEach(e => {
        if (e.type === 'LOG') addLog(e.message!, e.logType);
        if (e.type === 'COST') addDefenseCost(e.amount!);
        if (e.type === 'AMRAAM_FIRED') incrementInterceptorsFired('AMRAAM');
        if (e.type === 'IMPACT') {
          const { assetId, trackId, x, y } = e as any;
          const asset = useTrackStore.getState().assets[assetId];
          
          addLeaker();
          
          // Generate a ground splash
          setSplashes(prev => [...prev, { id: `impact-${Date.now()}-${Math.random()}`, x, y, time: Date.now() }]);
          
          addLog(`IMPACT: ${asset.name} STRUCK BY ${trackId}.`, 'ALERT');
        }
        if ((e as any).type === 'SPLASH') {
          // Mid-air intercept splash
          setSplashes(prev => [...prev, { id: `splash-${Date.now()}-${Math.random()}`, x: (e as any).x, y: (e as any).y, time: Date.now() }]);
        }
        if ((e as any).type === 'GROUND_IMPACT') {
          const { x, y, trackId, isPopulated } = e as any;
          if (isPopulated) {
            addLog(`WARNING: ${trackId} IMPACTED WITHIN METROPOLITAN AREA.`, 'ALERT');
            // We'll also count this as a leaker for the final score, since the goal is to protect the city
            addLeaker();
          } else {
            addLog(`IMPACT: ${trackId} DETONATED IN UNPOPULATED TERRAIN.`, 'INFO');
          }
          setSplashes(prev => [...prev, { id: `ground-${Date.now()}-${Math.random()}`, x, y, time: Date.now() }]);
        }
      });
    }, 3000);

    return () => {
            clearInterval(clockTimer);
            clearInterval(sweepTimer);
          };
        }, [addLog, isGameStarted]);
      
        // --- INTERACTION HELPERS ---

  const getMapCoords = useCallback((e: React.PointerEvent | PointerEvent, container: HTMLDivElement) => {
    const svg = container.querySelector('svg');
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: svgP ? svgP.x : 0, y: svgP ? svgP.y : 0 };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const coords = getMapCoords(e, e.currentTarget);
    const lastSweepTime = useTrackStore.getState().lastSweepTime;
    const elapsed = (nowStore.now - lastSweepTime) / 1000;

    if (vectoringTrackId) {
      setTracks(current => current.map(t => 
        t.id === vectoringTrackId ? { ...t, targetWaypoint: { x: coords.x, y: coords.y }, patrolWaypoint: { x: coords.x, y: coords.y } } : t
      ));
      addLog(`VECTOR COMMAND ISSUED TO ${vectoringTrackId}`, 'ACTION');
      setVectoringTrackId(null);
      return;
    }

    const CLICK_RADIUS = 2.5; // Slightly larger for easier selection on high-speed targets
    const nearbyTracks = useTrackStore.getState().getAllTracks()
      .filter(t => t.detected !== false)
      .filter(t => {
        const smoothX = t.x + Math.sin(t.hdg * Math.PI / 180) * ((t.spd / 3600) * elapsed);
        const smoothY = t.y - Math.cos(t.hdg * Math.PI / 180) * ((t.spd / 3600) * elapsed);
        return calculateRange(smoothX, smoothY, coords.x, coords.y) <= CLICK_RADIUS;
      });

    if (e.shiftKey) {
      if (nearbyTracks.length > 0) {
        const targetId = nearbyTracks[0].id;
        setHookedTrackIds(prev => prev.includes(targetId) ? prev.filter(id => id !== targetId) : [...prev, targetId]);
      } else {
        setIsSelecting(true);
        setSelectionBox({ startX: coords.x, startY: coords.y, endX: coords.x, endY: coords.y });
      }
    } else {
      if (nearbyTracks.length > 0) {
        const currentSingleHook = hookedTrackIds.length === 1 ? hookedTrackIds[0] : null;
        const currentIndex = nearbyTracks.findIndex(t => t.id === currentSingleHook);
        
        if (currentIndex !== -1 && nearbyTracks.length > 1) {
          const nextIndex = (currentIndex + 1) % nearbyTracks.length;
          setHookedTrackIds([nearbyTracks[nextIndex].id]);
        } else {
          setHookedTrackIds([nearbyTracks[0].id]);
        }
      } else {
        // Clicking anywhere on the map that isn't a track immediately drops the selection
        setHookedTrackIds([]);
      }
      
      setIsDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setFollowedTrackId(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const coords = getMapCoords(e, e.currentTarget);
    nowStore.updateMouse(coords.x, coords.y);

    if (draggingWaypointId) {
      setTracks(current => current.map(t => 
        t.id === draggingWaypointId ? { ...t, targetWaypoint: coords, patrolWaypoint: coords } : t
      ));
      return;
    }

    if (isSelecting && selectionBox) {
      const coords = getMapCoords(e, e.currentTarget);
      setSelectionBox(prev => prev ? { ...prev, endX: coords.x, endY: coords.y } : null);
      return;
    }

    if (isDragging) {
      const rect = e.currentTarget.getBoundingClientRect();
      const viewBoxWidth = 100 / camera.zoom;
      const viewBoxHeight = 100 / camera.zoom;
      const scale = Math.max(viewBoxWidth / rect.width, viewBoxHeight / rect.height);
      
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      setCamera(prev => ({
        ...prev,
        x: prev.x - dx * scale,
        y: prev.y - dy * scale
      }));
      setDragStart({ x: e.clientX, y: e.clientY });
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (draggingWaypointId) {
      setDraggingWaypointId(null);
      return;
    }

    if (isSelecting && selectionBox) {
      const x1 = Math.min(selectionBox.startX, selectionBox.endX);
      const x2 = Math.max(selectionBox.startX, selectionBox.endX);
      const y1 = Math.min(selectionBox.startY, selectionBox.endY);
      const y2 = Math.max(selectionBox.startY, selectionBox.endY);
      const lastSweepTime = useTrackStore.getState().lastSweepTime;
      const elapsed = (nowStore.now - lastSweepTime) / 1000;

      // Identify tracks in box
      const inBox = useTrackStore.getState().getAllTracks()
        .filter(t => t.detected !== false)
        .filter(t => {
          const smoothX = t.x + Math.sin(t.hdg * Math.PI / 180) * ((t.spd / 3600) * elapsed);
          const smoothY = t.y - Math.cos(t.hdg * Math.PI / 180) * ((t.spd / 3600) * elapsed);
          return smoothX >= x1 && smoothX <= x2 && smoothY >= y1 && smoothY <= y2;
        })
        .map(t => t.id);

      if (inBox.length > 0) {
        setHookedTrackIds(prev => e.shiftKey ? Array.from(new Set([...prev, ...inBox])) : inBox);
        addLog(`GROUP HOOK: ${inBox.length} TRACKS SELECTED`, 'INFO');
      } else if (!e.shiftKey) {
        // Only clear if not adding to selection
        // Actually, if you draw an empty box, it usually clears.
        setHookedTrackIds([]);
      }
    }

    setIsDragging(false);
    setIsSelecting(false);
    setSelectionBox(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    setFollowedTrackId(null);
    const zoomFactor = 1.1;
    setCamera(prev => {
      let newZoom = prev.zoom;
      if (e.deltaY < 0) {
        newZoom = Math.min(10, prev.zoom * zoomFactor);
      } else {
        newZoom = Math.max(0.2, prev.zoom / zoomFactor);
      }
      return { ...prev, zoom: newZoom };
    });
  };

  // --- TACTICAL ACTIONS ---

  const handleInterrogate = useCallback((targetIds?: string[]) => {
    const idsToInterrogate = targetIds || hookedTrackIds;
    if (idsToInterrogate.length === 0) return;
    
    idsToInterrogate.forEach((id, index) => {
      const track = useTrackStore.getState().getTrack(id);
      if (!track || track.isInterrogating || track.type === 'FRIEND' || track.type === 'ASSUMED_FRIEND') return;

      // Stagger multiple interrogations for visual effect
      setTimeout(() => {
        setTracks(current => current.map(t => t.id === id ? { ...t, isInterrogating: true } : t));
        addLog(`INTERROGATING TRK ${id}...`, 'ACTION');

        setTimeout(() => {
          const isHijack = id === 'FLT-EK404';
          const currentTrack = useTrackStore.getState().getTrack(id);
          if (!currentTrack) return;

          const isSweet = !isHijack && 
                         (currentTrack.category === 'FW' || currentTrack.category === 'RW') && 
                         (currentTrack.spd > 250 && currentTrack.alt > 10000);
          
          let message = '';
          let logType: 'INFO' | 'WARN' | 'ALERT' = 'INFO';
          
          if (isHijack) {
            message = `TRK ${id} IFF SOUR (SQUAWK 7500 - HIJACK)`;
            logType = 'ALERT';
          } else if (isSweet) {
            message = `TRK ${id} IFF SWEET (MODE 3/C VALID)`;
            logType = 'INFO';
          } else {
            message = `TRK ${id} IFF SOUR (NO RESPONSE)`;
            logType = 'WARN';
          }

          addLog(message, logType);

          setTracks(currentTracks => currentTracks.map(t => {
            if (t.id !== id) return t;
            let update = { ...t, iffInterrogated: true, isInterrogating: false };
            if (t.type === 'HOSTILE' || t.type === 'FRIEND' || t.type === 'ASSUMED_FRIEND') return update;
            if (isHijack) return { ...update, type: 'SUSPECT', threatName: 'HIJACK' };
            if (isSweet) return { ...update, type: 'FRIEND' };
            return { ...update, type: 'SUSPECT' }; // SOUR = SUSPECT
          }));
        }, 1500);
      }, index * 200);
    });
  }, [hookedTrackIds]);

  const handleDeclare = useCallback((newType: TrackType) => {
    if (hookedTrackIds.length === 0) return;
    
    setTracks(currentTracks => currentTracks.map(t => {
      if (!hookedTrackIds.includes(t.id)) return t;
      
      let threatName = t.threatName;
      if (newType === 'HOSTILE') {
        if (t.id === 'FLT-EK404') threatName = 'HIJACK';
        else if (t.type === 'FRIEND' || t.type === 'ASSUMED_FRIEND') threatName = t.threatName || t.id;
        else threatName = getThreatName(t.category);
      } else if (newType === 'SUSPECT' || newType === 'UNKNOWN') {
        if (t.id !== 'FLT-EK404') threatName = undefined;
      }
      return { ...t, type: newType, threatName };
    }));

    addLog(`GROUP DECLARE: ${hookedTrackIds.length} TRACKS SET TO ${newType}`, newType === 'HOSTILE' ? 'ALERT' : 'WARN');
  }, [hookedTrackIds]);

    const handleEngage = useCallback((weapon: 'PAC-3' | 'TAMIR' | 'THAAD', targetIds?: string[]) => {
      const idsToEngage = targetIds || hookedTrackIds;
      if (idsToEngage.length === 0) return;
  
      const stats = WEAPON_STATS[weapon];
      let currentPac3 = inventory.pac3;
      let currentTamir = inventory.tamir;
      let currentThaad = inventory.thaad;
  
      idsToEngage.forEach((id, index) => {
        const target = useTrackStore.getState().getTrack(id);
        if (!target) return;
  
        // Kinematic limitations
        if (target.type !== 'HOSTILE') {
          addLog(`WARNING: ENGAGING NON-HOSTILE TRACK ${target.id} (${target.type})`, 'ALERT');
        }

        if (weapon === 'TAMIR') {
          if (target.category === 'TBM') {
            addLog(`TAMIR CANNOT ENGAGE TBM (OUT OF ENVELOPE)`, 'WARN');
            return;
          }
          if (target.category === 'FW' || target.category === 'RW') {
            addLog(`TAMIR CANNOT ENGAGE AIRCRAFT (RESTRICTED DOCTRINE)`, 'WARN');
            return;
          }
          if (target.alt > 30000) {
            addLog(`TAMIR CANNOT ENGAGE TRK ${target.id} (ALTITUDE > 30K FT)`, 'WARN');
            return;
          }
        }
  
              if (weapon === 'PAC-3' || weapon === 'THAAD') {
                if (target.category === 'UAS') {
                  addLog(`WARNING: USING HIGH-VALUE ASSET ON LOW-VALUE UAS`, 'WARN');
                }
              }
        
              const shotsToTake = 1;
        
              // Check ammo
              if (weapon === 'PAC-3' && currentPac3 <= 0) return;        if (weapon === 'TAMIR' && currentTamir <= 0) return;
        if (weapon === 'THAAD' && currentThaad <= 0) return;
  
        const rng = calculateRange(target.x, target.y, BATTERY_POS.x, BATTERY_POS.y, target.alt, 0);
        if (rng > stats.range) return;
  
        // Deduct from local count for this loop
        if (weapon === 'PAC-3') currentPac3 -= shotsToTake;
        if (weapon === 'TAMIR') currentTamir -= shotsToTake;
        if (weapon === 'THAAD') currentThaad -= shotsToTake;
  
        // Stagger launches
        setTimeout(() => {
          setInventory(prev => ({
            ...prev,
            pac3: weapon === 'PAC-3' ? prev.pac3 - shotsToTake : prev.pac3,
                      tamir: weapon === 'TAMIR' ? prev.tamir - shotsToTake : prev.tamir,
                      thaad: weapon === 'THAAD' ? prev.thaad - shotsToTake : prev.thaad,
                    }));
                    
                    incrementInterceptorsFired(weapon, shotsToTake);
                    
                    const costStr = stats.cost >= 1000000 ? `${(stats.cost / 1000000).toFixed(1)}M` : `${Math.round(stats.cost / 1000)}K`;
                    addDefenseCost(stats.cost * shotsToTake);
                    addLog(`BIRDS AWAY. ENGAGING TRK ${id} WITH ${weapon} (-${costStr})`, 'ACTION');
        
        const missileSpdNmSec = stats.speedMach * MACH_TO_NM_SEC;
        const closureRate = calculateClosureRate(BATTERY_POS, target, missileSpdNmSec);
        
        const launchPos = { x: BATTERY_POS.x, y: BATTERY_POS.y };
        const currentSimTime = nowStore.now;

        setTracks(current => current.map(t => {
          if (t.id === id) {
             const interceptTimeSecs = (rng / Math.max(0.1, closureRate));
             
             // Pre-calculate Pk for live destruction
             const isPkHit = Math.random() <= stats.pk;

             const newInterceptor = {
               id: `${weapon}-${currentSimTime}-${Math.random()}`,
               weapon,
               shooterId: 'BATTERY',
               launchPos,
               engagementTime: currentSimTime,
               interceptDuration: interceptTimeSecs * 1000,
               interceptTtl: Math.ceil(interceptTimeSecs),
               initialRange: rng,
               isPkHit
             };
            return { ...t, interceptors: [...(t.interceptors || []), newInterceptor] };
          }
          return t;
        }));
      }, index * 500);
    });
  }, [hookedTrackIds, inventory]);

  const handleAckAlerts = useCallback(() => {
    setLogs(currentLogs => currentLogs.map(l => ({ ...l, acknowledged: true })));
  }, []);

  const unackAlertsRef = useRef(unackAlerts);
  const inventoryRef = useRef(inventory);
  const doctrineRef = useRef(doctrine);
  const wcsRef = useRef(wcs);
  const assets = useTrackStore(state => state.assets);
  const assetsRef = useRef(assets);

  useEffect(() => {
    unackAlertsRef.current = unackAlerts;
    inventoryRef.current = inventory;
    doctrineRef.current = doctrine;
    wcsRef.current = wcs;
    assetsRef.current = assets;
  }, [unackAlerts, inventory, doctrine, wcs, assets]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input (though we don't have any yet)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const trigger = (key: string, action: () => void) => {
        action();
        setButtonFeedback(prev => ({ ...prev, [key]: 'action' }));
        setTimeout(() => setButtonFeedback(prev => {
          const next = { ...prev };
          delete next[key];
          return next;
        }), 150);
      };

      switch (e.key) {
        case ' ':
          e.preventDefault();
          setIsPaused(prev => !prev);
          break;
        case '1':
          if (hookedTrackIds.length > 0) trigger('1', () => setHookedTrackIds([]));
          break;
        case '2':
          if (hookedTrackIds.length > 0) trigger('2', () => handleInterrogate());
          break;
        case '3':
          if (hookedTrackIds.length > 0) trigger('3', () => {
            const anyNonHostile = useTrackStore.getState().getAllTracks().some(t => hookedTrackIds.includes(t.id) && t.type !== 'HOSTILE');
            handleDeclare(anyNonHostile ? 'HOSTILE' : 'SUSPECT');
          });
          break;
        case '4':
          if (hookedTrackIds.length > 0) trigger('4', () => handleEngage('THAAD'));
          break;
        case '5':
          if (hookedTrackIds.length > 0) trigger('5', () => handleEngage('PAC-3'));
          break;
        case '6':
          if (hookedTrackIds.length > 0) trigger('6', () => handleEngage('TAMIR'));
          break;
        case '7':
          if (unackAlertsRef.current.length > 0) trigger('7', () => setLogs(currentLogs => currentLogs.map(l => ({ ...l, acknowledged: true }))));
          break;
        case '8':
          trigger('8', () => setDoctrine(prev => {
            const anyActive = Object.values(prev).some(v => v);
            return {
              autoEngageTBM: !anyActive,
              autoEngageCM: !anyActive,
              autoEngageUAS: !anyActive,
              autoEngageRocket: !anyActive
            };
          }));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hookedTrackIds, handleInterrogate, handleDeclare, handleEngage]);

  // --- RENDER HELPERS ---

  const masterWarning = useTrackStore(state => {
    const hookedTracks = hookedTrackIds.map(id => state.tracks[id]).filter(Boolean);
    const hookedTrack = hookedTracks.length === 1 ? hookedTracks[0] : undefined;
    if (hookedTrack && hookedTrack.type === 'HOSTILE') {
      const { tcpa, cpa } = calculateKinematics(hookedTrack);
      if (tcpa < 120 && parseFloat(cpa) < 10) return true;
    }
    return false;
  });

  return (
    <div className="h-screen w-screen bg-[#00050A] text-[#00E5FF] font-mono flex flex-col overflow-hidden selection:bg-[#004466] relative tabular-nums [font-variant-numeric:slashed-zero]">
      {!isGameStarted && <BriefingModal onStart={() => setIsGameStarted(true)} />}
      {isGameOver && <AfterActionReport />}
      
      {isPaused && !isGameOver && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center justify-center pointer-events-none drop-shadow-[0_0_15px_rgba(0,0,0,1)]">
          <div className="bg-[#FFCC00] text-[#00050A] px-6 py-2 border-2 border-[#FFCC00] font-bold tracking-[0.5em] animate-pulse">
            TACTICAL PAUSE
          </div>
          <div className="bg-[#00050A]/90 text-[#FFCC00] px-4 py-1 text-[10px] tracking-widest border-b border-x border-[#FFCC00]/50 backdrop-blur-md">
            SIMULATION SUSPENDED. COMBAT SYSTEMS ONLINE.
          </div>
        </div>
      )}

      {/* --- FULL SCREEN TACTICAL MAP BACKGROUND --- */}
      <div 
        className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden pointer-events-auto touch-none" 
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        style={{ cursor: vectoringTrackId ? 'crosshair' : (isDragging ? (isSelecting ? 'crosshair' : 'grabbing') : 'grab') }}
      >
        <svg 
          className="absolute inset-0 w-full h-full opacity-80" 
          viewBox={`${camera.x - 50 / camera.zoom} ${camera.y - 50 / camera.zoom} ${100 / camera.zoom} ${100 / camera.zoom}`} 
          preserveAspectRatio="xMidYMid slice"
        >
          
          <StaticMapBackground cameraZoom={camera.zoom} />
          <DefendedAssets cameraZoom={camera.zoom} />

          <FighterWaypoints cameraZoom={camera.zoom} setDraggingWaypointId={setDraggingWaypointId} />

          {/* Render Ghost Vector Line */}
          {vectoringTrackId && <GhostVectorLine vectoringTrackId={vectoringTrackId} cameraZoom={camera.zoom} />}

          {/* Render Splashes */}
          {splashes.map(s => (
            <g key={s.id} transform={`translate(${s.x}, ${s.y})`}>
              <circle r={2 / camera.zoom} fill="none" stroke="#FF0033" strokeWidth={0.2 / camera.zoom} className="animate-ping" style={{ animationIterationCount: 1, animationFillMode: 'forwards' }} />
              <line x1={-1 / camera.zoom} y1={-1 / camera.zoom} x2={1 / camera.zoom} y2={1 / camera.zoom} stroke="#FF0033" strokeWidth={0.2 / camera.zoom} />
              <line x1={1 / camera.zoom} y1={-1 / camera.zoom} x2={-1 / camera.zoom} y2={1 / camera.zoom} stroke="#FF0033" strokeWidth={0.2 / camera.zoom} />
            </g>
          ))}

                    {trackIds.map(trackId => {
                      return (
                        <TrackSymbol 
                          key={`track-group-${trackId}`} 
                          trackId={trackId} 
                          isHooked={hookedTrackIds.includes(trackId)} 
                          cameraZoom={camera.zoom} 
                          filters={filters} 
                        />
                      );
                    })}
          {/* Render Marquee Selection Box */}
          {selectionBox && (
            <rect
              x={Math.min(selectionBox.startX, selectionBox.endX)}
              y={Math.min(selectionBox.startY, selectionBox.endY)}
              width={Math.abs(selectionBox.endX - selectionBox.startX)}
              height={Math.abs(selectionBox.endY - selectionBox.startY)}
              fill="#00FFFF"
              fillOpacity="0.1"
              stroke="#00FFFF"
              strokeWidth={0.2 / camera.zoom}
              strokeDasharray={`${0.5 / camera.zoom} ${0.5 / camera.zoom}`}
            />
          )}
        </svg>
      </div>

            {/* --- TOP STATUS BAR --- */}
                  <header className={`fixed top-0 left-0 right-0 h-16 bg-[#00050A]/70 backdrop-blur-md border-b ${masterWarning ? 'border-[#FF0033] bg-[#220000]/70' : 'border-[#002B40]'} flex items-center justify-between px-4 z-50 rounded-none transition-colors duration-300 shrink-0`}>
                    <div className="flex items-center gap-4 lg:gap-6">
                      <div className="flex items-center gap-2 whitespace-nowrap" title="Joint Integrated Air and Missile Defense">
                        <span className={masterWarning ? 'text-[#FF0033]' : 'text-[#00E5FF]'}>[SYS]</span>
                        <span className={`text-sm font-bold tracking-widest ${masterWarning ? 'text-[#FF0033] animate-pulse' : 'text-[#00E5FF]'}`}>
                          {masterWarning ? 'ALARM: ENGAGEMENT CRITERIA MET' : 'JIAMD'}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] lg:text-xs font-bold tracking-wider border-l border-[#002B40] pl-4 lg:pl-6">
                        <span className="text-[#FFCC00] whitespace-nowrap" title="Weapons Control Status: TIGHT (Fire only at hostiles) / FREE (Fire at any non-friendly)">WCS: <span className={wcs === 'FREE' ? 'text-[#FF0033] animate-pulse' : 'text-[#00E5FF]'}>{wcs}</span></span>
                        <div className="hidden lg:block w-px h-4 bg-[#002B40] mx-1" />
                        <span className="text-[#00FF33] whitespace-nowrap" title="Terminal High Altitude Area Defense (Anti-Ballistic)">THAAD: <span className="text-[#00E5FF] tabular-nums">{inventory.thaad}/8</span></span>
                        <span className="text-[#00FF33] whitespace-nowrap" title="Patriot Advanced Capability-3 MSE (Hit-to-Kill Interceptor)">PAC-3: <span className="text-[#00E5FF] tabular-nums">{inventory.pac3}/32</span></span>
                        <span className="text-[#00FF33] whitespace-nowrap" title="Iron Dome Interceptor (Counter-Rocket/UAS)">TAMIR: <span className="text-[#00E5FF] tabular-nums">{inventory.tamir}/120</span></span>
                        <span className="text-[#00FF33] whitespace-nowrap" title="Counter Rocket, Artillery, and Mortar (Terminal Auto-Defense)">C-RAM: <span className="text-[#00E5FF]">RDY</span></span>
                      </div>
                    </div>
              <div className="flex items-center gap-4 lg:gap-6 text-[10px] lg:text-xs font-bold whitespace-nowrap">
                {unackAlerts.length > 0 && (
                  <div className="bg-[#FF0033] text-[#00050A] px-2 py-1 animate-pulse border border-[#FF0033]">
                    {unackAlerts.length} UNACK ALERTS
                  </div>
                )}
                <SystemClock />
              </div>
            </header>
      
            {/* --- MAIN CONTENT AREA --- */}
            <main className="fixed inset-0 top-16 bottom-16 z-20 pointer-events-none overflow-hidden">
              
              {/* LEFT DRAGGABLE WINDOW */}
              <DraggableWindow 
                title="TRACK SUMMARY & LOGS" 
                defaultPos={{ x: 16, y: 16 }} 
                className="w-[280px] max-h-[calc(100vh-160px)]"
              >
                <div className="flex flex-col gap-4 p-4 h-full overflow-hidden">
                  <TrackSummaryTable hookedTrackIds={hookedTrackIds} setHookedTrackIds={setHookedTrackIds} filters={filters} setFilters={setFilters} />
                  <SystemEventLog logs={logs} />
                </div>
              </DraggableWindow>
      
              {/* RIGHT DRAGGABLE WINDOW */}
              <DraggableWindow 
                title="TOTE & DOCTRINE" 
                defaultPos={{ x: window.innerWidth ? window.innerWidth - 276 : 1000, y: 16 }} 
                className="w-[260px] max-h-[calc(100vh-160px)]"
              >
                <Tote hookedTrackIds={hookedTrackIds} masterWarning={masterWarning} vectoringTrackId={vectoringTrackId} setVectoringTrackId={setVectoringTrackId} doctrine={doctrine} setDoctrine={setDoctrine} filters={filters} setFilters={setFilters} wcs={wcs} setWcs={setWcs} />
              </DraggableWindow>
              
            </main>
      
            {/* --- BOTTOM SOFT KEY BAR --- */}
            <footer className="fixed bottom-0 left-0 right-0 h-16 bg-[#00050A]/95 border-t border-[#002B40] flex items-center px-2 lg:px-4 gap-1 lg:gap-2 z-50 shrink-0 pointer-events-auto overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="text-[#004466] text-[10px] font-bold mr-2 lg:mr-4 whitespace-nowrap">OSD / SOFT KEYS</div>
        
        <button 
          className={`h-10 px-2 lg:px-4 border hover:bg-[#002B40] text-[#00E5FF] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap ${
            buttonFeedback['1'] === 'action' ? 'bg-[#004466] border-[#00E5FF] brightness-150 scale-[0.98]' : 'bg-[#001A26] border-[#004466]'
          }`}
          disabled={hookedTrackIds.length === 0}
          onClick={() => { triggerKeyFeedback('1', 'action'); setHookedTrackIds([]); }}
          title="Drop currently hooked track(s) selection"
        >
          <span className="text-[8px] text-[#004466] mb-0.5">1</span>
          DROP
        </button>

        <button 
          className={`h-10 px-2 lg:px-4 border hover:bg-[#002B40] text-[#00E5FF] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap ${
            buttonFeedback['2'] === 'action' ? 'bg-[#004466] border-[#00E5FF] brightness-150 scale-[0.98]' : 'bg-[#001A26] border-[#004466]'
          }`}
          disabled={hookedTrackIds.length === 0}
          onClick={() => { triggerKeyFeedback('2', 'action'); handleInterrogate(); }}
          title="Identification Friend or Foe: Interrogate the selected track for electronic signature"
        >
          <span className="text-[8px] text-[#004466] mb-0.5">2</span>
          IFF
        </button>

        <button 
          className={`h-10 px-2 lg:px-4 border hover:bg-[#002B40] text-[#00E5FF] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap ${
            buttonFeedback['3'] === 'action' ? 'bg-[#004466] border-[#00E5FF] brightness-150 scale-[0.98]' : 'bg-[#001A26] border-[#004466]'
          }`}
          disabled={hookedTrackIds.length === 0}
          onClick={() => {
            triggerKeyFeedback('3', 'action');
            const anyNonHostile = useTrackStore.getState().getAllTracks().some(t => hookedTrackIds.includes(t.id) && t.type !== 'HOSTILE');
            handleDeclare(anyNonHostile ? 'HOSTILE' : 'SUSPECT');
          }}
          title="Declare the selected track as HOSTILE (Cleared to Engage) or downgrade to SUSPECT"
        >
          <span className="text-[8px] text-[#004466] mb-0.5">3</span>
          {useTrackStore.getState().getAllTracks().some(t => hookedTrackIds.includes(t.id) && t.type !== 'HOSTILE') ? 'DECL HOSTILE' : 'DOWNGRADE'}
        </button>

        <div className="w-px h-8 bg-[#002B40] mx-1 lg:mx-2 shrink-0" />

        <button 
          className={`h-10 px-2 lg:px-4 border hover:bg-[#002B40] text-[#00E5FF] text-[10px] lg:text-xs font-bold tracking-widest transition-all flex flex-col items-center justify-center whitespace-nowrap bg-[#001A26] border-[#004466]`}
          onClick={() => {
            const pendingIds = useTrackStore.getState().getAllTracks().filter(t => (t.type === 'PENDING' || t.type === 'UNKNOWN') && t.detected).map(t => t.id);
            if (pendingIds.length > 0) {
              handleInterrogate(pendingIds);
            }
          }}
          title="Interrogate all currently detected UNKNOWN/PENDING tracks"
        >
          IFF ALL
        </button>

        <button 
          className={`h-10 px-2 lg:px-4 border hover:bg-[#440033] text-[#FF00FF] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center ml-auto whitespace-nowrap ${
            buttonFeedback['4'] === 'action' ? 'bg-[#660066] border-[#FF00FF] brightness-150 scale-[0.98]' : 'bg-[#330033] border-[#FF00FF]'
          }`}
          disabled={hookedTrackIds.length === 0}
          onClick={() => { triggerKeyFeedback('4', 'action'); handleEngage('THAAD'); }}
        >
          <span className="text-[8px] text-[#FF00FF] opacity-50 mb-0.5">4</span>
          ENGAGE THAAD
        </button>

        <button 
          className={`h-10 px-2 lg:px-4 border hover:bg-[#440000] text-[#FF0033] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap ${
            buttonFeedback['5'] === 'action' ? 'bg-[#660000] border-[#FF0033] brightness-150 scale-[0.98]' : 'bg-[#330000] border-[#FF0033]'
          }`}
          disabled={hookedTrackIds.length === 0}
          onClick={() => { triggerKeyFeedback('5', 'action'); handleEngage('PAC-3'); }}
        >
          <span className="text-[8px] text-[#FF0033] opacity-50 mb-0.5">5</span>
          ENGAGE PAC-3
        </button>

        <button 
          className={`h-10 px-2 lg:px-4 border hover:bg-[#333300] text-[#FFCC00] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap ${
            buttonFeedback['6'] === 'action' ? 'bg-[#666600] border-[#FFCC00] brightness-150 scale-[0.98]' : 'bg-[#222200] border-[#FFCC00]'
          }`}
          disabled={hookedTrackIds.length === 0}
          onClick={() => { triggerKeyFeedback('6', 'action'); handleEngage('TAMIR'); }}
        >
          <span className="text-[8px] text-[#FFCC00] opacity-50 mb-0.5">6</span>
          ENGAGE TAMIR
        </button>

        <div className="w-px h-8 bg-[#002B40] mx-1 lg:mx-2 shrink-0" />

        <button 
          className={`h-10 px-2 lg:px-4 border text-[10px] lg:text-xs font-bold tracking-widest transition-all flex flex-col items-center justify-center whitespace-nowrap shrink-0 ${
            unackAlerts.length > 0 
              ? (buttonFeedback['7'] === 'action' ? 'bg-[#FF3366] border-[#FF0033] text-[#00050A] brightness-150 scale-[0.98]' : 'bg-[#FF0033] border-[#FF0033] text-[#00050A] hover:bg-[#CC0022]')
              : 'bg-[#001A26] border-[#004466] text-[#004466] cursor-not-allowed'
          }`}
          disabled={unackAlerts.length === 0}
          onClick={() => { triggerKeyFeedback('7', 'action'); handleAckAlerts(); }}
        >
          <span className={`text-[8px] mb-0.5 ${unackAlerts.length > 0 ? 'text-[#00050A] opacity-70' : 'text-[#004466]'}`}>7</span>
          ACK ALERTS
        </button>
      </footer>

      {/* CRT Overlay */}
      <div className="fixed inset-0 pointer-events-none z-50 mix-blend-overlay opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%]" />
    </div>
  );
}
