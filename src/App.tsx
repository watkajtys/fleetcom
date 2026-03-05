/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Track, TrackType, SystemLog } from './types';
import { BATTERY_POS, BULLSEYE_POS, WEAPON_STATS, INITIAL_TRACKS, DEFENDED_ASSETS } from './constants';
import { getThreatName, calculateRange, calculateBearing, calculateKinematics, calculateClosureRate } from './utils';
import { MISSION_STEPS } from './mission';
import { processFighters } from './ai';
import { useSyncExternalStore } from 'react';
import BriefingModal from './BriefingModal';
import AfterActionReport from './AfterActionReport';

const nowStore = {
  now: Date.now(),
  listeners: new Set<() => void>(),
  rafId: 0,
  subscribe: (listener: () => void) => {
    nowStore.listeners.add(listener);
    if (nowStore.listeners.size === 1) {
      nowStore.start();
    }
    return () => {
      nowStore.listeners.delete(listener);
      if (nowStore.listeners.size === 0) {
        nowStore.stop();
      }
    };
  },
  getSnapshot: () => nowStore.now,
  start: () => {
    const tick = () => {
      nowStore.now = Date.now();
      nowStore.listeners.forEach(l => l());
      nowStore.rafId = requestAnimationFrame(tick);
    };
    nowStore.rafId = requestAnimationFrame(tick);
  },
  stop: () => {
    cancelAnimationFrame(nowStore.rafId);
  }
};

const useNow = () => {
  return useSyncExternalStore(nowStore.subscribe, nowStore.getSnapshot);
};

const getGstTimeStr = (offsetMs: number = 0) => {
  const now = new Date(Date.now() + offsetMs);
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const gstDate = new Date(utc + (3600000 * 4));
  return gstDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
};

const MissileVector = React.memo(({ interceptor, track, color, cameraZoom, lastSweepTime }: { interceptor: any, track: Track, color: string, cameraZoom: number, lastSweepTime: number }) => {
  const now = useNow();
  if (!interceptor.engagementTime || !interceptor.interceptDuration || interceptor.interceptTtl === undefined) return null;
  
  // 1. Calculate continuous progress based on original launch time
  const elapsedSinceLaunch = now - interceptor.engagementTime;
  const progress = Math.min(1, Math.max(0, elapsedSinceLaunch / interceptor.interceptDuration));

  // 2. Smooth TTI for the text display
  const elapsedSinceLastSweep = (now - lastSweepTime) / 1000;
  const smoothTti = Math.max(0, interceptor.interceptTtl - elapsedSinceLastSweep);

  if (progress >= 1) return null;

  const startX = interceptor.launchPos.x;
  const startY = interceptor.launchPos.y;

  // 3. Predict where the target is RIGHT NOW (Interpolated)
  const currentTargetX = track.x + Math.sin(track.hdg * Math.PI / 180) * ((track.spd / 3600) * elapsedSinceLastSweep);
  const currentTargetY = track.y - Math.cos(track.hdg * Math.PI / 180) * ((track.spd / 3600) * elapsedSinceLastSweep);

  // 4. Predict where the target WILL BE at impact (Lead Point)
  // Use the remaining duration rather than smoothTti to ensure the lead point stays stable
  const remainingSecs = (interceptor.interceptDuration - elapsedSinceLaunch) / 1000;
  const targetLeadX = currentTargetX + Math.sin(track.hdg * Math.PI / 180) * ((track.spd / 3600) * remainingSecs);
  const targetLeadY = currentTargetY - Math.cos(track.hdg * Math.PI / 180) * ((track.spd / 3600) * remainingSecs);

  // 5. Interpolate missile position along the stable track to the lead point
  const missileX = startX + (targetLeadX - startX) * progress;
  const missileY = startY + (targetLeadY - startY) * progress;

  const dx = targetLeadX - missileX;
  const dy = targetLeadY - missileY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const leadX = dist > 0 ? missileX + (dx / dist) * Math.min(2.0, dist) : missileX;
  const leadY = dist > 0 ? missileY + (dy / dist) * Math.min(2.0, dist) : missileY;

  return (
    <g>
      <line x1={startX} y1={startY} x2={missileX} y2={missileY} stroke={color} strokeWidth={0.1 / cameraZoom} strokeDasharray={`${0.2 / cameraZoom} ${0.4 / cameraZoom}`} opacity="0.4" />
      <line x1={missileX} y1={missileY} x2={leadX} y2={leadY} stroke={color} strokeWidth={0.2 / cameraZoom} className="animate-pulse" />
      <circle cx={missileX} cy={missileY} r={0.3 / cameraZoom} fill={color} />
      <text x={missileX} y={missileY - (1.2 / cameraZoom)} fill={color} fontSize={0.7 / cameraZoom} fontFamily="monospace" textAnchor="middle" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>
        TTI: {Math.ceil(smoothTti)}s
      </text>
    </g>
  );
});

import { useTrackStore } from './store';

const trackSymbolAreEqual = (
  prevProps: { trackId: string, isHooked: boolean, cameraZoom: number, lastSweepTime: number, filters: any },
  nextProps: { trackId: string, isHooked: boolean, cameraZoom: number, lastSweepTime: number, filters: any }
) => {
  if (prevProps.trackId !== nextProps.trackId) return false;
  if (prevProps.isHooked !== nextProps.isHooked) return false;
  if (prevProps.cameraZoom !== nextProps.cameraZoom) return false;
  if (prevProps.lastSweepTime !== nextProps.lastSweepTime) return false;
  if (prevProps.filters !== nextProps.filters) return false;
  return true;
};

