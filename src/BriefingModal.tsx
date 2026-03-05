import React, { useState, useEffect } from 'react';

const BriefingModal = ({ onStart }: { onStart: () => void }) => {
  const [localTime, setLocalTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setLocalTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Format local user time
  const userTimeStr = localTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const userDateStr = localTime.toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  // Calculate Gulf Standard Time (GST is UTC+4)
  const utc = localTime.getTime() + (localTime.getTimezoneOffset() * 60000);
  const gstDate = new Date(utc + (3600000 * 4));
  const gstTimeStr = gstDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const gstDateStr = gstDate.toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

  // Zulu Time
  const zuluTimeStr = localTime.toISOString().substring(11, 19) + 'Z';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#00050A]/90 backdrop-blur-sm p-4 text-[#00E5FF] font-mono">
      
      <div className="max-w-2xl w-full border border-[#004466] bg-[#001A26]/80 flex flex-col shadow-2xl shadow-[#00E5FF]/10">
        
        {/* Header */}
        <div className="bg-[#002B40] px-4 py-2 border-b border-[#004466] flex justify-between items-center">
          <span className="font-bold tracking-widest text-xs">JOINT INTEGRATED AIR & MISSILE DEFENSE (JIAMD)</span>
          <span className="text-[#00FFFF] text-[10px] animate-pulse">CLASSIFIED // NOFORN</span>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          
          <div className="grid grid-cols-3 gap-4 border-b border-[#004466]/50 pb-4 text-xs">
            <div>
              <div className="text-[#004466] mb-1">LOCAL TERMINAL</div>
              <div className="text-base lg:text-lg">{userTimeStr}</div>
              <div className="opacity-70 text-[10px]">{userDateStr}</div>
            </div>
            <div>
              <div className="text-[#004466] mb-1 text-center">SECTOR (GST)</div>
              <div className="text-base lg:text-lg text-[#FFCC00] text-center">{gstTimeStr}</div>
              <div className="opacity-70 text-[#FFCC00]/70 text-[10px] text-center">{gstDateStr}</div>
            </div>
            <div>
              <div className="text-[#004466] mb-1 text-right">ZULU (UTC)</div>
              <div className="text-base lg:text-lg text-right">{zuluTimeStr}</div>
              <div className="opacity-70 text-[10px] text-right">GLOBAL REF</div>
            </div>
          </div>

          <div className="space-y-4 text-sm leading-relaxed">
            <p>
              <span className="text-[#00FFFF] font-bold">SITUATION:</span> You are assuming the shift as Tactical Director for the UAE Northern Emirates Air Defense Sector. Regional batteries have been on high alert for 72 hours. It has been quiet for the past 6 hours, with civilian air traffic operating normally along the Gulf corridor.
            </p>
            <p>
              <span className="text-[#FF0033] font-bold">THREAT UPDATE:</span> Intelligence indicates a high probability of a coordinated, multi-domain strike by non-state actors targeting critical infrastructure in Dubai (Port Rashid, DWC, Burj Khalifa).
            </p>
            
            <div className="bg-[#00050A]/50 p-4 border border-[#004466]">
              <h3 className="text-[#00FFFF] font-bold mb-2">RULES OF ENGAGEMENT (ROE):</h3>
              <ul className="list-disc pl-5 space-y-1 text-xs opacity-90">
                <li><strong className="text-[#FFCC00]">WEAPONS CONTROL STATUS (WCS) IS TIGHT:</strong> Fire only at targets positively identified as <span className="text-[#FF0033]">HOSTILE</span>.</li>
                <li>Do not fire terminal interceptors (TAMIR/IRON DOME) at manned aircraft or exospheric ballistics.</li>
                <li><strong className="text-[#FFCC00]">CONSERVATION OF FIRES:</strong> You have a limited magazine. Do not waste $4.5M PAC-3 missiles on $20K commercial drones. Use your layered defense.</li>
              </ul>
            </div>

            <div className="bg-[#00050A]/50 p-4 border border-[#004466]">
              <h3 className="text-[#00FFFF] font-bold mb-2">TERMINAL CONTROLS:</h3>
              <div className="grid grid-cols-2 gap-2 text-xs opacity-90">
                <div><span className="text-[#FFCC00]">CLICK Track:</span> Hook target data</div>
                <div><span className="text-[#FFCC00]">SHIFT + DRAG:</span> Box select group</div>
                <div><span className="text-[#FFCC00]">CLICK Empty Space:</span> Drop selection</div>
                <div><span className="text-[#FFCC00]">KEYS 1-7:</span> OSD Soft Key shortcuts</div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 bg-[#00111A] border-t border-[#004466] flex justify-end">
          <button 
            onClick={onStart}
            className="px-6 py-2 bg-[#002B40] text-[#00E5FF] border border-[#00E5FF] font-bold tracking-widest hover:bg-[#00E5FF] hover:text-[#00050A] transition-colors"
          >
            ACKNOWLEDGE & START SHIFT
          </button>
        </div>

      </div>
    </div>
  );
};

export default BriefingModal;