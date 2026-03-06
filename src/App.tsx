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
  const lastSweepTime = useTrackStore(state => state.lastSweepTime);
  
  const tailLineRef = useRef<SVGLineElement>(null);
  const pulseLineRef = useRef<SVGLineElement>(null);
  const headCircleRef = useRef<SVGCircleElement>(null);
  const textRef = useRef<SVGTextElement>(null);

  useEffect(() => {
    return nowStore.subscribeTime(() => {
      const currentSimTime = nowStore.now;
      const elapsedSinceLaunch = currentSimTime - interceptor.engagementTime;
      
      if (elapsedSinceLaunch < 0) return;

      const progress = Math.min(1, Math.max(0, elapsedSinceLaunch / interceptor.interceptDuration));
      const elapsedSinceLastSweep = (currentSimTime - lastSweepTime) / 1000;
      const smoothTti = Math.max(0, interceptor.interceptTtl - elapsedSinceLastSweep);

      if (progress >= 1) {
        if (tailLineRef.current) tailLineRef.current.style.display = 'none';
        if (pulseLineRef.current) pulseLineRef.current.style.display = 'none';
        if (headCircleRef.current) headCircleRef.current.style.display = 'none';
        if (textRef.current) textRef.current.style.display = 'none';
        return;
      }

      const startX = interceptor.launchPos.x;
      const startY = interceptor.launchPos.y;

      const rad = track.hdg * Math.PI / 180;
      const sinH = Math.sin(rad);
      const cosH = Math.cos(rad);
      const spdNmSec = track.spd / 3600;

      const currentTargetX = track.x + sinH * (spdNmSec * elapsedSinceLastSweep);
      const currentTargetY = track.y - cosH * (spdNmSec * elapsedSinceLastSweep);

      const remainingSecs = (interceptor.interceptDuration - elapsedSinceLaunch) / 1000;
      const targetLeadX = currentTargetX + sinH * (spdNmSec * remainingSecs);
      const targetLeadY = currentTargetY - cosH * (spdNmSec * remainingSecs);

      let missileX = startX + (targetLeadX - startX) * progress;
      let missileY = startY + (targetLeadY - startY) * progress;

      if (interceptor.isPkHit === false && progress > 0.85) {
        const missProgress = (progress - 0.85) / 0.15;
        const driftX = Math.sin(interceptor.engagementTime) * 2.5 * missProgress;
        const driftY = Math.cos(interceptor.engagementTime) * 2.5 * missProgress;
        missileX += driftX;
        missileY += driftY;
      }

      const dx = targetLeadX - missileX;
      const dy = targetLeadY - missileY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const visualHeadLength = Math.min(2.0, dist * 0.5); 
      const leadX = dist > 0 ? missileX + (dx / dist) * visualHeadLength : missileX;
      const leadY = dist > 0 ? missileY + (dy / dist) * visualHeadLength : missileY;

      if (tailLineRef.current) {
        tailLineRef.current.style.display = '';
        tailLineRef.current.setAttribute('x2', missileX.toString());
        tailLineRef.current.setAttribute('y2', missileY.toString());
      }
      
      if (pulseLineRef.current) {
        pulseLineRef.current.style.display = '';
        pulseLineRef.current.setAttribute('x1', missileX.toString());
        pulseLineRef.current.setAttribute('y1', missileY.toString());
        pulseLineRef.current.setAttribute('x2', leadX.toString());
        pulseLineRef.current.setAttribute('y2', leadY.toString());
        
        if (interceptor.isPkHit === false && progress > 0.9) {
          pulseLineRef.current.classList.remove('animate-pulse');
          pulseLineRef.current.setAttribute('opacity', '0.3');
        } else {
          pulseLineRef.current.classList.add('animate-pulse');
          pulseLineRef.current.setAttribute('opacity', '1.0');
        }
      }

      if (headCircleRef.current) {
        headCircleRef.current.style.display = '';
        headCircleRef.current.setAttribute('cx', missileX.toString());
        headCircleRef.current.setAttribute('cy', missileY.toString());
        headCircleRef.current.setAttribute('opacity', interceptor.isPkHit === false && progress > 0.95 ? '0.5' : '1.0');
      }

      if (textRef.current && showTti) {
        if (interceptor.isPkHit === false && progress > 0.9) {
           textRef.current.style.display = 'none';
        } else {
           textRef.current.style.display = '';
           textRef.current.setAttribute('x', missileX.toString());
           textRef.current.setAttribute('y', (missileY - (1.2 / cameraZoom)).toString());
           textRef.current.textContent = `TTI: ${Math.ceil(smoothTti)}s`;
        }
      }
    });
  }, [interceptor, track, lastSweepTime, cameraZoom, showTti]);

  return (
    <g>
      <line ref={tailLineRef} x1={interceptor.launchPos.x} y1={interceptor.launchPos.y} x2={interceptor.launchPos.x} y2={interceptor.launchPos.y} stroke={color} strokeWidth={0.1 / cameraZoom} strokeDasharray={`${0.2 / cameraZoom} ${0.4 / cameraZoom}`} opacity="0.4" style={{ display: 'none' }} />
      <line ref={pulseLineRef} x1={interceptor.launchPos.x} y1={interceptor.launchPos.y} x2={interceptor.launchPos.x} y2={interceptor.launchPos.y} stroke={color} strokeWidth={0.2 / cameraZoom} className="animate-pulse" style={{ display: 'none' }} />
      <circle ref={headCircleRef} cx={interceptor.launchPos.x} cy={interceptor.launchPos.y} r={0.3 / cameraZoom} fill={color} style={{ display: 'none' }} />
      {showTti && (
        <text ref={textRef} x={interceptor.launchPos.x} y={interceptor.launchPos.y} fill={color} fontSize={0.7 / cameraZoom} fontFamily="monospace" textAnchor="middle" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000', display: 'none' }}></text>
      )}
    </g>
  );
});

import { useTrackStore } from './store';