const TrackSymbol = React.memo(({ trackId, isHooked, cameraZoom, lastSweepTime, filters }: { trackId: string, isHooked: boolean, cameraZoom: number, lastSweepTime: number, filters: any }) => {
  const track = useTrackStore(state => state.tracks[trackId]);
  const now = useNow();
  if (!track || track.detected === false) return null;

  if (!filters.showUnknowns && (track.type === 'UNKNOWN' || track.type === 'PENDING')) return null;
  if (!filters.showFriends && track.type === 'FRIEND') return null;
  if (!filters.showNeutrals && (track.type === 'NEUTRAL' || track.type === 'ASSUMED_FRIEND')) return null;
  if (!filters.showHostiles && (track.type === 'HOSTILE' || track.type === 'SUSPECT')) return null;

  const elapsed = (now - lastSweepTime) / 1000;
  const smoothX = track.x + Math.sin(track.hdg * Math.PI / 180) * ((track.spd / 3600) * elapsed);
  const smoothY = track.y - Math.cos(track.hdg * Math.PI / 180) * ((track.spd / 3600) * elapsed);

  let color = '#FFFF00'; // Pure Yellow (Pending/Unknown)
  if (track.type === 'FRIEND') color = '#00FF33'; // Tactical Green
  if (track.type === 'ASSUMED_FRIEND' || track.type === 'NEUTRAL') color = '#00FFFF'; // Cyan
  if (track.type === 'HOSTILE') color = '#FF0000'; // Pure Red
  if (track.type === 'SUSPECT') color = '#FF8800'; // Orange

  // Logarithmic velocity vector to handle wide speed range (100kts to 4000kts)
  // Ensures slow drones have visible leaders while TBMs don't shoot off screen
  const vectorLength = 2.0 * Math.log10(track.spd / 10 + 1); 

  return (
    <g className={track.coasting ? 'opacity-50' : 'opacity-100'}>
      {/* Pairing Lines (Shooter to Target) - Show briefly on launch, or always if track is hooked */}
      {track.interceptors && track.interceptors.map((interceptor) => {
        const age = now - interceptor.engagementTime;
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
      {track.interceptors && track.interceptors.map((interceptor) => (
        <MissileVector key={`missile-${interceptor.id}`} interceptor={interceptor} track={track} color={color} cameraZoom={cameraZoom} lastSweepTime={lastSweepTime} />
      ))}

      {/* Track History Breadcrumbs */}
      {track.history.map((pos, i) => (
        <circle key={`hist-${track.id}-${i}`} cx={pos.x} cy={pos.y} r={0.2 / cameraZoom} fill={color} opacity={0.8 - (i * 0.05)} />
      ))}
      
      <g 
        transform={`translate(${smoothX}, ${smoothY})`} 
        className="cursor-pointer"
      >
        {/* Invisible larger hit area for easier clicking */}
        <circle cx="0" cy="0" r={3 / cameraZoom} fill="transparent" />

        {/* Hook indicator */}
        {isHooked && (
          <rect x={-1.2 / cameraZoom} y={-1.2 / cameraZoom} width={2.4 / cameraZoom} height={2.4 / cameraZoom} fill="none" stroke="#00FFFF" strokeWidth={0.15 / cameraZoom} opacity="0.8" />
        )}
        
        {/* Velocity Leader */}
        <line 
          x1="0" y1="0" 
          x2={Math.sin(track.hdg * Math.PI / 180) * vectorLength} 
          y2={-Math.cos(track.hdg * Math.PI / 180) * vectorLength} 
          stroke={color} strokeWidth={0.15 / cameraZoom} opacity="0.8"
          strokeDasharray={track.coasting ? `${0.5 / cameraZoom} ${0.5 / cameraZoom}` : "none"}
        />

        {/* NTDS Air Shapes */}
        <g transform={`scale(${0.08 / cameraZoom}) translate(-12, -12)`} stroke={color} strokeWidth="3" fill="none" style={{ filter: `drop-shadow(0 0 2px ${color})` }} strokeDasharray={track.coasting ? "4 4" : "none"}>
          {(track.type === 'FRIEND' || track.type === 'ASSUMED_FRIEND') && <path d="M 4 14 A 8 8 0 0 1 20 14 Z" />}
          {track.type === 'HOSTILE' && <path d="M 4 14 L 12 4 L 20 14 Z" />}
          {(track.type === 'UNKNOWN' || track.type === 'PENDING' || track.type === 'SUSPECT') && <path d="M 4 14 L 4 8 L 8 4 L 16 4 L 20 8 L 20 14 Z" />}
          {track.type === 'NEUTRAL' && <path d="M 4 14 L 4 4 L 20 4 L 20 14 Z" />}
        </g>

        {/* On-Glass Data Block with Leader Line */}
        {isHooked && (
          <g>
            {/* Leader Line */}
            <line x1={1.0 / cameraZoom} y1={1.0 / cameraZoom} x2={1.8 / cameraZoom} y2={1.8 / cameraZoom} stroke={color} strokeWidth={0.1 / cameraZoom} opacity="0.8" />
            <g transform={`translate(${2.2 / cameraZoom}, ${2.2 / cameraZoom})`}>
              <text x="0" y="0" fill={color} fontSize={0.7 / cameraZoom} fontFamily="monospace" fontWeight="bold" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>{track.threatName || track.id}</text>
              <text x="0" y={1.0 / cameraZoom} fill={color} fontSize={0.7 / cameraZoom} fontFamily="monospace" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>{track.alt >= 18000 ? `FL${Math.round(track.alt/100)}` : Math.round(track.alt/100).toString().padStart(3, '0')} / {Math.round(track.spd).toString().padStart(3, '0')}</text>
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

    {/* Dubai Coastline & Landmarks (Abstract/Angular Military Style) */}
    {/* Main Coastline - Perfectly aligned through Jebel Ali (40, 60) and Port Rashid (58, 43) */}
    <path 
      d="M -100,192 L 0,98 L 40,60 L 58,43 L 150,-44" 
      fill="none" 
      stroke="#FFFFFF" 
      strokeOpacity="0.4"
      strokeWidth={0.4 / cameraZoom} 
    />
    
    {/* Palm Jebel Ali (Abstract Square) - Offshore from Jebel Ali */}
    <path d="M 36,57 L 38,55 L 40,57 L 38,59 Z" fill="none" stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth={0.2 / cameraZoom} />
    {/* Palm Jumeirah (Abstract Square) - Halfway between ports */}
    <path d="M 44,49 L 46,47 L 48,49 L 46,51 Z" fill="none" stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth={0.2 / cameraZoom} />
    {/* The World Islands (Abstract Polygon) - Offshore from Port Rashid */}
    <path d="M 49,42 L 52,40 L 54,43 L 51,44 Z" fill="none" stroke="#FFFFFF" strokeOpacity="0.4" strokeWidth={0.2 / cameraZoom} />

    {/* Defended Urban Footprint (Dubai Metropolitan Area) - Aligned to coast */}
    <path d="M 40,60 L 58,43 L 63,49 L 45,66 Z" fill="#00FF00" fillOpacity="0.05" stroke="#00FF00" strokeWidth={0.2 / cameraZoom} strokeDasharray={`${0.5 / cameraZoom} ${0.5 / cameraZoom}`} />
    <text x="47" y="55" fill="#00FF00" fontSize={0.6 / cameraZoom} fontFamily="monospace" opacity="0.4" transform="rotate(-43 47 55)">DEFENDED METRO AREA</text>
    {/* Radar Sector (FOV Wedge) - 120 degrees looking North */}
    <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y})`}>
      <path d="M 0 0 L -43.3 -75 A 86.6 86.6 0 0 1 43.3 -75 Z" fill="#00FFFF" fillOpacity="0.02" stroke="#00FFFF" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${1 / cameraZoom} ${2 / cameraZoom}`} />
      <line x1="0" y1="0" x2="0" y2="-86.6" stroke="#00FFFF" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${2 / cameraZoom} ${2 / cameraZoom}`} opacity="0.5" /> {/* PTL */}
    </g>

    {/* Concentric Range Rings & Azimuth Lines */}
    <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y})`} stroke="#002B40" strokeWidth={0.1 / cameraZoom} opacity="0.6">
      {/* Azimuth Lines every 30 degrees */}
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => (
        <line key={`az-${deg}`} x1="0" y1="0" x2={Math.sin(deg * Math.PI / 180) * 100} y2={-Math.cos(deg * Math.PI / 180) * 100} />
      ))}
      {/* Range Rings: 10NM, 20NM, 50NM */}
      <circle cx="0" cy="0" r="10" fill="none" />
      <text x="0" y="-10.5" fill="#002B40" fontSize={0.8 / cameraZoom} textAnchor="middle">10NM</text>
      <circle cx="0" cy="0" r="20" fill="none" />
      <text x="0" y="-20.5" fill="#002B40" fontSize={0.8 / cameraZoom} textAnchor="middle">20NM</text>
      <circle cx="0" cy="0" r="50" fill="none" />
      <text x="0" y="-50.5" fill="#002B40" fontSize={0.8 / cameraZoom} textAnchor="middle">50NM</text>
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

const DefendedAssets = React.memo(({ cameraZoom }: { cameraZoom: number }) => (
  <>
    {DEFENDED_ASSETS.map(asset => (
      <g key={asset.id} transform={`translate(${asset.x}, ${asset.y})`}>
        <rect x={-0.8 / cameraZoom} y={-0.8 / cameraZoom} width={1.6 / cameraZoom} height={1.6 / cameraZoom} fill="none" stroke="#00E5FF" strokeWidth={0.2 / cameraZoom} />
        <text x={1.2 / cameraZoom} y={0.5 / cameraZoom} fill="#00E5FF" fontSize={0.6 / cameraZoom} fontFamily="monospace" opacity="0.7">
          {asset.name}
        </text>
        {asset.hasCram && (
          <>
            <circle cx="0" cy="0" r="2.5" fill="none" stroke="#00E5FF" strokeWidth={0.1 / cameraZoom} strokeDasharray={`${0.2 / cameraZoom} ${0.2 / cameraZoom}`} opacity="0.5" />
            <text x="0" y="-2.8" fill="#00E5FF" fontSize={0.5 / cameraZoom} fontFamily="monospace" opacity="0.5" textAnchor="middle">C-RAM</text>
          </>
        )}
      </g>
    ))}
  </>
));

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
              const range = calculateRange(t.x, t.y, BATTERY_POS.x, BATTERY_POS.y).toFixed(1);
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
                  <td className="py-2 px-3 text-[#00E5FF] text-right tabular-nums">{t.alt >= 18000 ? `FL${Math.round(t.alt/100)}` : Math.round(t.alt/100).toString().padStart(3, '0')}</td>
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
  const [time, setTime] = useState(() => {
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const gstDate = new Date(utc + (3600000 * 4));
    return gstDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      const gstDate = new Date(utc + (3600000 * 4));
      setTime(gstDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return <span className="text-[#00E5FF] tabular-nums">{time}</span>;
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

const Tote = React.memo(({ hookedTrackIds, masterWarning, vectoringTrackId, setVectoringTrackId, isAutoTamir, setIsAutoTamir, filters, setFilters }: { hookedTrackIds: string[], masterWarning: boolean, vectoringTrackId: string | null, setVectoringTrackId: (id: string | null) => void, isAutoTamir: boolean, setIsAutoTamir: React.Dispatch<React.SetStateAction<boolean>>, filters: any, setFilters: React.Dispatch<React.SetStateAction<any>> }) => {
  const tracksMap = useTrackStore(state => state.tracks);
  const hookedTracks = useMemo(() => hookedTrackIds.map(id => tracksMap[id]).filter(Boolean), [hookedTrackIds, tracksMap]);

  const hookedTrack = hookedTracks.length === 1 ? hookedTracks[0] : undefined;
  const isGroup = hookedTracks.length > 1;

  const kinematics = hookedTrack ? calculateKinematics(hookedTrack) : null;
  const brg = hookedTrack ? calculateBearing(hookedTrack.x, hookedTrack.y, BATTERY_POS.x, BATTERY_POS.y).toString().padStart(3, '0') : '';
  const rng = hookedTrack ? calculateRange(hookedTrack.x, hookedTrack.y, BATTERY_POS.x, BATTERY_POS.y).toFixed(1).padStart(4, '0') : '';
  const bullBrg = hookedTrack ? calculateBearing(hookedTrack.x, hookedTrack.y, BULLSEYE_POS.x, BULLSEYE_POS.y).toString().padStart(3, '0') : '';
  const bullRng = hookedTrack ? calculateRange(hookedTrack.x, hookedTrack.y, BULLSEYE_POS.x, BULLSEYE_POS.y).toFixed(0).padStart(3, '0') : '';

  return (
    <aside className={`w-[300px] bg-[#001A26]/20 backdrop-blur-md border ${masterWarning ? 'border-[#FF0033]' : 'border-[#002B40]'} flex flex-col pointer-events-auto transition-colors duration-300 h-fit pb-0`}>
      <div className={`px-3 py-2 border-b ${masterWarning ? 'bg-[#440000]/20 border-[#FF0033]' : 'bg-[#001A26]/20 border-[#002B40]'} flex items-center gap-2 shrink-0`}>
        <span className={masterWarning ? 'text-[#FF0033] font-bold' : 'text-[#00E5FF] font-bold'}>[DATA]</span>
        <h2 className={`text-xs font-bold tracking-widest ${masterWarning ? 'text-[#FF0033]' : 'text-[#00E5FF]'}`}>{isGroup ? `GROUP TRACK DATA (${hookedTracks.length})` : 'HOOKED TRACK DATA'}</h2>
      </div>
      
      <div className="p-4 flex flex-col gap-4 flex-1">
        {isGroup ? (
          <div className="space-y-4">
            <div className="border border-[#002B40] bg-[#000A14]/30 p-3">
              <div className="text-[10px] text-[#004466] mb-2 uppercase tracking-tighter">Selection Breakdown</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="text-[#FF0000]">HOSTILE: {hookedTracks.filter(t => t.type === 'HOSTILE').length}</div>
                <div className="text-[#00FF33]">FRIENDLY: {hookedTracks.filter(t => t.type === 'FRIEND').length}</div>
                <div className="text-[#00FFFF]">NEUTRAL/ASM: {hookedTracks.filter(t => t.type === 'NEUTRAL' || t.type === 'ASSUMED_FRIEND').length}</div>
                <div className="text-[#FFFF00]">PENDING: {hookedTracks.filter(t => t.type === 'PENDING' || t.type === 'UNKNOWN').length}</div>
                <div className="text-[#FF8800]">SUSPECT: {hookedTracks.filter(t => t.type === 'SUSPECT').length}</div>
              </div>
            </div>
            <div className="border border-[#002B40] bg-[#000A14]/30 p-3">
              <div className="text-[10px] text-[#004466] mb-2 uppercase tracking-tighter">Category Summary</div>
              <div className="space-y-1 text-xs text-[#00E5FF]">
                {Array.from(new Set(hookedTracks.map(t => t.category))).map(cat => (
                  <div key={cat} className="flex justify-between border-b border-[#002B40]/30 py-1">
                    <span>{cat}</span>
                    <span className="font-bold">{hookedTracks.filter(t => t.category === cat).length}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : hookedTrack ? (
          <>
            {/* Header Block */}
            <div className="border border-[#002B40] bg-[#000A14]/30 p-3 flex justify-between items-center">
              <span className="text-2xl font-bold text-[#00E5FF] tracking-wider">{hookedTrack.id}</span>
              <span className={`px-2 py-1 text-xs font-bold border ${
                hookedTrack.type === 'FRIEND' ? 'border-[#00FF33] text-[#00FF33] bg-[#00FF33]/10' :
                (hookedTrack.type === 'ASSUMED_FRIEND' || hookedTrack.type === 'NEUTRAL') ? 'border-[#00FFFF] text-[#00FFFF] bg-[#00FFFF]/10' :
                hookedTrack.type === 'HOSTILE' ? 'border-[#FF0000] text-[#FF0000] bg-[#FF0000]/10 animate-pulse' :
                hookedTrack.type === 'SUSPECT' ? 'border-[#FF8800] text-[#FF8800] bg-[#FF8800]/10' :
                'border-[#FFFF00] text-[#FFFF00] bg-[#FFFF00]/10'
              }`}>
                {hookedTrack.threatName || hookedTrack.type}
              </span>
            </div>

            {/* Strict Data Grid - Consolidated */}
            <div className="border border-[#002B40] bg-[#000A14]/30">
              <div className="grid grid-cols-2 text-xs">
                
                <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">CAT / SRC</div>
                <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold">
                  {hookedTrack.category} / {hookedTrack.sensor}
                </div>

                <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">HDG / SPD</div>
                <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold tabular-nums">
                  {Math.round(hookedTrack.hdg).toString().padStart(3, '0')} / {Math.round(hookedTrack.spd).toString().padStart(4, '0')}
                </div>
                
                <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">ALTITUDE</div>
                <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold tabular-nums">
                  {hookedTrack.alt >= 18000 ? `FL${Math.round(hookedTrack.alt/100)}` : hookedTrack.alt.toString().padStart(5, '0')} FT
                </div>

                <div className="border-r border-[#002B40] p-2 text-[#004466] flex flex-col">
                  <span>BRG / RNG</span>
                  <span className="text-[9px] opacity-50">BULLSEYE</span>
                </div>
                <div className="p-2 text-right text-[#00E5FF] font-bold flex flex-col tabular-nums">
                  <span>{brg} / {rng} NM</span>
                  <span className="text-[9px] text-[#00FFFF] opacity-80">{bullBrg} / {bullRng} NM</span>
                </div>
              </div>
            </div>

            {/* Fighter Specific Data */}
            {hookedTrack.isFighter && (
              <div className="border border-[#002B40] bg-[#000A14]/30 p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs text-[#004466]">AAM INVENTORY</span>
                  <span className="text-xs font-bold text-[#00E5FF]">{hookedTrack.missilesRemaining} / 4</span>
                </div>
                {hookedTrack.fuel !== undefined && hookedTrack.maxFuel !== undefined && (
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-[#004466]">FUEL (LBS)</span>
                    <span className={`text-xs font-bold ${hookedTrack.fuel < (hookedTrack.maxFuel * 0.25) ? 'text-[#FFCC00] animate-pulse' : 'text-[#00FF33]'}`}>
                      {Math.floor(hookedTrack.fuel)}
                    </span>
                  </div>
                )}
                <button
                  className={`w-full py-2 text-xs font-bold tracking-widest transition-colors border ${
                    vectoringTrackId === hookedTrack.id
                      ? 'bg-[#00E5FF] text-[#00050A] border-[#00E5FF]'
                      : 'bg-[#001A26] text-[#00E5FF] border-[#004466] hover:bg-[#002B40]'
                  }`}
                  onClick={() => setVectoringTrackId(vectoringTrackId === hookedTrack.id ? null : hookedTrack.id)}
                >
                  {vectoringTrackId === hookedTrack.id ? 'CANCEL VECTOR' : 'VECTOR FIGHTER'}
                </button>
              </div>
            )}

            {/* Threat Warning */}
            {hookedTrack.type === 'HOSTILE' && (
              <div className="border border-[#FF0033] bg-[#220000]/50 p-3">
                <div className="flex items-center gap-2 text-[#FF0033] mb-1 text-xs font-bold">
                  <span>[WARN]</span>
                  THREAT WARNING
                </div>
                <div className="text-[10px] text-[#FF0033] font-bold">
                  {hookedTrack.threatName ? `${hookedTrack.threatName.toUpperCase()} INBOUND. CLEARED TO ENGAGE.` :
                   hookedTrack.category === 'UAS' ? 'QUAIL INBOUND. CLEARED TO ENGAGE.' : 
                   hookedTrack.category === 'TBM' ? 'SCUD INBOUND. CLEARED TO ENGAGE.' : 
                   'BANDIT INBOUND. CLEARED TO ENGAGE.'}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex flex-col p-2 space-y-6">
            <div className="flex-1 flex flex-col items-center justify-center text-[#002B40] space-y-4">
              <div className="text-4xl font-light opacity-50">[ ]</div>
              <p className="text-xs tracking-widest">NO TRACK HOOKED</p>
            </div>

            {/* Battery Doctrine Controls (Empty State Only) */}
            <div className="flex flex-col gap-2 mt-auto">
              <div className="text-[10px] text-[#004466] font-bold whitespace-nowrap">GLOBAL DOCTRINE</div>
              <button 
                onClick={() => setIsAutoTamir(p => !p)} 
                className={`h-10 px-4 flex flex-col items-center justify-center text-[10px] lg:text-xs font-bold tracking-widest transition-colors border ${isAutoTamir ? 'bg-[#FF0033] border-[#FF0033] text-[#00050A] hover:bg-[#CC0022]' : 'bg-[#001A26] border-[#004466] text-[#00E5FF] hover:bg-[#002B40]'}`}
              >
                <span className={`text-[8px] mb-0.5 ${isAutoTamir ? 'text-[#00050A] opacity-70' : 'text-[#004466]'}`}>8</span>
                AUTO-TAMIR: {isAutoTamir ? 'FREE' : 'HOLD'}
              </button>
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

export default function App() {
  const trackIds = useTrackStore(state => state.trackIds);
  const addTracks = useTrackStore(state => state.addTracks);
  const setTracks = useTrackStore(state => state.setTracks);

  const [lastSweepTime, setLastSweepTime] = useState(Date.now());

  const [hookedTrackIds, setHookedTrackIds] = useState<string[]>([]);
  const [logs, setLogs] = useState<SystemLog[]>([
    { id: 'initial-1', time: getGstTimeStr(-120000), message: 'SYS: JIAMD NODE INITIALIZED', type: 'INFO', acknowledged: true },
    { id: 'initial-2', time: getGstTimeStr(-90000), message: 'DATALINK LINK-16: ACTIVE', type: 'INFO', acknowledged: true },
    { id: 'initial-3', time: getGstTimeStr(-60000), message: 'WCS SET TO TIGHT. WEAPONS HOLD.', type: 'WARN', acknowledged: true },
    { id: 'initial-4', time: getGstTimeStr(-30000), message: 'INTEL: HEIGHTENED LEVEL OF ENCRYPTED CHATTER DETECTED IN SECTOR', type: 'WARN', acknowledged: true },
  ]);
  const [inventory, setInventory] = useState({ pac3: 32, tamir: 120, thaad: 8, cram: 999 });
  const [interceptorsFired, setInterceptorsFired] = useState({ 'PAC-3': 0, 'TAMIR': 0, 'THAAD': 0, 'AMRAAM': 0, 'C-RAM': 0 });
  const [destroyedAssetIds, setDestroyedAssetIds] = useState<string[]>([]);
  const [leakerCount, setLeakerCount] = useState(0);
  const [defenseCost, setDefenseCost] = useState(0);
  const [enemyCost, setEnemyCost] = useState(0);
  const [isAutoTamir, setIsAutoTamir] = useState(false);
  const [wcs, setWcs] = useState<'TIGHT' | 'FREE'>('TIGHT');
  const [filters, setFilters] = useState({ showUnknowns: true, showFriends: true, showNeutrals: true, showHostiles: true });
  const [buttonFeedback, setButtonFeedback] = useState<Record<string, 'action' | 'error'>>({});
  const [isGameStarted, setIsGameStarted] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [splashes, setSplashes] = useState<{ id: string, x: number, y: number, time: number }[]>([]);
  const [mouseCoords, setMouseCoords] = useState<{x: number, y: number}>({ x: 0, y: 0 });
  const simTimeRef = useRef(0);

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
    const timeStr = getGstTimeStr();
    const logId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    setLogs(prev => [{ id: logId, time: timeStr, message, type, acknowledged: type !== 'ALERT' }, ...prev].slice(0, 50));
  }, []);

  const unackAlerts = useMemo(() => logs.filter(l => !l.acknowledged), [logs]);

  useEffect(() => {
    if (!isGameStarted) return;

    const clockTimer = setInterval(() => {
      simTimeRef.current += 1;

      if (simTimeRef.current >= 270) {
        setIsGameOver(true);
      }

      const event = MISSION_STEPS.find(e => e.time === simTimeRef.current);
      if (event) {
        const newTracks = event.generateTracks();
        setTracks(current => [...current, ...newTracks]);
        addLog(event.message, event.type);

        // ROE Escalation: First TBM launch triggers WCS FREE
        if (newTracks.some(t => t.category === 'TBM') && wcs === 'TIGHT') {
          setWcs('FREE');
          addLog('WCS SET TO FREE. ALL HOSTILE TRACKS CLEARED FOR ENGAGEMENT.', 'ALERT');
        }

        // Calculate enemy cost for this wave
        const waveCost = newTracks.reduce((acc, t) => {
          if (t.category === 'UAS') return acc + 20000; // $20k per drone
          if (t.category === 'CM') return acc + 1500000; // $1.5M per cruise missile
          if (t.category === 'TBM') return acc + 3000000; // $3M per TBM
          return acc;
        }, 0);
        setEnemyCost(prev => prev + waveCost);
      }
    }, 1000);

    const sweepTimer = setInterval(() => {
      const events: { type: 'LOG' | 'COST', message?: string, logType?: 'INFO' | 'WARN' | 'ALERT' | 'ACTION', amount?: number }[] = [];

      setTracks(currentTracks => {
        events.length = 0; // Clear events to prevent duplicates in React Strict Mode double-invocations

        // 1. Progress intercepts and identify splashes/misses
        let nextTracks = currentTracks.map(t => {
          if (t.interceptors && t.interceptors.length > 0) {
            const updatedInterceptors = t.interceptors.map(i => ({
              ...i,
              interceptTtl: Math.max(0, i.interceptTtl - 3)
            }));
            return { ...t, interceptors: updatedInterceptors };
          }
          return t;
        });

        // Evaluate Impacts
        const destroyedTrackIds = new Set<string>();

        nextTracks.forEach(t => {
          if (!t.interceptors) return;
          
          t.interceptors.forEach(interceptor => {
            if (interceptor.interceptTtl === 0 && !destroyedTrackIds.has(t.id)) {
              // Stochastic Pk Check with absolute safety fallback to prevent crashes
              const weaponKey = interceptor.weapon as keyof typeof WEAPON_STATS;
              const stats = WEAPON_STATS[weaponKey];
              const pkValue = stats?.pk ?? 0.8; // Extremely safe extraction
              const roll = Math.random();
              
              if (roll <= pkValue) {
                // Hit
                events.push({ type: 'LOG', message: `TRACK ${t.id} SPLASH (${interceptor.shooterId}).`, logType: 'INFO' });
                destroyedTrackIds.add(t.id);
              } else {
                // Miss
                events.push({ type: 'LOG', message: `${interceptor.shooterId} MISSED TRACK ${t.id} (R: ${roll.toFixed(2)} > Pk: ${pkValue.toFixed(2)}).`, logType: 'WARN' });
              }
            }
          });
        });

        // Remove splashed targets
        nextTracks.forEach(t => {
          if (destroyedTrackIds.has(t.id)) {
            events.push({ type: 'SPLASH', x: t.x, y: t.y } as any);
          }
        });
        nextTracks = nextTracks.filter(t => !destroyedTrackIds.has(t.id));

        // Clean up completed interceptors (hits or misses) from surviving tracks
        nextTracks = nextTracks.map(t => {
          if (t.interceptors && t.interceptors.length > 0) {
            return { ...t, interceptors: t.interceptors.filter(i => i.interceptTtl > 0) };
          }
          return t;
        });

        // 2. Standard movement and physics
        nextTracks = nextTracks.map(track => {
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

            // Smooth speed transition
            if (newSpd < targetSpd) newSpd = Math.min(targetSpd, newSpd + 150);
            else if (newSpd > targetSpd) newSpd = Math.max(targetSpd, newSpd - 100);

            // Scramble climb
            if (track.alt < 50000) newAlt = Math.min(50000, track.alt + 1500);

            // Fuel Consumption (3s tick)
            // Approx burn: 40 lbs/tick at cruise (500kts), 150 lbs/tick at full afterburner (1300kts)
            if (newFuel !== undefined) {
              const burnRate = newSpd > 600 ? 150 : 40;
              newFuel = Math.max(0, newFuel - burnRate);
            }

            // Maneuvering
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
                const turnRate = Math.max(-30, Math.min(30, hdgDiff));
                newHdg = (newHdg + turnRate + 360) % 360;
              } else {
                if (!track.isRTB) {
                  if (newTargetWaypoint !== null) {
                    events.push({ type: 'LOG', message: `${track.id}: On station.`, logType: 'INFO' });
                  }
                  newTargetWaypoint = null;
                  newHdg = (newHdg + 10) % 360;
                }
              }
            } else {
              newHdg = (newHdg + 10) % 360;
            }
          } else {
            // Dynamic Profiles for Non-Fighter Tracks
            if (track.id === 'FLT-EK404') {
              // Hijack Profile: Aggressive descent to evade radar, throttle up
              if (newAlt > 5000) newAlt = Math.max(5000, newAlt - 500); // 10,000 ft/min emergency descent
              if (newSpd < 650) newSpd += 10; 
            } else if (track.category === 'TBM') {
              // Ballistic Profile: Exospheric cruise, then terminal hypersonic dive
              const distToCity = calculateRange(track.x, track.y, BATTERY_POS.x, BATTERY_POS.y);
              if (distToCity < 40) {
                // Terminal phase: pitch down, bleed altitude massively, accelerate
                newAlt = Math.max(0, newAlt - 12000); // 4000 ft/sec descent
                if (newSpd < 6000) newSpd += 250;
              }
            } else if (track.category === 'CM') {
              // Cruise Missile: Sea-skimming terrain following
              newAlt = Math.max(50, 100 + (Math.random() * 40 - 20)); // Jitter between 80-120ft
            } else if (track.category === 'UAS') {
              // Drone Swarm: Slight altitude and heading weave to complicate targeting
              newAlt = Math.max(100, track.alt + (Math.random() * 20 - 10));
              newHdg = (newHdg + (Math.random() * 4 - 2) + 360) % 360;
            }
          }

          const speedFactor = newSpd / 1200; 
          const rad = newHdg * (Math.PI / 180);
          let newX = track.x + Math.sin(rad) * speedFactor;
          let newY = track.y - Math.cos(rad) * speedFactor;

          const isStealthy = track.category === 'UAS' || track.alt < 1000;
          const rangeToBattery = calculateRange(newX, newY, BATTERY_POS.x, BATTERY_POS.y);
          const radarHorizonNm = 1.23 * (Math.sqrt(100) + Math.sqrt(track.alt));
          const isDetected = track.sensor === 'L16' || rangeToBattery <= radarHorizonNm;

          const newHistory = [{x: track.x, y: track.y}, ...track.history].slice(0, 15);
          return { ...track, x: newX, y: newY, history: newHistory, coasting: track.tq <= 2, detected: isDetected, spd: newSpd, alt: newAlt, hdg: newHdg, targetWaypoint: newTargetWaypoint, fuel: newFuel };
        });

        // 3. Fighter AI (VID, Targeting, and Auto-Engagement)
        nextTracks = processFighters(nextTracks, events, Date.now());

                // 4. Cleanup and RTB
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
        
                // 4.5 Automatic TAMIR Point Defense (Weapons Free)
                let currentTamir = inventoryRef.current.tamir;
                nextTracks = nextTracks.map(t => {
                  if (isAutoTamirRef.current && t.type === 'HOSTILE' && t.category !== 'TBM' && t.category !== 'FW' && t.category !== 'RW' && t.alt <= 30000 && currentTamir > 0) {
                    const rng = calculateRange(t.x, t.y, BATTERY_POS.x, BATTERY_POS.y);
                    // Check if within 35NM TAMIR (Iron Dome) WEZ and not already being shot at by Battery
                    const existingBatteryMissiles = t.interceptors ? t.interceptors.filter(i => i.shooterId === 'BATTERY').length : 0;
                    
                    // Auto-TAMIR employs double-tap doctrine to guarantee kill on close-in leakers
                    const requiredMissiles = 2;

                    if (rng <= 35.0 && existingBatteryMissiles < requiredMissiles) {
                      const shotsToTake = Math.min(requiredMissiles - existingBatteryMissiles, currentTamir);
                      
                      let newInterceptors = [];
                      for (let i = 0; i < shotsToTake; i++) {
                        currentTamir--;
                        
                        setInterceptorsFired(prev => ({ ...prev, 'TAMIR': prev['TAMIR'] + 1 }));
                        
                        const costStr = WEAPON_STATS['TAMIR'].cost >= 1000000 ? `$${(WEAPON_STATS['TAMIR'].cost / 1000000).toFixed(1)}M` : `$${Math.round(WEAPON_STATS['TAMIR'].cost / 1000)}K`;
                        events.push({ type: 'LOG', message: `TAMIR AUTO-ENGAGE TRK ${t.id} (-${costStr})`, logType: 'ACTION' });
                        events.push({ type: 'COST', amount: WEAPON_STATS['TAMIR'].cost });
                        
                        const closureRate = calculateClosureRate(BATTERY_POS, t, WEAPON_STATS['TAMIR'].speedMach);
                        // Stagger intercept times slightly for visual clarity on double taps
                        const interceptTimeSecs = (rng / Math.max(0.1, closureRate)) + (i * 0.5); 
                        
                        newInterceptors.push({
                          id: `TAMIR-AUTO-${Date.now()}-${Math.random()}`,
                          weapon: 'TAMIR' as const,
                          shooterId: 'BATTERY',
                          launchPos: { x: BATTERY_POS.x, y: BATTERY_POS.y },
                          engagementTime: Date.now() + (i * 500), // Physical launch stagger
                          interceptDuration: interceptTimeSecs * 1000,
                          interceptTtl: Math.ceil(interceptTimeSecs)
                        });
                      }
                      
                      return { ...t, interceptors: [...(t.interceptors || []), ...newInterceptors] };
                    }
                  }
                  return t;
                });
                
                if (currentTamir !== inventoryRef.current.tamir) {
                   setInventory(prev => ({ ...prev, tamir: currentTamir }));
                }

                // 4.6 Terminal Point Defense (C-RAM / Laser CIWS)
                nextTracks = nextTracks.map(t => {
                  if (t.type === 'HOSTILE' && t.category !== 'TBM' && (!t.interceptors || !t.interceptors.some(i => i.shooterId === 'CIWS'))) {
                    // Check if track is threatening ANY defended asset that has C-RAM equipped
                    for (const asset of DEFENDED_ASSETS) {
                      if (!asset.hasCram) continue;
                      
                      const rngToAsset = calculateRange(t.x, t.y, asset.x, asset.y);
                      if (rngToAsset <= 2.5) {
                        setInterceptorsFired(prev => ({ ...prev, 'C-RAM': prev['C-RAM'] + 1 }));
                        const costStr = WEAPON_STATS['C-RAM'].cost >= 1000000 ? `$${(WEAPON_STATS['C-RAM'].cost / 1000000).toFixed(1)}M` : `$${(WEAPON_STATS['C-RAM'].cost / 1000).toFixed(1)}K`;
                        events.push({ type: 'LOG', message: `CIWS (${asset.id}) ENGAGING LEAKER TRK ${t.id} (-${costStr})`, logType: 'ACTION' });
                        events.push({ type: 'COST', amount: WEAPON_STATS['C-RAM'].cost });
                        
                        const closureRate = calculateClosureRate({x: asset.x, y: asset.y}, t, WEAPON_STATS['C-RAM'].speedMach);
                        const interceptTimeSecs = rngToAsset / Math.max(0.1, closureRate);
                        
                        const newInterceptor = {
                          id: `CIWS-${Date.now()}-${Math.random()}`,
                          weapon: 'C-RAM' as const,
                          shooterId: 'CIWS',
                          launchPos: { x: asset.x, y: asset.y }, // Launch from the asset, not the battery
                          engagementTime: Date.now(),
                          interceptDuration: interceptTimeSecs * 1000,
                          interceptTtl: Math.ceil(interceptTimeSecs)
                        };
                        return { ...t, interceptors: [...(t.interceptors || []), newInterceptor] };
                      }
                    }
                  }
                  return t;
                });

                // 5. Leaker Detection (Impacts on Dubai)
                const impactedTrackIds = new Set<string>();
                nextTracks.forEach(t => {
                  if (t.type === 'HOSTILE' || t.type === 'SUSPECT') {
                    DEFENDED_ASSETS.forEach(asset => {
                      const dist = calculateRange(t.x, t.y, asset.x, asset.y);
                      // 2.5 NM threshold because fast TBMs jump ~3.3NM per 3s sweep
                      if (dist < 2.5) {
                        impactedTrackIds.add(t.id);
                        events.push({ 
                          type: 'LOG', 
                          message: `!!! IMPACT: ${asset.name} STRUCK BY ${t.id} !!!`, 
                          logType: 'ALERT' 
                        });
                        events.push({ type: 'IMPACT', assetId: asset.id } as any);
                      }
                    });
                  }
                });
        
                return nextTracks.filter(t =>
                  !impactedTrackIds.has(t.id) &&
                  !(t.isFighter && t.isRTB && calculateRange(t.x, t.y, 57.5, 62.5) < 2) &&
                  t.x >= -100 && t.x <= 200 && t.y >= -100 && t.y <= 200
                );      });

      events.forEach(e => {
        if (e.type === 'LOG') addLog(e.message!, e.logType);
        if (e.type === 'COST') setDefenseCost(prev => prev + e.amount!);
        if (e.type === 'AMRAAM_FIRED') setInterceptorsFired(prev => ({ ...prev, 'AMRAAM': prev['AMRAAM'] + 1 }));
        if (e.type === 'IMPACT') {
          setLeakerCount(prev => prev + 1);
          const assetId = (e as any).assetId;
          if (assetId) {
            setDestroyedAssetIds(prev => prev.includes(assetId) ? prev : [...prev, assetId]);
          }
        }
        if ((e as any).type === 'SPLASH') {
          setSplashes(prev => [...prev, { id: `splash-${Date.now()}-${Math.random()}`, x: (e as any).x, y: (e as any).y, time: Date.now() }]);
        }
      });

            setLastSweepTime(Date.now());
          }, 3000);
      
          return () => {
            clearInterval(clockTimer);
            clearInterval(sweepTimer);
          };
        }, [addLog, isGameStarted, wcs]);
      
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
    const elapsed = (Date.now() - lastSweepTime) / 1000;

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
    setMouseCoords(coords);

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
      const elapsed = (Date.now() - lastSweepTime) / 1000;

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

  const handleInterrogate = useCallback(() => {
    if (hookedTrackIds.length === 0) return;
    
    hookedTrackIds.forEach((id, index) => {
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

    const handleEngage = useCallback((weapon: 'PAC-3' | 'TAMIR' | 'THAAD') => {
      if (hookedTrackIds.length === 0) return;
  
      const stats = WEAPON_STATS[weapon];
      let currentPac3 = inventory.pac3;
      let currentTamir = inventory.tamir;
      let currentThaad = inventory.thaad;
  
      hookedTrackIds.forEach((id, index) => {
        const target = useTrackStore.getState().getTrack(id);
        if (!target || target.type !== 'HOSTILE') return;
  
        // Kinematic limitations
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
  
        const rng = calculateRange(target.x, target.y, BATTERY_POS.x, BATTERY_POS.y);
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
        setInterceptorsFired(prev => ({
          ...prev,
          [weapon]: prev[weapon] + shotsToTake
        }));
        
        const costStr = stats.cost >= 1000000 ? `$${(stats.cost / 1000000).toFixed(1)}M` : `$${Math.round(stats.cost / 1000)}K`;
        setDefenseCost(prev => prev + (stats.cost * shotsToTake));
        addLog(`BIRDS AWAY. ENGAGING TRK ${id} WITH ${weapon} (-${costStr})`, 'ACTION');
        
        const missileSpdNmSec = weapon === "THAAD" ? 1.5 : (weapon === "PAC-3" ? 0.7 : 0.5); // Mach 8 vs Mach 4 vs Mach 3
        const closureRate = calculateClosureRate(BATTERY_POS, target, missileSpdNmSec);
        
        const launchPos = { x: BATTERY_POS.x, y: BATTERY_POS.y };

        setTracks(current => current.map(t => {
          if (t.id === id) {
             const interceptTimeSecs = (rng / Math.max(0.1, closureRate));
             const newInterceptor = {
               id: `${weapon}-${Date.now()}-${Math.random()}`,
               weapon,
               shooterId: 'BATTERY',
               launchPos,
               engagementTime: Date.now(),
               interceptDuration: interceptTimeSecs * 1000,
               interceptTtl: Math.ceil(interceptTimeSecs)
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
  const isAutoTamirRef = useRef(isAutoTamir);

  useEffect(() => {
    unackAlertsRef.current = unackAlerts;
    inventoryRef.current = inventory;
    isAutoTamirRef.current = isAutoTamir;
  }, [unackAlerts, inventory, isAutoTamir]);

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
        case '1':
          if (hookedTrackIds.length > 0) trigger('1', () => setHookedTrackIds([]));
          break;
        case '2':
          if (hookedTrackIds.length > 0) trigger('2', () => handleInterrogate());
          break;
        case '3':
          if (hookedTrackIds.length > 0) trigger('3', () => {
            const anyHostile = useTrackStore.getState().getAllTracks().some(t => hookedTrackIds.includes(t.id) && t.type === 'HOSTILE');
            handleDeclare(anyHostile ? 'SUSPECT' : 'HOSTILE');
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
      {isGameOver && (
        <AfterActionReport 
          interceptorsFired={interceptorsFired}
          leakerCount={leakerCount}
          destroyedAssetIds={destroyedAssetIds}
          defenseCost={defenseCost}
          enemyCost={enemyCost}
        />
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
          {vectoringTrackId && (
            (() => {
              const track = useTrackStore.getState().getTrack(vectoringTrackId);
              if (!track) return null;
              return (
                <g>
                  <line 
                    x1={track.x} y1={track.y} 
                    x2={mouseCoords.x} y2={mouseCoords.y} 
                    stroke="#00E5FF" 
                    strokeWidth={0.2 / camera.zoom} 
                    strokeDasharray={`${0.5 / camera.zoom} ${0.5 / camera.zoom}`} 
                    className="animate-pulse"
                  />
                  <circle cx={mouseCoords.x} cy={mouseCoords.y} r={1 / camera.zoom} fill="none" stroke="#00E5FF" strokeWidth={0.1 / camera.zoom} className="animate-ping" />
                </g>
              );
            })()
          )}

          {/* Render Splashes */}
          {splashes.map(s => (
            <g key={s.id} transform={`translate(${s.x}, ${s.y})`}>
              <circle r={2 / camera.zoom} fill="none" stroke="#FF0033" strokeWidth={0.2 / camera.zoom} className="animate-ping" />
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
                          lastSweepTime={lastSweepTime}
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
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className={masterWarning ? 'text-[#FF0033]' : 'text-[#00E5FF]'}>[SYS]</span>
                  <span className={`text-sm font-bold tracking-widest ${masterWarning ? 'text-[#FF0033] animate-pulse' : 'text-[#00E5FF]'}`}>
                    {masterWarning ? 'ALARM: ENGAGEMENT CRITERIA MET' : 'JIAMD'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] lg:text-xs font-bold tracking-wider border-l border-[#002B40] pl-4 lg:pl-6">
                  <span className="text-[#FFCC00] whitespace-nowrap">WCS: <span className={wcs === 'FREE' ? 'text-[#FF0033] animate-pulse' : 'text-[#00E5FF]'}>{wcs}</span></span>
                              <div className="hidden lg:block w-px h-4 bg-[#002B40] mx-1" />
                              <span className="text-[#00FF33] whitespace-nowrap">THAAD: <span className="text-[#00E5FF] tabular-nums">{inventory.thaad}/8</span></span>
                              <span className="text-[#00FF33] whitespace-nowrap">PAC-3: <span className="text-[#00E5FF] tabular-nums">{inventory.pac3}/32</span></span>
                              <span className="text-[#00FF33] whitespace-nowrap">TAMIR: <span className="text-[#00E5FF] tabular-nums">{inventory.tamir}/120</span></span>
                              <span className="text-[#00FF33] whitespace-nowrap">C-RAM: <span className="text-[#00E5FF]">RDY</span></span>                </div>
              </div>
              <div className="flex items-center gap-4 lg:gap-6 text-[10px] lg:text-xs font-bold whitespace-nowrap">
                {unackAlerts.length > 0 && (
                  <div className="bg-[#FF0033] text-[#00050A] px-2 py-1 animate-pulse border border-[#FF0033]">
                    {unackAlerts.length} UNACK ALERTS
                  </div>
                )}
                <span className="text-[#00E5FF]">SECTOR: <SystemClock /></span>
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
                defaultPos={{ x: window.innerWidth ? window.innerWidth - 316 : 1000, y: 16 }} 
                className="w-[300px] max-h-[calc(100vh-160px)]"
              >
                <Tote hookedTrackIds={hookedTrackIds} masterWarning={masterWarning} vectoringTrackId={vectoringTrackId} setVectoringTrackId={setVectoringTrackId} isAutoTamir={isAutoTamir} setIsAutoTamir={setIsAutoTamir} filters={filters} setFilters={setFilters} />
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
            const anyHostile = useTrackStore.getState().getAllTracks().some(t => hookedTrackIds.includes(t.id) && t.type === 'HOSTILE');
            handleDeclare(anyHostile ? 'SUSPECT' : 'HOSTILE');
          }}
        >
          <span className="text-[8px] text-[#004466] mb-0.5">3</span>
          {useTrackStore.getState().getAllTracks().some(t => hookedTrackIds.includes(t.id) && t.type === 'HOSTILE') ? 'DOWNGRADE' : 'DECL HOSTILE'}
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
