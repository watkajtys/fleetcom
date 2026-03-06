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
      
      <div className="max-w-2xl w-full max-h-[90vh] border border-[#004466] bg-[#001A26]/80 flex flex-col shadow-2xl shadow-[#00E5FF]/10">
        
        {/* Header */}
        <div className="bg-[#002B40] px-4 py-2 border-b border-[#004466] flex justify-between items-center shrink-0">
          <span className="font-bold tracking-widest text-xs">JOINT INTEGRATED AIR & MISSILE DEFENSE (JIAMD)</span>
        </div>

        {/* Content */}
        <div className="p-4 md:p-6 space-y-6 overflow-y-auto custom-scrollbar flex-1">
          
          <div className="flex justify-between items-start border-b border-[#004466]/50 pb-4 text-xs">
            <div className="text-left">
              <div className="text-[#004466] mb-1 text-[8px] md:text-xs">LOCAL</div>
              <div className="text-sm md:text-lg">{userTimeStr}</div>
              <div className="opacity-70 text-[8px] md:text-[10px]">{userDateStr}</div>
            </div>
            <div className="text-center">
              <div className="text-[#004466] mb-1 text-[8px] md:text-xs">SECTOR (GST)</div>
              <div className="text-sm md:text-lg text-[#FFCC00]">{gstTimeStr}</div>
              <div className="opacity-70 text-[#FFCC00]/70 text-[8px] md:text-[10px]">{gstDateStr}</div>
            </div>
            <div className="text-right">
              <div className="text-[#004466] mb-1 text-[8px] md:text-xs">ZULU (UTC)</div>
              <div className="text-sm md:text-lg">{zuluTimeStr}</div>
              <div className="opacity-70 text-[8px] md:text-[10px]">GLOBAL REF</div>
            </div>
          </div>

          <div className="space-y-4 text-sm leading-relaxed">
            <p>
              <span className="text-[#00FFFF] font-bold">SITUATION:</span> You are assuming the shift as Tactical Director for the UAE Northern Emirates Air Defense Sector. Regional batteries have been on high alert for 72 hours. It has been quiet for the past 6 hours, with civilian air traffic operating normally along the Gulf corridor.
            </p>
            <p>
              <span className="text-[#FF0033] font-bold">THREAT UPDATE:</span> Intelligence indicates a high probability of a coordinated, multi-domain strike by non-state actors targeting critical infrastructure in Dubai (Port Rashid, DWC, Burj Khalifa).
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#00050A]/50 p-4 border border-[#004466]">
                <h3 className="text-[#00FFFF] font-bold text-[10px] mb-2 uppercase tracking-tighter">Interceptor Catalog // Economic Profile</h3>
                <div className="space-y-2 text-[10px]">
                  <div className="flex justify-between border-b border-[#004466]/30 pb-1">
                    <span className="text-[#FF00FF]">THAAD (T1)</span>
                    <span className="text-[#00E5FF]">$13,000,000</span>
                  </div>
                  <div className="flex justify-between border-b border-[#004466]/30 pb-1">
                    <span className="text-[#FF0033]">PAC-3 MSE (T2)</span>
                    <span className="text-[#00E5FF]">$4,500,000</span>
                  </div>
                  <div className="flex justify-between border-b border-[#004466]/30 pb-1">
                    <span className="text-[#FFCC00]">TAMIR (T3)</span>
                    <span className="text-[#00E5FF]">$50,000</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#00FF33]">C-RAM (T4)</span>
                    <span className="text-[#00E5FF]">$500</span>
                  </div>
                </div>
                <div className="mt-3 text-[9px] text-[#FFCC00] leading-tight italic opacity-80">
                  Note: Strategic failure occurs if defense cost exceeds political threshold. Prioritize layered attrition.
                </div>
              </div>

              <div className="bg-[#00050A]/50 p-4 border border-[#004466]">
                <h3 className="text-[#00FFFF] font-bold text-[10px] mb-2 uppercase tracking-tighter">OSD Soft Keys // Terminal Access</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[10px]">
                  <div className="flex gap-2">
                    <span className="bg-[#004466] text-[#00E5FF] px-1 font-bold min-w-[12px] text-center">1</span>
                    <span className="opacity-80">DROP</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="bg-[#004466] text-[#00E5FF] px-1 font-bold min-w-[12px] text-center">2</span>
                    <span className="opacity-80">IFF</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="bg-[#004466] text-[#00E5FF] px-1 font-bold min-w-[12px] text-center">3</span>
                    <span className="opacity-80">DECLARE</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="bg-[#004466] text-[#FF00FF] px-1 font-bold min-w-[12px] text-center">4</span>
                    <span className="opacity-80 font-bold">THAAD</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="bg-[#004466] text-[#FF0033] px-1 font-bold min-w-[12px] text-center">5</span>
                    <span className="opacity-80 font-bold">PAC-3</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="bg-[#004466] text-[#FFCC00] px-1 font-bold min-w-[12px] text-center">6</span>
                    <span className="opacity-80 font-bold">TAMIR</span>
                  </div>
                  <div className="flex gap-2 col-span-2 mt-1 border-t border-[#004466]/30 pt-1.5">
                    <span className="text-[#FFCC00] font-bold">[SPACE]</span>
                    <span className="opacity-80">PAUSE SIMULATION</span>
                  </div>
                  <div className="flex gap-2 col-span-2">
                    <span className="text-[#FFCC00] font-bold">[SHIFT+DRAG]</span>
                    <span className="opacity-80">MULTI-HOOK</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 bg-[#00111A] border-t border-[#004466] flex flex-col sm:flex-row justify-between items-center gap-4 sm:gap-0">
          <div className="text-[10px] text-[#00E5FF]/50 tracking-widest font-mono text-center sm:text-left">
            <a href="https://builtbyvibes.com" target="_blank" rel="noopener noreferrer" className="text-[#00E5FF] font-bold hover:text-[#00FF33] transition-colors">BUILTBYVIBES</a>
            {' // '}
            <a href="https://twitter.com/arethevibesoff" target="_blank" rel="noopener noreferrer" className="text-[#00E5FF] font-bold hover:text-[#00FF33] transition-colors">@ARETHEVIBESOFF</a>
          </div>
          <button 
            onClick={onStart}
            className="w-full sm:w-auto px-6 py-2 bg-[#002B40] text-[#00E5FF] border border-[#00E5FF] font-bold tracking-widest hover:bg-[#00E5FF] hover:text-[#00050A] transition-colors"
          >
            ACKNOWLEDGE & INITIALIZE NODE
          </button>
        </div>

      </div>
    </div>
  );
};

export default BriefingModal;