const trackSymbolAreEqual = (
  prevProps: { trackId: string, isHooked: boolean, cameraZoom: number },
  nextProps: { trackId: string, isHooked: boolean, cameraZoom: number }
) => {
  if (prevProps.trackId !== nextProps.trackId) return false;
  if (prevProps.isHooked !== nextProps.isHooked) return false;
  if (prevProps.cameraZoom !== nextProps.cameraZoom) return false;
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

const InterpolatedTrackGroup = React.memo(({ track, lastSweepTime, children, ...props }: any) => {
  const gRef = useRef<SVGGElement>(null);
  
  useEffect(() => {
    return nowStore.subscribeTime(() => {
      if (!gRef.current) return;
      const elapsed = (nowStore.now - lastSweepTime) / 1000;
      const rad = track.hdg * (Math.PI / 180);
      const smoothX = track.x + Math.sin(rad) * ((track.spd / 3600) * elapsed);
      const smoothY = track.y - Math.cos(rad) * ((track.spd / 3600) * elapsed);
      gRef.current.setAttribute('transform', `translate(${smoothX}, ${smoothY})`);
    });
  }, [track.x, track.y, track.spd, track.hdg, lastSweepTime]);

  const elapsed = (nowStore.now - lastSweepTime) / 1000;
  const rad = track.hdg * (Math.PI / 180);
  const smoothX = track.x + Math.sin(rad) * ((track.spd / 3600) * elapsed);
  const smoothY = track.y - Math.cos(rad) * ((track.spd / 3600) * elapsed);

  return <g ref={gRef} transform={`translate(${smoothX}, ${smoothY})`} {...props}>{children}</g>;
});

const InterpolatedPairingLine = React.memo(({ interceptor, track, lastSweepTime, color, cameraZoom, isHooked }: any) => {
  const lineRef = useRef<SVGLineElement>(null);
  useEffect(() => {
    return nowStore.subscribeTime(() => {
      if (!lineRef.current) return;
      const age = nowStore.now - interceptor.engagementTime;
      if (age > 1500 && !isHooked) {
         lineRef.current.style.display = 'none';
         return;
      }
      lineRef.current.style.display = '';
      const elapsed = (nowStore.now - lastSweepTime) / 1000;
      const rad = track.hdg * (Math.PI / 180);
      const smoothX = track.x + Math.sin(rad) * ((track.spd / 3600) * elapsed);
      const smoothY = track.y - Math.cos(rad) * ((track.spd / 3600) * elapsed);
      lineRef.current.setAttribute('x2', smoothX.toString());
      lineRef.current.setAttribute('y2', smoothY.toString());
    });
  }, [track.x, track.y, track.spd, track.hdg, lastSweepTime, interceptor.engagementTime, isHooked]);

  return (
    <line 
      ref={lineRef}
      x1={interceptor.launchPos.x} y1={interceptor.launchPos.y}
      x2={track.x} y2={track.y} 
      stroke={color} strokeWidth={0.2 / cameraZoom} strokeDasharray={`${0.5 / cameraZoom} ${0.5 / cameraZoom}`} 
      className="animate-pulse"
      style={{ display: 'none' }}
    />
  );
});

const TrackSymbol = React.memo(({ trackId, isHooked, cameraZoom }: { trackId: string, isHooked: boolean, cameraZoom: number }) => {
  const track = useTrackStore(state => state.tracks[trackId]);
  const lastSweepTime = useTrackStore(state => state.lastSweepTime);
  const currentSimTime = nowStore.now;
  
  if (!track || track.detected === false) return null;

  let color = '#FFFF00'; // Pure Yellow (Pending/Unknown)
  if (track.type === 'FRIEND') color = '#00FF33'; // Tactical Green
  else if (track.type === 'ASSUMED_FRIEND' || track.type === 'NEUTRAL') color = '#00FFFF'; // Cyan
  else if (track.type === 'HOSTILE') color = '#FF0000'; // Pure Red
  else if (track.type === 'SUSPECT') color = '#FF8800'; // Orange

  // Logarithmic velocity vector
  const vectorLength = 2.0 * Math.log10(track.spd / 10 + 1); 
  const rad = track.hdg * (Math.PI / 180);

  return (
    <g className={track.coasting ? 'opacity-50' : 'opacity-100'}>
      {/* Pairing Lines (Shooter to Target) */}
      {track.interceptors && track.interceptors.map((interceptor) => (
        <InterpolatedPairingLine 
          key={`line-${interceptor.id}`}
          interceptor={interceptor} track={track} lastSweepTime={lastSweepTime} 
          color={color} cameraZoom={cameraZoom} isHooked={isHooked}
        />
      ))}

      {/* Missile Vectors & TTI */}
      {track.interceptors && track.interceptors.map((interceptor) => {
        const age = currentSimTime - interceptor.engagementTime;
        const showTti = isHooked || age < 1500;
        return (
          <MissileVector key={`missile-${interceptor.id}`} interceptor={interceptor} track={track} color={color} cameraZoom={cameraZoom} showTti={showTti} />
        );
      })}

      {/* Track History Breadcrumbs (Optimized as single Polyline) */}
      {track.history.length > 1 && (
        <polyline 
          points={track.history.map(pos => `${pos.x},${pos.y}`).join(' ')} 
          fill="none" 
          stroke={color} 
          strokeWidth={0.2 / cameraZoom} 
          opacity="0.4"
          strokeDasharray={`${0.4 / cameraZoom} ${0.4 / cameraZoom}`}
        />
      )}
      
      <InterpolatedTrackGroup 
        track={track} 
        lastSweepTime={lastSweepTime}
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

        {/* NTDS Air Shapes from lookup (Removed expensive CSS drop-shadow) */}
        <g transform={`scale(${0.08 / cameraZoom}) translate(-12, -12)`} stroke={color} strokeWidth="3" fill="none" strokeDasharray={track.coasting ? "4 4" : "none"}>
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
      </InterpolatedTrackGroup>
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
    <aside className="flex-1 bg-[#001A26]/20 lg:backdrop-blur-md border border-[#002B40] flex flex-col min-h-0">
      <div className="bg-[#001A26]/20 px-3 py-2 border-b border-[#002B40] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
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
          <thead className="text-[#004466] sticky top-0 bg-[#00050A]/80 lg:bg-[#00050A]/50 border-b border-[#002B40] lg:backdrop-blur-md">
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
  const isNarrativeLog = (log: SystemLog) => 
    log.message.startsWith('HUNTRESS:') || 
    log.message.startsWith('ATC:') || 
    log.message.startsWith('INTEL:') || 
    log.type === 'WARN' || 
    log.type === 'ALERT';
  
  const huntressLogs = logs.filter(l => isNarrativeLog(l));
  const sysLogs = logs.filter(l => !isNarrativeLog(l));

  return (
    <div className="flex flex-col gap-2 shrink-0">
      {/* HUNTRESS SECURE NET */}
      <aside className="h-36 bg-[#220000]/80 lg:bg-[#220000]/60 lg:backdrop-blur-md border border-[#FF0033]/50 flex flex-col shrink-0 shadow-[0_0_15px_rgba(255,0,51,0.1)]">
        <div className="bg-[#220000] px-3 py-1.5 border-b border-[#FF0033]/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-bold text-[#FFCC00] tracking-widest">HUNTRESS</h2>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5 flex flex-col-reverse custom-scrollbar">
          {huntressLogs.map((log) => (
            <div key={log.id} className={`text-[10px] flex gap-2 ${!log.acknowledged ? 'border border-[#FFCC00]/50 bg-black/40 p-1' : ''}`}>
              <div className="flex flex-col w-4 text-[7px] text-[#FF0033] tabular-nums leading-none shrink-0 border-r border-[#FF0033]/30 pr-1 justify-center items-center font-bold">
                <span>{log.time.substring(0, 2)}</span>
                <span>{log.time.substring(3, 5)}</span>
                <span>{log.time.substring(6, 8)}</span>
              </div>
              <span className={`${
                log.type === 'ALERT' ? 'text-white font-bold' :
                log.type === 'ACTION' ? 'text-[#00E5FF] font-bold' :
                'text-[#FFCC00]'
              }`}>{log.message.replace(/^(HUNTRESS|ATC|INTEL):\s*/, '')}</span>
            </div>
          ))}
          {huntressLogs.length === 0 && (
             <div className="text-[10px] text-[#FFCC00]/50 italic">AWAITING TRANSMISSION...</div>
          )}
        </div>
      </aside>

      {/* SYSTEM EVENT LOG */}
      <aside className="h-48 bg-[#001A26]/80 lg:bg-[#001A26]/20 lg:backdrop-blur-md border border-[#002B40] flex flex-col shrink-0">
        <div className="bg-[#001A26]/20 px-3 py-1 border-b border-[#002B40] flex items-center gap-2 shrink-0">
          <h2 className="text-[10px] font-bold text-[#00E5FF]/70 tracking-widest">ROUTINE LOGS</h2>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 flex flex-col-reverse custom-scrollbar opacity-90 hover:opacity-100 transition-opacity">
          {sysLogs.map((log) => (
            <div key={log.id} className="text-[9px] flex gap-2">
              <div className="flex flex-col w-4 text-[6px] text-[#004466] tabular-nums leading-none shrink-0 border-r border-[#004466]/30 pr-1 justify-center items-center font-bold">
                <span>{log.time.substring(0, 2)}</span>
                <span>{log.time.substring(3, 5)}</span>
                <span>{log.time.substring(6, 8)}</span>
              </div>
              <span className={`${
                log.type === 'ALERT' ? 'text-[#FF3366] font-bold' :
                log.type === 'ACTION' ? 'text-[#00E5FF] font-bold' :
                log.type === 'WARN' ? 'text-[#FFCC00]' :
                'text-[#00E5FF]/70'
              }`}>{log.message}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
});

const LiveEngagementTextGroup = React.memo(({ interceptor }: { interceptor: any }) => {
  const ttiRef = useRef<HTMLDivElement>(null);
  const rngRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return nowStore.subscribeTime(() => {
      const elapsed = nowStore.now - interceptor.engagementTime;
      const progress = Math.min(1, Math.max(0, elapsed / interceptor.interceptDuration));
      const remainingTti = Math.ceil(Math.max(0, (interceptor.engagementTime + interceptor.interceptDuration - nowStore.now) / 1000));
      const closingRng = (interceptor.initialRange || 0) * (1 - progress);
      if (ttiRef.current) ttiRef.current.textContent = `${remainingTti}s`;
      if (rngRef.current) rngRef.current.textContent = `${Math.round(closingRng)}`;
    });
  }, [interceptor]);

  const initRemainingTti = Math.ceil(Math.max(0, (interceptor.engagementTime + interceptor.interceptDuration - nowStore.now) / 1000));
  const initClosingRng = (interceptor.initialRange || 0) * (1 - Math.min(1, Math.max(0, (nowStore.now - interceptor.engagementTime) / interceptor.interceptDuration)));

  return (
    <div className="flex flex-col justify-center items-center flex-1 min-w-0 overflow-hidden">
      <div ref={ttiRef} className="text-[11px] font-bold text-[#00E5FF] leading-none tabular-nums">{initRemainingTti}s</div>
      <div ref={rngRef} className="text-[8px] text-[#00E5FF] opacity-50 tabular-nums leading-none mt-0.5">{Math.round(initClosingRng)}</div>
    </div>
  );
});

const LiveEngagementTextSingle = React.memo(({ interceptor }: { interceptor: any }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return nowStore.subscribeTime(() => {
      const elapsed = nowStore.now - interceptor.engagementTime;
      const progress = Math.min(1, Math.max(0, elapsed / interceptor.interceptDuration));
      const remainingTti = Math.ceil(Math.max(0, (interceptor.engagementTime + interceptor.interceptDuration - nowStore.now) / 1000));
      const closingRng = (interceptor.initialRange || 0) * (1 - progress);
      if (ref.current) ref.current.textContent = `${remainingTti}s / ${closingRng.toFixed(1)} NM`;
    });
  }, [interceptor]);

  const initRemainingTti = Math.ceil(Math.max(0, (interceptor.engagementTime + interceptor.interceptDuration - nowStore.now) / 1000));
  const initClosingRng = (interceptor.initialRange || 0) * (1 - Math.min(1, Math.max(0, (nowStore.now - interceptor.engagementTime) / interceptor.interceptDuration)));

  return (
    <div ref={ref} className="text-right text-[#FF0033] font-bold tabular-nums">
      {initRemainingTti}s / {initClosingRng.toFixed(1)} NM
    </div>
  );
});

const Tote = React.memo(({ hookedTrackIds, masterWarning, vectoringTrackId, setVectoringTrackId, doctrine, setDoctrine, filters, setFilters, wcs, setWcs }: { hookedTrackIds: string[], masterWarning: boolean, vectoringTrackId: string | null, setVectoringTrackId: (id: string | null) => void, doctrine: EngagementDoctrine, setDoctrine: React.Dispatch<React.SetStateAction<EngagementDoctrine>>, filters: any, setFilters: React.Dispatch<React.SetStateAction<any>>, wcs: 'TIGHT' | 'FREE', setWcs: (wcs: 'TIGHT' | 'FREE') => void }) => {
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
    <aside className={`w-full bg-[#001A26]/80 lg:bg-[#001A26]/40 lg:backdrop-blur-xl border ${masterWarning ? 'border-[#FF0033]' : 'border-[#002B40]'} flex flex-col pointer-events-auto transition-all duration-300 h-fit`}>
      <div className={`px-3 py-1.5 border-b ${masterWarning ? 'bg-[#440000]/40 border-[#FF0033]' : 'bg-[#001A26]/40 border-[#002B40]'} flex items-center justify-between shrink-0`}>
        <div className="flex items-center gap-2">
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

                      return (
                        <div key={`group-eng-${t.id}`} className="flex gap-0.5 border border-[#FF0033]/20 bg-[#FF0033]/5 p-0.5 min-w-0">
                          <div className="flex flex-col w-3 text-[7px] text-[#FF0033] font-bold border-r border-[#FF0033]/30 shrink-0 justify-center items-center leading-none">
                            {t.id.split('').map((char, idx) => <span key={idx}>{char}</span>)}
                          </div>
                          <LiveEngagementTextGroup interceptor={i} />
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
                    
                    return (
                      <React.Fragment key={i.id}>
                        <div className="text-[#FF0033] font-bold flex items-center gap-1 uppercase">
                          <div className="w-1 h-1 rounded-full bg-[#FF0033] animate-pulse" />
                          {i.weapon} TTI / RNG
                        </div>
                        <LiveEngagementTextSingle interceptor={i} />
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
                      {isActive ? 'AUTO' : 'MANUAL'}
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
      className={`absolute pointer-events-auto flex flex-col bg-[#00050A]/95 lg:bg-[#00050A]/80 lg:backdrop-blur-md border border-[#004466] shadow-[0_10px_30px_rgba(0,0,0,0.5)] ${className}`}
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
  
  const lineRef = useRef<SVGLineElement>(null);
  const crosshairGroupRef = useRef<SVGGElement>(null);
  
  useEffect(() => {
    if (!track) return;
    return nowStore.subscribeMouse(() => {
      const mouse = nowStore.getMouseSnapshot();
      if (mouse.x === 0 && mouse.y === 0) return;
      if (lineRef.current) {
        lineRef.current.setAttribute('x2', mouse.x.toString());
        lineRef.current.setAttribute('y2', mouse.y.toString());
        lineRef.current.style.display = '';
      }
      if (crosshairGroupRef.current) {
        crosshairGroupRef.current.setAttribute('transform', `translate(${mouse.x}, ${mouse.y})`);
        crosshairGroupRef.current.style.display = '';
      }
    });
  }, [track]);

  if (!track) return null;
  const initialMouse = nowStore.getMouseSnapshot();
  const initX = initialMouse.x || track.x;
  const initY = initialMouse.y || track.y;
  const isHidden = initialMouse.x === 0 && initialMouse.y === 0;

  return (
    <g>
      <line 
        ref={lineRef}
        x1={track.x} y1={track.y} 
        x2={initX} y2={initY} 
        stroke="#00E5FF" 
        strokeWidth={0.2 / cameraZoom} 
        strokeDasharray={`${0.5 / cameraZoom} ${0.5 / cameraZoom}`} 
        className="animate-pulse"
        style={{ display: isHidden ? 'none' : '' }}
      />
      {/* Static Crosshair - No Ping to avoid "errant ghosting" */}
      <g ref={crosshairGroupRef} transform={`translate(${initX}, ${initY})`} style={{ display: isHidden ? 'none' : '' }}>
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
    { id: 'initial-0', time: getZuluTimeStr(-150000), message: 'SYS: BOOT SEQUENCE INITIATED // BUILTBYVIBES.COM', type: 'INFO', acknowledged: true },
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
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [mobileSheetTab, setMobileSheetTab] = useState<'TOTE' | 'LOGS' | 'TRACKS'>('TOTE');
  const [engageMenuOpen, setEngageMenuOpen] = useState(false);
  const [filters, setFilters] = useState({ showUnknowns: true, showFriends: true, showNeutrals: true, showHostiles: true });
  const [visibleSnippetId, setVisibleSnippetId] = useState<string | null>(null);
  const [buttonFeedback, setButtonFeedback] = useState<Record<string, 'action' | 'error'>>({});
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [splashes, setSplashes] = useState<{ id: string, x: number, y: number, time: number }[]>([]);
  const simTimeRef = useRef(0);

  useEffect(() => {
    nowStore.setPaused(!isGameStarted || isPaused);
  }, [isPaused, isGameStarted]);

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
  const [selectionPolygon, setSelectionPolygon] = useState<{ x: number, y: number }[]>([]);
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
    
    if (message.startsWith('HUNTRESS:') || message.startsWith('ATC:') || message.startsWith('INTEL:') || type === 'WARN' || type === 'ALERT') {
      setVisibleSnippetId(logId);
    }
  }, []);

  useEffect(() => {
    if (visibleSnippetId) {
      const timer = setTimeout(() => {
        setVisibleSnippetId(null);
      }, 6000); // Fade out after 6 seconds
      return () => clearTimeout(timer);
    }
  }, [visibleSnippetId]);

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
                  addLog(`${i.shooterId} MISSED TRACK ${t.id} (INTERCEPTOR SELF-DESTRUCT).`, 'INFO');
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

        // 1 & 2 & 3. Progress intercepts, Standard movement, and ROE Processor
        let nextTracks = currentTracks.map(track => {
          // 1. Progress intercepts (Visual countdown only)
          let newInterceptors = track.interceptors;
          if (newInterceptors && newInterceptors.length > 0) {
            newInterceptors = newInterceptors.map(i => ({
              ...i,
              interceptTtl: Math.max(0, i.interceptTtl - actualElapsedSecs)
            })); 
          }

          // 2. Standard movement and physics
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
          
          let updatedTrack = { ...track, x: resX, y: resY, history: newHistory, coasting: track.tq <= 2, detected: isDetected, spd: newSpd, alt: newAlt, hdg: newHdg, targetWaypoint: newTargetWaypoint, fuel: newFuel, interceptors: newInterceptors };

          // 3. ROE Processor (Auto-ID)
          if (updatedTrack.type === 'PENDING' || updatedTrack.type === 'UNKNOWN') {
            if (updatedTrack.category === 'TBM' || updatedTrack.category === 'ROCKET' || updatedTrack.category === 'CM') {
               updatedTrack.type = 'HOSTILE';
               updatedTrack.threatName = getThreatName(updatedTrack.category);
            } else if (updatedTrack.category === 'UAS') {
              updatedTrack.type = 'SUSPECT';
              updatedTrack.threatName = 'UAS';
            }
          }
          // Escalate SUSPECT UAS to HOSTILE if they are within 15NM of any asset
          if (updatedTrack.type === 'SUSPECT' && updatedTrack.category === 'UAS') {
             for (const asset of DEFENDED_ASSETS) {
               if (calculateRange(updatedTrack.x, updatedTrack.y, asset.x, asset.y) < 15) {
                 updatedTrack.type = 'HOSTILE';
                 break;
               }
             }
          }
          
          return updatedTrack;
        });

        // 4. Fighter AI (VID, Targeting, and Auto-Engagement)
        nextTracks = processFighters(nextTracks, events, sweepSimTime);

        // 5, 6, 7. Cleanup RTB, Unified Auto-Engagement, and C-RAM Point Defense
        const doc = doctrineRef.current;
        const currentWcs = wcsRef.current;
        let shotsFiredThisSweep = 0;

        nextTracks = nextTracks.map(t => {
          let updatedTrack = { ...t };
          let changed = false;

          // 5. Cleanup and RTB
          if (updatedTrack.isFighter && !updatedTrack.isRTB) {
            if (updatedTrack.missilesRemaining === 0) {
              events.push({ type: 'LOG', message: `${updatedTrack.id}: Winchester. RTB Al Minhad.`, logType: 'INFO' });
              updatedTrack.isRTB = true;
              updatedTrack.targetWaypoint = { x: 57.5, y: 62.5 };
              changed = true;
            } else if (updatedTrack.fuel !== undefined && updatedTrack.maxFuel !== undefined && updatedTrack.fuel < (updatedTrack.maxFuel * 0.25)) {
              events.push({ type: 'LOG', message: `${updatedTrack.id}: Bingo fuel. RTB Al Minhad.`, logType: 'INFO' });
              updatedTrack.isRTB = true;
              updatedTrack.targetWaypoint = { x: 57.5, y: 62.5 };
              changed = true;
            }
          }

          // 6. Unified Auto-Engagement Doctrine (THAAD / PAC-3 / TAMIR)
          const isHostile = updatedTrack.type === 'HOSTILE';
          const isSuspect = updatedTrack.type === 'SUSPECT';
          const isEngageable = isHostile || (currentWcs === 'FREE' && isSuspect);
          
          if (isEngageable) {
            const existingInterceptors = updatedTrack.interceptors ? updatedTrack.interceptors.filter(i => i.shooterId === 'BATTERY').length : 0;
            let weaponToUse: 'THAAD' | 'PAC-3' | 'TAMIR' | null = null;
            let maxSalvo = 1;

            if (updatedTrack.category === 'TBM' && doc.autoEngageTBM) {
              const rng = calculateRange(updatedTrack.x, updatedTrack.y, BATTERY_POS.x, BATTERY_POS.y, updatedTrack.alt, 0);
              if (rng > 40 && rng <= 100 && inventoryRef.current.thaad > 0) { weaponToUse = 'THAAD'; maxSalvo = 1; }
              else if (rng <= 40 && inventoryRef.current.pac3 > 0) { weaponToUse = 'PAC-3'; maxSalvo = 1; }
            } else if (updatedTrack.category === 'CM' && doc.autoEngageCM) {
              if (inventoryRef.current.pac3 > 0) { weaponToUse = 'PAC-3'; maxSalvo = 1; }
              else if (inventoryRef.current.tamir > 0) { weaponToUse = 'TAMIR'; maxSalvo = 2; }
            } else if (updatedTrack.category === 'ROCKET' && doc.autoEngageRocket) {
              if (inventoryRef.current.tamir > 0) { weaponToUse = 'TAMIR'; maxSalvo = 2; }
            } else if (updatedTrack.category === 'UAS' && doc.autoEngageUAS) {
              if (inventoryRef.current.tamir > 0) { weaponToUse = 'TAMIR'; maxSalvo = 2; }
            }

            if (weaponToUse && existingInterceptors < maxSalvo) {
              const stats = WEAPON_STATS[weaponToUse];
              const rng = calculateRange(updatedTrack.x, updatedTrack.y, BATTERY_POS.x, BATTERY_POS.y, updatedTrack.alt, 0);
              
              if (rng <= stats.range) {
                const missileSpdNmSec = stats.speedMach * MACH_TO_NM_SEC;
                const closureRate = calculateClosureRate(BATTERY_POS, updatedTrack, missileSpdNmSec);
                const shotDelayMs = (shotsFiredThisSweep * 250);
                shotsFiredThisSweep++;
                const interceptTimeSecs = (rng / Math.max(0.1, closureRate)) + (shotDelayMs / 1000);
                const isPkHit = Math.random() <= stats.pk;

                const newInterceptor = {
                  id: `${weaponToUse}-AUTO-${sweepSimTime}-${Math.random()}`,
                  weapon: weaponToUse,
                  shooterId: 'BATTERY',
                  launchPos: { x: BATTERY_POS.x, y: BATTERY_POS.y },
                  engagementTime: sweepSimTime + shotDelayMs,
                  interceptDuration: interceptTimeSecs * 1000,
                  interceptTtl: Math.ceil(interceptTimeSecs),
                  initialRange: rng,
                  isPkHit
                };

                const invKey = weaponToUse.toLowerCase().replace('-3', '3') as keyof typeof inventory;
                inventoryRef.current[invKey]--;
                incrementInterceptorsFired(weaponToUse);
                events.push({ type: 'LOG', message: `AUTO-ENGAGE TRK ${updatedTrack.id} (${weaponToUse})`, logType: 'ACTION' });
                events.push({ type: 'COST', amount: stats.cost });

                updatedTrack.interceptors = [...(updatedTrack.interceptors || []), newInterceptor];
                changed = true;
              }
            }
            
            // 7. Terminal Point Defense (C-RAM / Laser CIWS)
            if (updatedTrack.type === 'HOSTILE' && updatedTrack.category !== 'TBM' && (!updatedTrack.interceptors || !updatedTrack.interceptors.some(i => i.shooterId.startsWith('C-RAM')))) {
              for (const asset of DEFENDED_ASSETS) {
                if (!asset.hasCram) continue;
                const rngToAsset = calculateRange(updatedTrack.x, updatedTrack.y, asset.x, asset.y, updatedTrack.alt, 0);
                if (rngToAsset <= 2.5) {
                  incrementInterceptorsFired('C-RAM');
                                    events.push({ type: 'LOG', message: `C-RAM (${asset.id}) ENGAGING LEAKER TRK ${updatedTrack.id}`, logType: 'ACTION' });                  events.push({ type: 'COST', amount: WEAPON_STATS['C-RAM'].cost });
                  
                  const closureRate = calculateClosureRate({x: asset.x, y: asset.y, alt: 0}, updatedTrack, WEAPON_STATS['C-RAM'].speedMach * MACH_TO_NM_SEC);
                  const interceptTimeSecs = rngToAsset / Math.max(0.1, closureRate);
                  const isPkHit = Math.random() <= WEAPON_STATS['C-RAM'].pk;

                  const newInterceptor = {
                    id: `CRAM-${sweepSimTime}-${Math.random()}`, weapon: 'C-RAM' as const, shooterId: `C-RAM (${asset.id})`,
                    launchPos: { x: asset.x, y: asset.y }, engagementTime: sweepSimTime, interceptDuration: interceptTimeSecs * 1000,
                    interceptTtl: Math.ceil(interceptTimeSecs), isPkHit
                  };
                  updatedTrack.interceptors = [...(updatedTrack.interceptors || []), newInterceptor];
                  changed = true;
                  break; // only one C-RAM engagement per sweep per track needed
                }
              }
            }
          }

          return changed ? updatedTrack : t;
        });

        // Sync inventory back to state
        setInventory({ ...inventoryRef.current });

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
  const activePointers = useRef<Map<number, { clientX: number, clientY: number }>>(new Map());
  const lastPinchDistance = useRef<number | null>(null);
  const hasDragged = useRef(false);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const velocityRef = useRef<{ vx: number, vy: number, lastTime: number, lastX: number, lastY: number }>({ vx: 0, vy: 0, lastTime: 0, lastX: 0, lastY: 0 });
  const inertiaRafRef = useRef<number | null>(null);

  const getMapCoords = useCallback((e: React.PointerEvent | PointerEvent | { clientX: number, clientY: number }, container: HTMLDivElement | SVGSVGElement | Element) => {
    const svg = container instanceof SVGSVGElement ? container : container.querySelector('svg');
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgP = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: svgP ? svgP.x : 0, y: svgP ? svgP.y : 0 };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    hasDragged.current = false;
    
    // Stop any existing inertia
    if (inertiaRafRef.current) {
      cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
    
    velocityRef.current = { vx: 0, vy: 0, lastTime: performance.now(), lastX: e.clientX, lastY: e.clientY };

    const coords = getMapCoords(e, e.currentTarget);

    if (vectoringTrackId) {
      setTracks(current => current.map(t => 
        t.id === vectoringTrackId ? { ...t, targetWaypoint: { x: coords.x, y: coords.y }, patrolWaypoint: { x: coords.x, y: coords.y } } : t
      ));
      addLog(`VECTOR COMMAND ISSUED TO ${vectoringTrackId}`, 'ACTION');
      setVectoringTrackId(null);
      return;
    }

    if (activePointers.current.size === 1) {
      if (e.shiftKey) {
        setIsSelecting(true);
        setSelectionPolygon([{ x: coords.x, y: coords.y }]);
      } else {
        // Start long press timer for lasso
        longPressTimer.current = setTimeout(() => {
          if (!hasDragged.current && activePointers.current.size === 1) {
            setIsSelecting(true);
            setIsDragging(false);
            setSelectionPolygon([{ x: coords.x, y: coords.y }]);
            // Optional: provide haptic feedback if supported by browser
            if (navigator.vibrate) navigator.vibrate(50);
          }
        }, 400);

        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setFollowedTrackId(null);
      }
    } else if (activePointers.current.size === 2) {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      setIsDragging(false);
      setIsSelecting(false);
      setSelectionPolygon([]);
      
      const pointers = Array.from(activePointers.current.values());
      const dist = Math.hypot(pointers[0].clientX - pointers[1].clientX, pointers[0].clientY - pointers[1].clientY);
      lastPinchDistance.current = dist;
      setFollowedTrackId(null);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
    }

    const coords = getMapCoords(e, e.currentTarget);
    nowStore.updateMouse(coords.x, coords.y);

    if (draggingWaypointId && activePointers.current.size === 1) {
      setTracks(current => current.map(t => 
        t.id === draggingWaypointId ? { ...t, targetWaypoint: coords, patrolWaypoint: coords } : t
      ));
      return;
    }

    if (isSelecting && activePointers.current.size === 1) {
      const coords = getMapCoords(e, e.currentTarget);
      // Only add point if it's far enough away from the last one to prevent enormous arrays
      setSelectionPolygon(prev => {
        const last = prev[prev.length - 1];
        if (!last) return [{x: coords.x, y: coords.y}];
        const dist = Math.hypot(last.x - coords.x, last.y - coords.y);
        if (dist > 0.5) { // Minimum map distance delta before adding a new vertex
           return [...prev, {x: coords.x, y: coords.y}];
        }
        return prev;
      });
      return;
    }

    if (isDragging && activePointers.current.size === 1) {
      const rect = e.currentTarget.getBoundingClientRect();
      const viewBoxWidth = 100 / camera.zoom;
      const viewBoxHeight = 100 / camera.zoom;
      const scale = Math.max(viewBoxWidth / rect.width, viewBoxHeight / rect.height);
      
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;

      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        hasDragged.current = true;
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
      }
      
      // Calculate velocity
      const now = performance.now();
      const dt = now - velocityRef.current.lastTime;
      if (dt > 0) {
        velocityRef.current.vx = (e.clientX - velocityRef.current.lastX) / dt;
        velocityRef.current.vy = (e.clientY - velocityRef.current.lastY) / dt;
      }
      velocityRef.current.lastTime = now;
      velocityRef.current.lastX = e.clientX;
      velocityRef.current.lastY = e.clientY;

      setCamera(prev => {
        let newX = prev.x - dx * scale;
        let newY = prev.y - dy * scale;
        
        // Soft bounds checking
        newX = Math.max(-50, Math.min(150, newX));
        newY = Math.max(-50, Math.min(150, newY));

        return { ...prev, x: newX, y: newY };
      });
      setDragStart({ x: e.clientX, y: e.clientY });
    } else if (activePointers.current.size === 2) {
      const pointers = Array.from(activePointers.current.values());
      const currentDist = Math.hypot(pointers[0].clientX - pointers[1].clientX, pointers[0].clientY - pointers[1].clientY);
      
      if (lastPinchDistance.current !== null) {
        const delta = currentDist - lastPinchDistance.current;
        const zoomDelta = delta * 0.005;
        
        setCamera(prev => {
          const newZoom = Math.min(10, Math.max(0.5, prev.zoom + zoomDelta));
          return { ...prev, zoom: newZoom };
        });
      }
      
      lastPinchDistance.current = currentDist;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    if (longPressTimer.current) clearTimeout(longPressTimer.current);

    if (activePointers.current.size < 2) {
      lastPinchDistance.current = null;
    }

    if (activePointers.current.size === 1) {
      const remainingPointer = Array.from(activePointers.current.values())[0];
      setDragStart({ x: remainingPointer.clientX, y: remainingPointer.clientY });
    }

    if (draggingWaypointId) {
      setDraggingWaypointId(null);
      return;
    }

    if (isSelecting && selectionPolygon.length > 0) {
      const lastSweepTime = useTrackStore.getState().lastSweepTime;
      const elapsed = (nowStore.now - lastSweepTime) / 1000;

      // Ray-casting algorithm to determine if a point is inside a polygon
      const isPointInPolygon = (x: number, y: number, polygon: {x: number, y: number}[]) => {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
          const xi = polygon[i].x, yi = polygon[i].y;
          const xj = polygon[j].x, yj = polygon[j].y;
          
          const intersect = ((yi > y) !== (yj > y))
              && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      };

      const inLasso = useTrackStore.getState().getAllTracks()
        .filter(t => t.detected !== false)
        .filter(t => {
          const smoothX = t.x + Math.sin(t.hdg * Math.PI / 180) * ((t.spd / 3600) * elapsed);
          const smoothY = t.y - Math.cos(t.hdg * Math.PI / 180) * ((t.spd / 3600) * elapsed);
          return isPointInPolygon(smoothX, smoothY, selectionPolygon);
        })
        .map(t => t.id);

      if (inLasso.length > 0) {
        // If they drew a polygon with only 1 point (a tap), don't treat it as a group hook
        if (selectionPolygon.length > 2) {
            setHookedTrackIds(prev => e.shiftKey ? Array.from(new Set([...prev, ...inLasso])) : inLasso);
            addLog(`GROUP HOOK: ${inLasso.length} TRACKS SELECTED`, 'INFO');
        }
      } else if (!e.shiftKey && selectionPolygon.length > 2) {
        setHookedTrackIds([]);
      }
    } 
    
    // Only fire single tap selection if they didn't drag AND they didn't draw a multi-point lasso
    // (A tap often registers as a 1 or 2 point polygon due to minor finger roll)
    if (!hasDragged.current && activePointers.current.size === 0 && (!isSelecting || selectionPolygon.length <= 3)) {
      // Handle single tap selection
      const coords = getMapCoords(e, e.currentTarget);
      const lastSweepTime = useTrackStore.getState().lastSweepTime;
      const elapsed = (nowStore.now - lastSweepTime) / 1000;
      // Drastically increase hit target for single taps to make it forgiving
      const CLICK_RADIUS = Math.max(3.5, 6000 / (window.innerWidth * camera.zoom));

      const nearbyTracks = useTrackStore.getState().getAllTracks()
        .filter(t => t.detected !== false)
        .filter(t => {
          const smoothX = t.x + Math.sin(t.hdg * Math.PI / 180) * ((t.spd / 3600) * elapsed);
          const smoothY = t.y - Math.cos(t.hdg * Math.PI / 180) * ((t.spd / 3600) * elapsed);
          return calculateRange(smoothX, smoothY, coords.x, coords.y) <= CLICK_RADIUS;
        });

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
        setHookedTrackIds([]);
      }
    }

    if (activePointers.current.size === 0) {
      if (isDragging && hasDragged.current) {
        // Apply Inertia
        const now = performance.now();
        const dt = now - velocityRef.current.lastTime;
        
        // Only apply inertia if the last movement was very recent (a flick, not a stop-then-release)
        if (dt < 100) {
          const startVelocityX = velocityRef.current.vx;
          const startVelocityY = velocityRef.current.vy;
          const speed = Math.hypot(startVelocityX, startVelocityY);
          
          if (speed > 0.5) { // Minimum flick speed threshold
            const viewBoxWidth = 100 / camera.zoom;
            const viewBoxHeight = 100 / camera.zoom;
            // Need to pass in the current container rect, but we can't easily get it here.
            // We'll estimate scale based on window size for the inertia.
            const scale = Math.max(viewBoxWidth / window.innerWidth, viewBoxHeight / window.innerHeight);

            let currentVx = startVelocityX * scale;
            let currentVy = startVelocityY * scale;
            let lastFrameTime = performance.now();

            const applyInertia = () => {
              const currentFrameTime = performance.now();
              const frameDt = currentFrameTime - lastFrameTime;
              lastFrameTime = currentFrameTime;

              setCamera(prev => {
                let newX = prev.x - currentVx * frameDt;
                let newY = prev.y - currentVy * frameDt;

                // Soft bounds checking
                newX = Math.max(-50, Math.min(150, newX));
                newY = Math.max(-50, Math.min(150, newY));

                return { ...prev, x: newX, y: newY };
              });

              // Friction multiplier (e.g., 0.95 means it keeps 95% of its speed each frame)
              currentVx *= 0.92;
              currentVy *= 0.92;

              if (Math.abs(currentVx) > 0.001 || Math.abs(currentVy) > 0.001) {
                inertiaRafRef.current = requestAnimationFrame(applyInertia);
              } else {
                inertiaRafRef.current = null;
              }
            };
            inertiaRafRef.current = requestAnimationFrame(applyInertia);
          }
        }
      }

      setIsDragging(false);
      setIsSelecting(false);
      setSelectionPolygon([]);
    }
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
    <div 
      className="h-screen w-screen bg-[#00050A] text-[#00E5FF] font-mono flex flex-col overflow-hidden select-none selection:bg-[#004466] relative tabular-nums [font-variant-numeric:slashed-zero]"
      onContextMenu={(e) => e.preventDefault()}
    >
      {!isGameStarted && <BriefingModal onStart={() => setIsGameStarted(true)} />}
      {isGameOver && <AfterActionReport />}
      
      {isPaused && !isGameOver && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center justify-center pointer-events-none drop-shadow-[0_0_15px_rgba(0,0,0,1)]">
          <div className="bg-[#FFCC00] text-[#00050A] px-6 py-2 border-2 border-[#FFCC00] font-bold tracking-[0.5em] animate-pulse">
            TACTICAL PAUSE
          </div>
          <div className="bg-[#00050A]/95 lg:bg-[#00050A]/90 text-[#FFCC00] px-4 py-1 text-[10px] tracking-widest border-b border-x border-[#FFCC00]/50 lg:backdrop-blur-md">
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
        onPointerCancel={handlePointerUp}
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
              <circle r={0.8 / camera.zoom} fill="none" stroke="#FF0033" strokeWidth={0.2 / camera.zoom} className="animate-ping" style={{ animationIterationCount: 1, animationFillMode: 'forwards' }} />
              <line x1={-0.4 / camera.zoom} y1={-0.4 / camera.zoom} x2={0.4 / camera.zoom} y2={0.4 / camera.zoom} stroke="#FF0033" strokeWidth={0.2 / camera.zoom} />
              <line x1={0.4 / camera.zoom} y1={-0.4 / camera.zoom} x2={-0.4 / camera.zoom} y2={0.4 / camera.zoom} stroke="#FF0033" strokeWidth={0.2 / camera.zoom} />
            </g>
          ))}

                    {trackIds.map(trackId => {
                                            const track = useTrackStore.getState().tracks[trackId];
                                            if (!track) return null;
                      
                                            // Filter visibility check (moved out of TrackSymbol to prevent re-renders)
                                            const isVisible = (
                                              (filters.showUnknowns || (track.type !== 'UNKNOWN' && track.type !== 'PENDING')) &&
                                              (filters.showFriends || track.type !== 'FRIEND') &&
                                              (filters.showNeutrals || (track.type !== 'NEUTRAL' && track.type !== 'ASSUMED_FRIEND')) &&
                                              (filters.showHostiles || (track.type !== 'HOSTILE' && track.type !== 'SUSPECT'))
                                            );
                      
                                            if (!isVisible && !hookedTrackIds.includes(trackId)) return null;
                      
                      // Viewport Culling
                      const viewBoxWidth = 100 / camera.zoom;
                      const viewBoxHeight = 100 / camera.zoom;
                      const left = camera.x - viewBoxWidth / 2 - 10; // 10 NM padding
                      const right = camera.x + viewBoxWidth / 2 + 10;
                      const top = camera.y - viewBoxHeight / 2 - 10;
                      const bottom = camera.y + viewBoxHeight / 2 + 10;
                      
                      // Very fast rough bounds check
                      if (track.x < left || track.x > right || track.y < top || track.y > bottom) {
                        // Check if it's hooked. We ALWAYS render hooked tracks so their UI doesn't break,
                        // and we always render fighters so their waypoints work correctly.
                        if (!hookedTrackIds.includes(trackId) && !track.isFighter) {
                           // Is it being shot at? If a missile is flying to it, we should render it 
                           // just in case the missile vector starts on-screen.
                           const hasActiveInterceptors = track.interceptors && track.interceptors.length > 0;
                           if (!hasActiveInterceptors) {
                             return null; 
                           }
                        }
                      }

                      return (
                        <TrackSymbol 
                          key={`track-group-${trackId}`} 
                          trackId={trackId} 
                          isHooked={hookedTrackIds.includes(trackId)} 
                          cameraZoom={camera.zoom} 
                        />
                      );
                    })}
          {/* Render Lasso Selection Polygon */}
          {selectionPolygon.length > 1 && (
            <polygon
              points={selectionPolygon.map(p => `${p.x},${p.y}`).join(' ')}
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
                  <header className={`fixed top-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-top))] pt-[env(safe-area-inset-top)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] bg-[#00050A]/90 lg:bg-[#00050A]/70 lg:backdrop-blur-md border-b ${masterWarning ? 'border-[#FF0033] bg-[#220000]/90 lg:bg-[#220000]/70' : 'border-[#002B40]'} flex items-center gap-4 z-50 rounded-none transition-colors duration-300 shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]`}>
                    <div className="flex items-center gap-4 lg:gap-6 shrink-0">
                      <div className="flex items-center gap-2 whitespace-nowrap" title="Joint Integrated Air and Missile Defense">
                        <span className={`text-sm font-bold tracking-widest ${masterWarning ? 'text-[#FF0033] animate-pulse' : 'text-[#00E5FF]'}`}>
                          {masterWarning ? 'ALARM: ENGAGEMENT CRITERIA MET' : 'JIAMD'}
                        </span>
                      </div>
                      <div className="flex items-center gap-x-4 text-[10px] lg:text-xs font-bold tracking-wider border-l border-[#002B40] pl-4 lg:pl-6 shrink-0">
                        <span className="text-[#FFCC00] whitespace-nowrap" title="Weapons Control Status: TIGHT (Fire only at hostiles) / FREE (Fire at any non-friendly)">WCS: <span className={wcs === 'FREE' ? 'text-[#FF0033] animate-pulse' : 'text-[#00E5FF]'}>{wcs}</span></span>
                        <div className="hidden lg:block w-px h-4 bg-[#002B40] mx-1 shrink-0" />
                        <span className="text-[#00FF33] whitespace-nowrap" title="Terminal High Altitude Area Defense (Anti-Ballistic)">THAAD: <span className="text-[#00E5FF] tabular-nums">{inventory.thaad}/8</span></span>
                        <span className="text-[#00FF33] whitespace-nowrap" title="Patriot Advanced Capability-3 MSE (Hit-to-Kill Interceptor)">PAC-3: <span className="text-[#00E5FF] tabular-nums">{inventory.pac3}/32</span></span>
                        <span className="text-[#00FF33] whitespace-nowrap" title="Iron Dome Interceptor (Counter-Rocket/UAS)">TAMIR: <span className="text-[#00E5FF] tabular-nums">{inventory.tamir}/120</span></span>
                        <span className="text-[#00FF33] whitespace-nowrap" title="Counter Rocket, Artillery, and Mortar (Terminal Auto-Defense)">C-RAM: <span className="text-[#00E5FF]">RDY</span></span>
                      </div>
                    </div>
              <div className="flex items-center gap-4 lg:gap-6 text-[10px] lg:text-xs font-bold whitespace-nowrap shrink-0 ml-auto">
                {unackAlerts.length > 0 && (
                  <div className="bg-[#FF0033] text-[#00050A] px-2 py-1 animate-pulse border border-[#FF0033]">
                    {unackAlerts.length} UNACK ALERTS
                  </div>
                )}
                <SystemClock />
              </div>
            </header>
      
            {/* --- MAIN CONTENT AREA --- */}
            <main className="fixed inset-0 top-[calc(4rem+env(safe-area-inset-top))] bottom-[calc(4rem+env(safe-area-inset-bottom))] left-[env(safe-area-inset-left)] right-[env(safe-area-inset-right)] z-20 pointer-events-none overflow-hidden">
              
              {/* LEFT DRAGGABLE WINDOW */}
              <DraggableWindow 
                title="TRACK SUMMARY & LOGS" 
                defaultPos={{ x: 16, y: 16 }} 
                className="w-[280px] max-h-[calc(100vh-160px)] hidden lg:flex flex-col"
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
                className="w-[260px] max-h-[calc(100vh-160px)] hidden lg:flex flex-col"
              >
                <Tote hookedTrackIds={hookedTrackIds} masterWarning={masterWarning} vectoringTrackId={vectoringTrackId} setVectoringTrackId={setVectoringTrackId} doctrine={doctrine} setDoctrine={setDoctrine} filters={filters} setFilters={setFilters} wcs={wcs} setWcs={setWcs} />
              </DraggableWindow>

              {/* MOBILE UNIFIED BOTTOM SHEET */}
              <div className={`fixed lg:hidden bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-0 bg-[#00050A]/95 border-t border-[#00E5FF] shadow-[0_-5px_20px_rgba(0,229,255,0.1)] transition-transform duration-300 z-[60] flex flex-col pointer-events-auto ${mobileSheetOpen ? 'translate-y-0 h-[60vh]' : 'translate-y-full h-[60vh]'}`}>
                {/* Pull Handle */}
                <div 
                  className="absolute -top-8 left-1/2 -translate-x-1/2 w-24 h-8 bg-[#00050A]/95 border-t border-x border-[#00E5FF] rounded-t-lg flex items-center justify-center cursor-pointer pointer-events-auto"
                  onClick={() => setMobileSheetOpen(!mobileSheetOpen)}
                >
                  <div className="w-12 h-1 bg-[#00E5FF]/50 rounded-full" />
                </div>
                
                {/* Tabs */}
                <div className="flex border-b border-[#002B40] shrink-0">
                  <button 
                    className={`flex-1 py-3 text-xs font-bold tracking-widest ${mobileSheetTab === 'TOTE' ? 'bg-[#002B40] text-[#00E5FF] border-b-2 border-[#00E5FF]' : 'text-[#00E5FF]/50'}`}
                    onClick={() => setMobileSheetTab('TOTE')}
                  >
                    TOTE
                  </button>
                  <button 
                    className={`flex-1 py-3 text-xs font-bold tracking-widest ${mobileSheetTab === 'TRACKS' ? 'bg-[#002B40] text-[#00E5FF] border-b-2 border-[#00E5FF]' : 'text-[#00E5FF]/50'}`}
                    onClick={() => setMobileSheetTab('TRACKS')}
                  >
                    TRACKS
                  </button>
                  <button 
                    className={`flex-1 py-3 text-xs font-bold tracking-widest relative ${mobileSheetTab === 'LOGS' ? 'bg-[#002B40] text-[#00E5FF] border-b-2 border-[#00E5FF]' : 'text-[#00E5FF]/50'}`}
                    onClick={() => setMobileSheetTab('LOGS')}
                  >
                    LOGS
                    {unackAlerts.length > 0 && (
                      <span className="absolute top-2 right-4 w-2 h-2 rounded-full bg-[#FF0033] animate-pulse" />
                    )}
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                  {mobileSheetTab === 'TOTE' && (
                    <Tote hookedTrackIds={hookedTrackIds} masterWarning={masterWarning} vectoringTrackId={vectoringTrackId} setVectoringTrackId={setVectoringTrackId} doctrine={doctrine} setDoctrine={setDoctrine} filters={filters} setFilters={setFilters} wcs={wcs} setWcs={setWcs} />
                  )}
                  {mobileSheetTab === 'TRACKS' && (
                    <TrackSummaryTable hookedTrackIds={hookedTrackIds} setHookedTrackIds={setHookedTrackIds} filters={filters} setFilters={setFilters} />
                  )}
                  {mobileSheetTab === 'LOGS' && (
                    <SystemEventLog logs={logs} />
                  )}
                </div>
              </div>
              
            </main>
      
            {/* --- BOTTOM SOFT KEY BAR --- */}

            {/* Mobile Huntress Snippet */}
            {!mobileSheetOpen && (
              <div className="fixed lg:hidden bottom-[calc(4rem+env(safe-area-inset-bottom))] left-0 right-[calc(50vw+3rem)] pointer-events-none z-40 p-2 pl-[max(0.5rem,env(safe-area-inset-left))] pb-4 flex flex-col justify-end overflow-hidden">
                {logs.filter(l => l.message.startsWith('HUNTRESS:') || l.message.startsWith('ATC:') || l.message.startsWith('INTEL:') || l.type === 'WARN' || l.type === 'ALERT').slice(0, 1).map(log => (
                  <div 
                    key={`snippet-${log.id}`} 
                    className={`pointer-events-auto cursor-pointer bg-gradient-to-r from-[#220000]/90 to-transparent p-2 transition-all duration-1000 transform ${visibleSnippetId === log.id ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'}`} 
                    onClick={() => { setMobileSheetTab('LOGS'); setMobileSheetOpen(true); }}
                  >
                    <div className="text-[#FFCC00] text-[8px] font-bold tracking-widest mb-0.5">HUNTRESS</div>
                    <div className={`text-[9px] line-clamp-3 leading-tight pr-4 ${log.type === 'ALERT' ? 'text-white font-bold' : log.type === 'ACTION' ? 'text-[#00E5FF] font-bold' : 'text-[#FFCC00]'}`}>
                      {log.message.replace(/^(HUNTRESS|ATC|INTEL):\s*/, '')}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Mobile Selected Track Snippet */}
            {!mobileSheetOpen && hookedTrackIds.length > 0 && (
              <div 
                className="fixed lg:hidden bottom-[calc(4rem+env(safe-area-inset-bottom))] right-0 left-[calc(50vw+3rem)] bg-gradient-to-l from-[#001A26]/90 to-transparent pointer-events-auto cursor-pointer z-40 p-2 pr-[max(0.5rem,env(safe-area-inset-right))] pb-4 flex flex-col justify-end text-right overflow-hidden"
                onClick={() => { setMobileSheetTab('TOTE'); setMobileSheetOpen(true); }}
              >
                {(() => {
                  const tracksMap = useTrackStore.getState().tracks;
                  const hookedTracks = hookedTrackIds.map(id => tracksMap[id]).filter(Boolean);
                  if (hookedTracks.length === 0) return null;
                  
                  if (hookedTracks.length > 1) {
                     return (
                       <div className="p-2">
                         <div className="text-[#00E5FF] text-[8px] font-bold tracking-widest mb-0.5">HOOKED GROUP</div>
                         <div className="text-[9px] font-bold text-white">{hookedTracks.length} TRACKS SELECTED</div>
                       </div>
                     );
                  }
                  
                  const t = hookedTracks[0];
                  let color = '#FFFF00';
                  if (t.type === 'FRIEND') color = '#00FF33';
                  else if (t.type === 'ASSUMED_FRIEND' || t.type === 'NEUTRAL') color = '#00FFFF';
                  else if (t.type === 'HOSTILE') color = '#FF0033';
                  else if (t.type === 'SUSPECT') color = '#FF8800';

                  return (
                    <div className="p-2">
                      <div className="text-[8px] font-bold tracking-widest mb-0.5" style={{ color }}>{t.type}</div>
                      <div className="text-[9px] font-bold text-white line-clamp-1">{t.threatName || t.id}</div>
                      <div className="text-[9px] text-[#00E5FF]/80 line-clamp-1">{t.alt >= 18000 ? `FL${Math.round(t.alt/100)}` : `${Math.round(t.alt)} FT`} / {Math.round(t.spd)} KTS</div>
                    </div>
                  );
                })()}
              </div>
            )}
            
            <footer className="fixed bottom-0 left-0 right-0 h-[calc(4rem+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] bg-[#00050A]/95 border-t border-[#002B40] flex items-center gap-1 lg:gap-2 z-50 shrink-0 pointer-events-auto overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
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

        <div className="hidden lg:flex w-px h-8 bg-[#002B40] mx-1 lg:mx-2 shrink-0" />

        {/* Mobile Unified Engage Button */}
        <div className="relative lg:hidden ml-auto">
          <button 
            className={`h-10 px-4 border hover:bg-[#440000] text-[#FF0033] text-[10px] font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap ${
              engageMenuOpen ? 'bg-[#660000] border-[#FF0033] brightness-150 scale-[0.98]' : 'bg-[#330000] border-[#FF0033]'
            }`}
            disabled={hookedTrackIds.length === 0}
            onClick={() => setEngageMenuOpen(!engageMenuOpen)}
          >
            ENGAGE ▼
          </button>
          
          {engageMenuOpen && (
            <div className="absolute bottom-full mb-2 right-0 flex flex-col gap-2 bg-[#00050A]/95 p-2 border border-[#FF0033] shadow-[0_0_15px_rgba(255,0,51,0.2)]">
              <button className="h-10 px-4 border border-[#FF00FF] bg-[#330033] text-[#FF00FF] text-[10px] font-bold tracking-widest whitespace-nowrap" onClick={() => { handleEngage('THAAD'); setEngageMenuOpen(false); }}>THAAD</button>
              <button className="h-10 px-4 border border-[#FF0033] bg-[#330000] text-[#FF0033] text-[10px] font-bold tracking-widest whitespace-nowrap" onClick={() => { handleEngage('PAC-3'); setEngageMenuOpen(false); }}>PAC-3</button>
              <button className="h-10 px-4 border border-[#FFCC00] bg-[#222200] text-[#FFCC00] text-[10px] font-bold tracking-widest whitespace-nowrap" onClick={() => { handleEngage('TAMIR'); setEngageMenuOpen(false); }}>TAMIR</button>
            </div>
          )}
        </div>

        {/* Desktop Individual Engage Buttons */}
        <button 
          className={`hidden lg:flex h-10 px-2 lg:px-4 border hover:bg-[#440033] text-[#FF00FF] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-col items-center justify-center ml-auto whitespace-nowrap ${
            buttonFeedback['4'] === 'action' ? 'bg-[#660066] border-[#FF00FF] brightness-150 scale-[0.98]' : 'bg-[#330033] border-[#FF00FF]'
          }`}
          disabled={hookedTrackIds.length === 0}
          onClick={() => { triggerKeyFeedback('4', 'action'); handleEngage('THAAD'); }}
        >
          <span className="text-[8px] text-[#FF00FF] opacity-50 mb-0.5">4</span>
          ENGAGE THAAD
        </button>

        <button 
          className={`hidden lg:flex h-10 px-2 lg:px-4 border hover:bg-[#440000] text-[#FF0033] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-col items-center justify-center whitespace-nowrap ${
            buttonFeedback['5'] === 'action' ? 'bg-[#660000] border-[#FF0033] brightness-150 scale-[0.98]' : 'bg-[#330000] border-[#FF0033]'
          }`}
          disabled={hookedTrackIds.length === 0}
          onClick={() => { triggerKeyFeedback('5', 'action'); handleEngage('PAC-3'); }}
        >
          <span className="text-[8px] text-[#FF0033] opacity-50 mb-0.5">5</span>
          ENGAGE PAC-3
        </button>

        <button 
          className={`hidden lg:flex h-10 px-2 lg:px-4 border hover:bg-[#333300] text-[#FFCC00] text-[10px] lg:text-xs font-bold tracking-widest transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-col items-center justify-center whitespace-nowrap ${
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

      {/* CRT Overlay (Hidden on mobile for performance) */}
      <div className="hidden lg:block fixed inset-0 pointer-events-none z-50 mix-blend-overlay opacity-20 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_4px,3px_100%]" />
    </div>
  );
}
