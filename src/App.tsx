/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Track, TrackType, SystemLog } from './types';
import { BATTERY_POS, BULLSEYE_POS, WEAPON_STATS, INITIAL_TRACKS, DEFENDED_ASSETS } from './constants';
import { getThreatName, calculateRange, calculateBearing, calculateKinematics } from './utils';
import { MISSION_STEPS } from './mission';

export default function App() {
  const [tracks, setTracks] = useState<Track[]>(INITIAL_TRACKS);
  const [hookedTrackId, setHookedTrackId] = useState<string | null>(null);
  const [systemTime, setSystemTime] = useState<string>('');
  const [logs, setLogs] = useState<SystemLog[]>([
    { id: 1, time: '16:00:00Z', message: 'SYS: IBCS NODE INITIALIZED', type: 'INFO', acknowledged: true },
    { id: 2, time: '16:00:02Z', message: 'DATALINK LINK-16: ACTIVE', type: 'INFO', acknowledged: true },
    { id: 3, time: '16:00:05Z', message: 'WCS SET TO TIGHT. WEAPONS HOLD.', type: 'WARN', acknowledged: true },
  ]);
  const [cursorPos, setCursorPos] = useState({ mgrs: '40R DQ 0000 0000' });
  const [inventory, setInventory] = useState({ pac3: 32, shorad: 24, thaad: 8 });
  const [defenseCost, setDefenseCost] = useState(0);
  const [enemyCost, setEnemyCost] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [simTime, setSimTime] = useState(0);

  // Force re-render for TTI countdowns
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const addLog = (message: string, type: 'INFO' | 'WARN' | 'ALERT' | 'ACTION' = 'INFO') => {
    const now = new Date();
    const timeStr = now.toISOString().substring(11, 19) + 'Z';
    setLogs(prev => [{ id: Date.now(), time: timeStr, message, type, acknowledged: type !== 'ALERT' }, ...prev].slice(0, 50));
  };

  const unackAlerts = logs.filter(l => !l.acknowledged);

  useEffect(() => {
    const event = MISSION_STEPS.find(e => e.time === simTime);
    if (event) {
      setTracks(current => [...current, ...event.tracks]);
      addLog(event.message, event.type);
      
      // Calculate enemy cost for this wave
      const waveCost = event.tracks.reduce((acc, t) => {
        if (t.category === 'UAS') return acc + 20000; // $20k per drone
        if (t.category === 'CM') return acc + 1500000; // $1.5M per cruise missile
        if (t.category === 'TBM') return acc + 3000000; // $3M per TBM
        return acc;
      }, 0);
      setEnemyCost(prev => prev + waveCost);
    }
  }, [simTime]);

  useEffect(() => {
    const clockTimer = setInterval(() => {
      const now = new Date();
      setSystemTime(now.toISOString().substring(11, 19) + 'Z');
      setSimTime(prev => prev + 1);
    }, 1000);

    const sweepTimer = setInterval(() => {
      setTracks(currentTracks => currentTracks.map(track => {
        const speedFactor = track.spd / 1200; 
        const rad = track.hdg * (Math.PI / 180);
        
        let newX = track.x + Math.sin(rad) * speedFactor;
        let newY = track.y - Math.cos(rad) * speedFactor;

        const isStealthy = track.category === 'UAS' || track.alt < 1000;
        let newTq = track.tq;
        if (isStealthy) {
          newTq = Math.max(1, Math.min(9, track.tq + (Math.random() > 0.5 ? 1 : -1)));
        }
        const coasting = newTq <= 2;

        const rangeToBattery = calculateRange(newX, newY, BATTERY_POS.x, BATTERY_POS.y);
        const radarHorizonNm = 1.23 * (Math.sqrt(100) + Math.sqrt(track.alt)); // Radar at 100ft MSL
        const isDetected = rangeToBattery <= radarHorizonNm;

        const newHistory = [{x: track.x, y: track.y}, ...track.history].slice(0, 15);
        return { ...track, x: newX, y: newY, history: newHistory, tq: newTq, coasting, detected: isDetected };
      }).filter(track => track.x >= -20 && track.x <= 120 && track.y >= -20 && track.y <= 120));
    }, 3000);

    return () => {
      clearInterval(clockTimer);
      clearInterval(sweepTimer);
    };
  }, []);

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    // Simulated MGRS conversion for visual authenticity
    const easting = Math.floor(x * 10000).toString().padStart(4, '0');
    const northing = Math.floor((1 - y) * 10000).toString().padStart(4, '0');
    setCursorPos({ mgrs: `40R DQ ${easting} ${northing}` });
  };

  const hookedTrack = tracks.find(t => t.id === hookedTrackId);

  // --- TACTICAL ACTIONS ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input (though we don't have any yet)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case '1':
          if (hookedTrack) setHookedTrackId(null);
          break;
        case '2':
          if (hookedTrack && (hookedTrack.type === 'PENDING' || hookedTrack.type === 'UNKNOWN')) handleInterrogate();
          break;
        case '3':
          if (hookedTrack && hookedTrack.type !== 'HOSTILE' && hookedTrack.type !== 'FRIEND') handleDeclare('HOSTILE');
          break;
        case '4':
          if (hookedTrack && hookedTrack.type === 'HOSTILE' && hookedTrack.engagedBy === null) handleEngage('THAAD');
          break;
        case '5':
          if (hookedTrack && hookedTrack.type === 'HOSTILE' && hookedTrack.engagedBy === null) handleEngage('PAC-3');
          break;
        case '6':
          if (hookedTrack && hookedTrack.type === 'HOSTILE' && hookedTrack.engagedBy === null) handleEngage('SHORAD');
          break;
        case '7':
          if (unackAlerts.length > 0) handleAckAlerts();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hookedTrack, unackAlerts, inventory]); // Dependencies needed for handlers

  const handleInterrogate = () => {
    if (!hookedTrack) return;
    addLog(`INTERROGATING TRK ${hookedTrack.id}...`, 'ACTION');
    setTimeout(() => {
      const isSweet = hookedTrack.spd > 250 && hookedTrack.alt > 10000;
      setTracks(currentTracks => currentTracks.map(t => t.id === hookedTrack.id ? { ...t, iffInterrogated: true, type: isSweet ? 'ASSUMED_FRIEND' : 'UNKNOWN' } : t));
      if (isSweet) addLog(`TRK ${hookedTrack.id} IFF SWEET (MODE 3/C VALID)`, 'INFO');
      else addLog(`TRK ${hookedTrack.id} IFF SOUR (NO RESPONSE)`, 'WARN');
    }, 1500);
  };

  const handleDeclare = (newType: TrackType) => {
    if (!hookedTrack) return;
    const threatName = newType === 'HOSTILE' ? getThreatName(hookedTrack.category) : undefined;
    setTracks(currentTracks => currentTracks.map(t => t.id === hookedTrack.id ? { ...t, type: newType, threatName } : t));
    addLog(`TRK ${hookedTrack.id} DECLARED ${newType}`, newType === 'HOSTILE' ? 'ALERT' : 'WARN');
  };

  const handleEngage = (weapon: 'PAC-3' | 'SHORAD' | 'THAAD') => {
    if (!hookedTrack) return;

    const stats = WEAPON_STATS[weapon];
    const rng = calculateRange(hookedTrack.x, hookedTrack.y, BATTERY_POS.x, BATTERY_POS.y);

    if (rng > stats.range) {
      addLog(`TRK ${hookedTrack.id} OUT OF RANGE FOR ${weapon} (MAX ${stats.range}NM)`, 'ALERT');
      return;
    }

    if (weapon === 'PAC-3' && inventory.pac3 <= 0) {
      addLog(`PAC-3 MAGAZINE DEPLETED. CANNOT ENGAGE.`, 'ALERT');
      return;
    }
    if (weapon === 'SHORAD' && inventory.shorad <= 0) {
      addLog(`SHORAD MAGAZINE DEPLETED. CANNOT ENGAGE.`, 'ALERT');
      return;
    }

    if (weapon === 'PAC-3') setInventory(prev => ({ ...prev, pac3: prev.pac3 - 1 }));
    if (weapon === 'THAAD') setInventory(prev => ({ ...prev, thaad: prev.thaad - 1 }));
    if (weapon === 'SHORAD') setInventory(prev => ({ ...prev, shorad: prev.shorad - 1 }));
    
    setDefenseCost(prev => prev + stats.cost);

    addLog(`BIRDS AWAY. ENGAGING TRK ${hookedTrack.id} WITH ${weapon}`, 'ACTION');
    
    const interceptTime = Math.max(3000, (rng / 2) * 1000);

    setTracks(current => current.map(t => t.id === hookedTrack.id ? { 
      ...t, 
      engagedBy: weapon,
      engagementTime: Date.now(),
      interceptDuration: interceptTime
    } : t));

    setTimeout(() => {
      setTracks(current => current.filter(t => t.id !== hookedTrack.id));
      setHookedTrackId(currentId => currentId === hookedTrack.id ? null : currentId);
      addLog(`TRK ${hookedTrack.id} SPLASH. TARGET DESTROYED.`, 'INFO');
    }, interceptTime);
  };

  const handleAckAlerts = () => {
    setLogs(currentLogs => currentLogs.map(l => ({ ...l, acknowledged: true })));
  };

  // --- RENDER HELPERS ---

  const renderTrackSymbol = (track: Track) => {
    if (track.detected === false) return null;

    const isHooked = track.id === hookedTrackId;
    let color = '#FFFF00'; // Pure Yellow (Pending/Unknown)
    if (track.type === 'FRIEND' || track.type === 'ASSUMED_FRIEND') color = '#00FFFF'; // Pure Cyan
    if (track.type === 'HOSTILE') color = '#FF0000'; // Pure Red
    if (track.type === 'NEUTRAL') color = '#00FF00'; // Pure Green

    // 2-minute velocity vector (Speed in knots / 60 mins * 2 mins)
    const vectorLength = (track.spd / 60) * 0.5; 
    
    return (
      <g key={`track-group-${track.id}`} className={track.coasting ? 'opacity-50' : 'opacity-100'}>
        {/* Pairing Line & TTI */}
        {track.engagedBy && (
          <g>
            <line 
              x1={BATTERY_POS.x} y1={BATTERY_POS.y} 
              x2={track.x} y2={track.y} 
              stroke={color} strokeWidth="0.2" strokeDasharray="0.5 0.5" 
              className="animate-pulse"
            />
            {track.engagementTime && track.interceptDuration && (
              <text 
                x={(BATTERY_POS.x + track.x) / 2} 
                y={(BATTERY_POS.y + track.y) / 2 - 1} 
                fill={color} 
                fontSize="0.8" 
                fontFamily="monospace" 
                textAnchor="middle"
                style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}
              >
                TTI: {Math.max(0, Math.ceil((track.interceptDuration - (now - track.engagementTime)) / 1000))}s
              </text>
            )}
          </g>
        )}

        {/* Track History Breadcrumbs */}
        {track.history.map((pos, i) => (
          <circle key={`hist-${track.id}-${i}`} cx={pos.x} cy={pos.y} r="0.2" fill={color} opacity={0.8 - (i * 0.05)} />
        ))}
        
        <g 
          transform={`translate(${track.x}, ${track.y})`} 
          onClick={() => setHookedTrackId(track.id)}
          className="cursor-pointer"
        >
          {/* Invisible larger hit area for easier clicking */}
          <circle cx="0" cy="0" r="3" fill="transparent" />

          {/* Hook indicator */}
          {isHooked && (
            <rect x="-1.2" y="-1.2" width="2.4" height="2.4" fill="none" stroke="#00FFFF" strokeWidth="0.15" opacity="0.8" />
          )}
          
          {/* Velocity Leader */}
          <line 
            x1="0" y1="0" 
            x2={Math.sin(track.hdg * Math.PI / 180) * vectorLength} 
            y2={-Math.cos(track.hdg * Math.PI / 180) * vectorLength} 
            stroke={color} strokeWidth="0.15" opacity="0.8"
            strokeDasharray={track.coasting ? "0.5 0.5" : "none"}
          />

          {/* NTDS Air Shapes */}
          <g transform="scale(0.08) translate(-12, -12)" stroke={color} strokeWidth="3" fill="none" style={{ filter: `drop-shadow(0 0 2px ${color})` }} strokeDasharray={track.coasting ? "4 4" : "none"}>
            {(track.type === 'FRIEND' || track.type === 'ASSUMED_FRIEND') && <path d="M 4 14 A 8 8 0 0 1 20 14 Z" />}
            {track.type === 'HOSTILE' && <path d="M 4 14 L 12 4 L 20 14 Z" />}
            {(track.type === 'UNKNOWN' || track.type === 'PENDING' || track.type === 'SUSPECT') && <path d="M 4 14 L 4 8 L 8 4 L 16 4 L 20 8 L 20 14 Z" />}
            {track.type === 'NEUTRAL' && <path d="M 4 14 L 4 4 L 20 4 L 20 14 Z" />}
          </g>

          {/* On-Glass Data Block with Leader Line */}
          {isHooked && (
            <g>
              {/* Leader Line */}
              <line x1="0.8" y1="0.8" x2="2.5" y2="2.5" stroke={color} strokeWidth="0.1" opacity="0.8" />
              <g transform="translate(3, 3)">
                <text x="0" y="0" fill={color} fontSize="0.7" fontFamily="monospace" fontWeight="bold" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>{track.id}</text>
                <text x="0" y="1.0" fill={color} fontSize="0.7" fontFamily="monospace" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>{track.alt >= 18000 ? `FL${Math.round(track.alt/100)}` : Math.round(track.alt/100).toString().padStart(3, '0')} / {track.spd.toString().padStart(3, '0')}</text>
                <text x="0" y="2.0" fill={color} fontSize="0.7" fontFamily="monospace" style={{ textShadow: '1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000' }}>TQ: {track.tq} {track.coasting ? 'CST' : ''}</text>
              </g>
            </g>
          )}
        </g>
      </g>
    );
  };

  let masterWarning = false;
  if (hookedTrack && hookedTrack.type === 'HOSTILE') {
    const { tcpa, cpa } = calculateKinematics(hookedTrack);
    if (tcpa < 120 && parseFloat(cpa) < 10) masterWarning = true;
  }

  return (
    <div className="h-screen w-screen bg-[#00050A] text-[#00E5FF] font-mono flex flex-col overflow-hidden selection:bg-[#004466] relative tabular-nums [font-variant-numeric:slashed-zero]">
      
      {/* --- FULL SCREEN TACTICAL MAP BACKGROUND --- */}
      <div className="absolute inset-0 z-0 flex items-center justify-center overflow-hidden pointer-events-auto" onMouseMove={handleMouseMove}>
        <svg className="absolute inset-0 w-full h-full opacity-80" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
          
          {/* Base Grid */}
          <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#001A26" strokeWidth="0.05"/>
          </pattern>
          <rect width="100" height="100" fill="url(#grid)" />
          
          {/* Defended Area Polygon */}
          <path d="M 45,85 L 35,80 L 40,70 L 55,72 L 60,82 Z" fill="#00FF00" fillOpacity="0.05" stroke="#00FF00" strokeWidth="0.2" strokeDasharray="0.5 0.5" />
          <text x="42" y="78" fill="#00FF00" fontSize="0.6" fontFamily="monospace" opacity="0.4">DEFENDED ASSET</text>

          {/* Radar Sector (FOV Wedge) - 120 degrees looking North */}
          <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y})`}>
            <path d="M 0 0 L -43.3 -75 A 86.6 86.6 0 0 1 43.3 -75 Z" fill="#00FFFF" fillOpacity="0.02" stroke="#00FFFF" strokeWidth="0.1" strokeDasharray="1 2" />
            <line x1="0" y1="0" x2="0" y2="-86.6" stroke="#00FFFF" strokeWidth="0.1" strokeDasharray="2 2" opacity="0.5" /> {/* PTL */}
          </g>

          {/* Concentric Range Rings & Azimuth Lines */}
          <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y})`} stroke="#002B40" strokeWidth="0.1" opacity="0.6">
            {/* Azimuth Lines every 30 degrees */}
            {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map(deg => (
              <line key={`az-${deg}`} x1="0" y1="0" x2={Math.sin(deg * Math.PI / 180) * 100} y2={-Math.cos(deg * Math.PI / 180) * 100} />
            ))}
            {/* Range Rings: 10NM, 20NM, 50NM */}
            <circle cx="0" cy="0" r="10" fill="none" />
            <text x="0" y="-10.5" fill="#002B40" fontSize="0.8" textAnchor="middle">10NM</text>
            <circle cx="0" cy="0" r="20" fill="none" />
            <text x="0" y="-20.5" fill="#002B40" fontSize="0.8" textAnchor="middle">20NM</text>
            <circle cx="0" cy="0" r="50" fill="none" />
            <text x="0" y="-50.5" fill="#002B40" fontSize="0.8" textAnchor="middle">50NM</text>
          </g>

          {/* Bullseye Reference Point */}
          <g transform={`translate(${BULLSEYE_POS.x}, ${BULLSEYE_POS.y})`}>
            <circle cx="0" cy="0" r="1.5" fill="none" stroke="#00FFFF" strokeWidth="0.2" />
            <circle cx="0" cy="0" r="0.2" fill="#00FFFF" />
            <line x1="-2" y1="0" x2="2" y2="0" stroke="#00FFFF" strokeWidth="0.2" />
            <line x1="0" y1="-2" x2="0" y2="2" stroke="#00FFFF" strokeWidth="0.2" />
            <text x="2.5" y="0.5" fill="#00FFFF" fontSize="0.6" fontFamily="monospace" opacity="0.8">BULLSEYE</text>
          </g>

          {/* Battery Position */}
          <g transform={`translate(${BATTERY_POS.x}, ${BATTERY_POS.y})`}>
            <rect x="-0.5" y="-0.5" width="1" height="1" fill="#00FFFF" />
            <text x="1.5" y="0.5" fill="#00FFFF" fontSize="0.8" fontFamily="monospace" opacity="0.8">BATTERY</text>
            
            {/* WEZ Rings */}
            <circle cx="0" cy="0" r="5" fill="none" stroke="#FF0000" strokeWidth="0.1" strokeDasharray="0.2 0.2" />
            <text x="0" y="-5.5" fill="#FF0000" fontSize="0.6" textAnchor="middle" opacity="0.5">SHORAD WEZ</text>
            <circle cx="0" cy="0" r="25" fill="none" stroke="#FFFF00" strokeWidth="0.1" strokeDasharray="0.5 0.5" />
            <text x="0" y="-25.5" fill="#FFFF00" fontSize="0.6" textAnchor="middle" opacity="0.5">PAC-3 WEZ</text>
            <circle cx="0" cy="0" r="100" fill="none" stroke="#FF00FF" strokeWidth="0.1" strokeDasharray="1 1" />
            <text x="0" y="-98" fill="#FF00FF" fontSize="0.6" textAnchor="middle" opacity="0.5">THAAD WEZ</text>
          </g>

          {/* Defended Assets */}
          {DEFENDED_ASSETS.map(asset => (
            <g key={asset.id} transform={`translate(${asset.x}, ${asset.y})`}>
              <rect x="-0.8" y="-0.8" width="1.6" height="1.6" fill="none" stroke="#00E5FF" strokeWidth="0.2" />
              <text x="1.2" y="0.5" fill="#00E5FF" fontSize="0.6" fontFamily="monospace" opacity="0.7">
                {asset.name}
              </text>
            </g>
          ))}

          {tracks.map(renderTrackSymbol)}
        </svg>
      </div>

      {/* --- TOP STATUS BAR --- */}
      <header className={`h-16 bg-[#00050A]/70 backdrop-blur-md border-b ${masterWarning ? 'border-[#FF0033] bg-[#220000]/70' : 'border-[#002B40]'} flex items-center justify-between px-4 z-20 rounded-none transition-colors duration-300 shrink-0`}>
        <div className="flex items-center gap-4 lg:gap-6">
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className={masterWarning ? 'text-[#FF0033]' : 'text-[#00E5FF]'}>[SYS]</span>
            <span className={`text-sm font-bold tracking-widest ${masterWarning ? 'text-[#FF0033] animate-pulse' : 'text-[#00E5FF]'}`}>
              {masterWarning ? 'ALARM: ENGAGEMENT CRITERIA MET' : 'IBCS // C2 NODE'}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] lg:text-xs font-bold tracking-wider border-l border-[#002B40] pl-4 lg:pl-6">
            <span className="text-[#FFCC00] whitespace-nowrap">WCS: <span className="text-[#00E5FF]">TIGHT</span></span>
            <div className="hidden lg:block w-px h-4 bg-[#002B40] mx-1" />
            <span className="text-[#00FF33] whitespace-nowrap">THAAD: <span className="text-[#00E5FF]">{inventory.thaad}/8</span></span>
            <span className="text-[#00FF33] whitespace-nowrap">PAC-3: <span className="text-[#00E5FF]">{inventory.pac3}/32</span></span>
            <span className="text-[#00FF33] whitespace-nowrap">SHORAD: <span className="text-[#00E5FF]">{inventory.shorad}/24</span></span>
            <div className="hidden lg:block w-px h-4 bg-[#002B40] mx-1" />
            <span className="text-[#FFCC00] whitespace-nowrap">DEFENSE COST: <span className="text-[#00E5FF]">${(defenseCost / 1000000).toFixed(2)}M</span></span>
            <span className="text-[#FFCC00] whitespace-nowrap">ENEMY COST: <span className="text-[#FF0033]">${(enemyCost / 1000000).toFixed(2)}M</span></span>
          </div>
        </div>
        <div className="flex items-center gap-4 lg:gap-6 text-[10px] lg:text-xs font-bold whitespace-nowrap">
          {unackAlerts.length > 0 && (
            <div className="bg-[#FF0033] text-[#00050A] px-2 py-1 animate-pulse border border-[#FF0033]">
              {unackAlerts.length} UNACK ALERTS
            </div>
          )}
          <span className="text-[#004466]">MGRS: <span className="text-[#00E5FF]">{cursorPos.mgrs}</span></span>
          <span className="text-[#00E5FF]">ZULU: <span className="text-[#00E5FF]">{systemTime}</span></span>
        </div>
      </header>

      {/* --- MAIN CONTENT AREA --- */}
      <main className="flex-1 flex justify-between p-4 z-20 pointer-events-none overflow-hidden">
        
        {/* LEFT PANEL: Track List & Logs */}
        <div className="flex flex-col gap-4 w-[280px] pointer-events-auto h-full">
          
          {/* Track Summary Table */}
          <aside className="flex-1 bg-[#001A26]/20 backdrop-blur-md border border-[#002B40] flex flex-col min-h-0">
            <div className="bg-[#001A26]/20 px-3 py-2 border-b border-[#002B40] flex items-center gap-2 shrink-0">
              <span className="text-[#00E5FF] font-bold">[TRK]</span>
              <h2 className="text-xs font-bold text-[#00E5FF] tracking-widest">TRACK SUMMARY</h2>
            </div>
            <div className="flex-1 overflow-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <table className="w-full text-[10px] text-left">
                <thead className="text-[#004466] sticky top-0 bg-[#00050A]/50 border-b border-[#002B40] backdrop-blur-md">
                  <tr>
                    <th className="py-2 px-3 font-normal">TRK</th>
                    <th className="py-2 px-2 font-normal">TYPE</th>
                    <th className="py-2 px-2 font-normal">CAT</th>
                    <th className="py-2 px-2 font-normal text-right">RNG</th>
                    <th className="py-2 px-3 font-normal text-right">ALT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#001A26]">
                  {tracks.filter(t => t.detected !== false).map(t => {
                    const range = calculateRange(t.x, t.y, BATTERY_POS.x, BATTERY_POS.y).toFixed(1);
                    const isHooked = t.id === hookedTrackId;
                    let typeColor = 'text-[#FFFF00]';
                    if (t.type === 'FRIEND' || t.type === 'ASSUMED_FRIEND') typeColor = 'text-[#00FFFF]';
                    if (t.type === 'HOSTILE') typeColor = 'text-[#FF0000]';
                    if (t.type === 'NEUTRAL') typeColor = 'text-[#00FF00]';

                    return (
                      <tr 
                        key={t.id} 
                        className={`cursor-pointer hover:bg-[#001A26] transition-colors ${isHooked ? 'bg-[#002B40] outline outline-1 outline-[#00E5FF]' : ''} ${t.coasting ? 'opacity-50' : ''}`}
                        onClick={() => setHookedTrackId(t.id)}
                      >
                        <td className="py-2 px-3 font-bold text-[#00E5FF]">{t.id}</td>
                        <td className={`py-2 px-2 font-bold ${typeColor}`}>{t.threatName ? t.threatName.substring(0, 4).toUpperCase() : t.type.substring(0, 4)}</td>
                        <td className="py-2 px-2 text-[#00E5FF]">{t.category}</td>
                        <td className="py-2 px-2 text-[#00E5FF] text-right">{range.padStart(4, '0')}</td>
                        <td className="py-2 px-3 text-[#00E5FF] text-right">{t.alt >= 18000 ? `FL${Math.round(t.alt/100)}` : Math.round(t.alt/100).toString().padStart(3, '0')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </aside>

          {/* System Event Log */}
          <aside className="h-48 bg-[#001A26]/20 backdrop-blur-md border border-[#002B40] flex flex-col shrink-0">
            <div className="bg-[#001A26]/20 px-3 py-2 border-b border-[#002B40] flex items-center gap-2 shrink-0">
              <span className="text-[#00E5FF] font-bold">[LOG]</span>
              <h2 className="text-xs font-bold text-[#00E5FF] tracking-widest">SYSTEM EVENT LOG</h2>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-1.5 flex flex-col-reverse [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              {logs.map((log) => (
                <div key={log.id} className={`text-[10px] flex gap-3 ${!log.acknowledged ? 'bg-[#FF0033]/20 border border-[#FF0033] p-1' : ''}`}>
                  <span className="text-[#004466] shrink-0">{log.time}</span>
                  <span className={`${
                    log.type === 'ALERT' ? 'text-[#FF0033] font-bold' :
                    log.type === 'ACTION' ? 'text-[#00E5FF] font-bold' :
                    log.type === 'WARN' ? 'text-[#FFCC00]' : 'text-[#00E5FF]'
                  }`}>{log.message}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>

        {/* RIGHT PANEL: Tote (Hooked Track Data) */}
        <aside className={`w-[300px] bg-[#001A26]/20 backdrop-blur-md border ${masterWarning ? 'border-[#FF0033]' : 'border-[#002B40]'} flex flex-col pointer-events-auto transition-colors duration-300 h-fit`}>
          <div className={`px-3 py-2 border-b ${masterWarning ? 'bg-[#440000]/20 border-[#FF0033]' : 'bg-[#001A26]/20 border-[#002B40]'} flex items-center gap-2 shrink-0`}>
            <span className={masterWarning ? 'text-[#FF0033] font-bold' : 'text-[#00E5FF] font-bold'}>[DATA]</span>
            <h2 className={`text-xs font-bold tracking-widest ${masterWarning ? 'text-[#FF0033]' : 'text-[#00E5FF]'}`}>HOOKED TRACK DATA</h2>
          </div>
          
          <div className="p-4 flex flex-col gap-4">
            {hookedTrack ? (
              <>
                {/* Header Block */}
                <div className="border border-[#002B40] bg-[#000A14]/30 p-3 flex justify-between items-center">
                  <span className="text-2xl font-bold text-[#00E5FF] tracking-wider">{hookedTrack.id}</span>
                  <span className={`px-2 py-1 text-xs font-bold border ${
                    (hookedTrack.type === 'FRIEND' || hookedTrack.type === 'ASSUMED_FRIEND') ? 'border-[#00FFFF] text-[#00FFFF] bg-[#00FFFF]/10' :
                    hookedTrack.type === 'HOSTILE' ? 'border-[#FF0000] text-[#FF0000] bg-[#FF0000]/10 animate-pulse' :
                    hookedTrack.type === 'NEUTRAL' ? 'border-[#00FF00] text-[#00FF00] bg-[#00FF00]/10' :
                    'border-[#FFFF00] text-[#FFFF00] bg-[#FFFF00]/10'
                  }`}>
                    {hookedTrack.threatName || hookedTrack.type}
                  </span>
                </div>

                {/* Strict Data Grid */}
                <div className="border border-[#002B40] bg-[#000A14]/30">
                  <div className="grid grid-cols-2 text-xs">
                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">CAT</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold">{hookedTrack.category}</div>
                    
                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">ALT (FT)</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold">
                      {hookedTrack.alt >= 18000 ? `FL${Math.round(hookedTrack.alt/100)}` : hookedTrack.alt.toString().padStart(5, '0')}
                    </div>
                    
                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">SPD (KTS)</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold">{hookedTrack.spd.toString().padStart(4, '0')}</div>
                    
                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">CSE (DEG)</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold">{hookedTrack.hdg.toString().padStart(3, '0')}</div>

                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">BRG (DEG)</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold">
                      {calculateBearing(hookedTrack.x, hookedTrack.y, BATTERY_POS.x, BATTERY_POS.y).toString().padStart(3, '0')}
                    </div>
                    
                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">RNG (NM)</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold">
                      {calculateRange(hookedTrack.x, hookedTrack.y, BATTERY_POS.x, BATTERY_POS.y).toFixed(1).padStart(4, '0')}
                    </div>

                    {/* Bullseye Reference */}
                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">BULLSEYE</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#00FFFF] font-bold">
                      {calculateBearing(hookedTrack.x, hookedTrack.y, BULLSEYE_POS.x, BULLSEYE_POS.y).toString().padStart(3, '0')} / {calculateRange(hookedTrack.x, hookedTrack.y, BULLSEYE_POS.x, BULLSEYE_POS.y).toFixed(0).padStart(3, '0')}
                    </div>

                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466]">SRC</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#00E5FF] font-bold">{hookedTrack.sensor}</div>

                    {/* Advanced Kinematics */}
                    <div className="border-b border-r border-[#002B40] p-2 text-[#004466] bg-[#00111A]/50">CPA (NM)</div>
                    <div className="border-b border-[#002B40] p-2 text-right text-[#FFFF00] font-bold bg-[#00111A]/50">
                      {calculateKinematics(hookedTrack).cpa.padStart(4, '0')}
                    </div>

                    <div className="border-r border-[#002B40] p-2 text-[#004466] bg-[#00111A]/50">TCPA (SEC)</div>
                    <div className={`p-2 text-right font-bold bg-[#00111A]/50 ${calculateKinematics(hookedTrack).tcpa < 120 ? 'text-[#FF0000] animate-pulse' : 'text-[#FFFF00]'}`}>
                      {calculateKinematics(hookedTrack).tcpa.toString().padStart(4, '0')}
                    </div>
                  </div>
                </div>

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
              <div className="h-48 flex flex-col items-center justify-center text-[#002B40] space-y-4">
                <div className="text-4xl font-light opacity-50">[ ]</div>
                <p className="text-xs tracking-widest">NO TRACK HOOKED</p>
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* --- BOTTOM SOFT KEY BAR --- */}
      <footer className="h-16 bg-[#00050A]/95 border-t border-[#002B40] flex items-center px-2 lg:px-4 gap-1 lg:gap-2 z-20 shrink-0 pointer-events-auto overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        <div className="text-[#004466] text-[10px] font-bold mr-2 lg:mr-4 whitespace-nowrap">OSD / SOFT KEYS</div>
        
        <button 
          className="h-10 px-2 lg:px-4 bg-[#001A26] border border-[#004466] hover:bg-[#002B40] text-[#00E5FF] text-[10px] lg:text-xs font-bold tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap"
          disabled={!hookedTrack}
          onClick={() => setHookedTrackId(null)}
        >
          <span className="text-[8px] text-[#004466] mb-0.5">1</span>
          DROP
        </button>

        <button 
          className="h-10 px-2 lg:px-4 bg-[#001A26] border border-[#004466] hover:bg-[#002B40] text-[#00E5FF] text-[10px] lg:text-xs font-bold tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap"
          disabled={!hookedTrack || (hookedTrack.type !== 'PENDING' && hookedTrack.type !== 'UNKNOWN')}
          onClick={handleInterrogate}
        >
          <span className="text-[8px] text-[#004466] mb-0.5">2</span>
          IFF
        </button>

        <button 
          className="h-10 px-2 lg:px-4 bg-[#001A26] border border-[#004466] hover:bg-[#002B40] text-[#00E5FF] text-[10px] lg:text-xs font-bold tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap"
          disabled={!hookedTrack || hookedTrack.type === 'HOSTILE' || hookedTrack.type === 'FRIEND'}
          onClick={() => handleDeclare('HOSTILE')}
        >
          <span className="text-[8px] text-[#004466] mb-0.5">3</span>
          DECL HOSTILE
        </button>

        <button 
          className="h-10 px-2 lg:px-4 bg-[#330033] border border-[#FF00FF] hover:bg-[#440033] text-[#FF00FF] text-[10px] lg:text-xs font-bold tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center ml-auto whitespace-nowrap"
          disabled={!hookedTrack || hookedTrack.type !== 'HOSTILE' || hookedTrack.engagedBy !== null}
          onClick={() => handleEngage('THAAD')}
        >
          <span className="text-[8px] text-[#FF00FF] opacity-50 mb-0.5">4</span>
          ENGAGE THAAD
        </button>

        <button 
          className="h-10 px-2 lg:px-4 bg-[#330000] border border-[#FF0033] hover:bg-[#440000] text-[#FF0033] text-[10px] lg:text-xs font-bold tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap"
          disabled={!hookedTrack || hookedTrack.type !== 'HOSTILE' || hookedTrack.engagedBy !== null}
          onClick={() => handleEngage('PAC-3')}
        >
          <span className="text-[8px] text-[#FF0033] opacity-50 mb-0.5">5</span>
          ENGAGE PAC-3
        </button>

        <button 
          className="h-10 px-2 lg:px-4 bg-[#222200] border border-[#FFCC00] hover:bg-[#333300] text-[#FFCC00] text-[10px] lg:text-xs font-bold tracking-widest transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center whitespace-nowrap"
          disabled={!hookedTrack || hookedTrack.type !== 'HOSTILE' || hookedTrack.engagedBy !== null}
          onClick={() => handleEngage('SHORAD')}
        >
          <span className="text-[8px] text-[#FFCC00] opacity-50 mb-0.5">6</span>
          ENGAGE SHORAD
        </button>

        <div className="w-px h-8 bg-[#002B40] mx-1 lg:mx-2 shrink-0" />

        <button 
          className={`h-10 px-2 lg:px-4 border text-[10px] lg:text-xs font-bold tracking-widest transition-colors flex flex-col items-center justify-center whitespace-nowrap shrink-0 ${
            unackAlerts.length > 0 
              ? 'bg-[#FF0033] border-[#FF0033] text-[#00050A] hover:bg-[#CC0022]' 
              : 'bg-[#001A26] border-[#004466] text-[#004466] cursor-not-allowed'
          }`}
          disabled={unackAlerts.length === 0}
          onClick={handleAckAlerts}
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
