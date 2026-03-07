import React from 'react';
import { useTrackStore } from './store';

const MAX_MUNITIONS: Record<string, number | null> = {
  'PAC-3': 32,
  'TAMIR': 120,
  'THAAD': 8,
  'AMRAAM': 16,
  'C-RAM': null
};

const AfterActionReport = () => {
  const interceptorsFired = useTrackStore(state => state.interceptorsFired);
  const leakerCount = useTrackStore(state => state.leakerCount);
  const defenseCost = useTrackStore(state => state.defenseCost);
  const enemyCost = useTrackStore(state => state.enemyCost);

  const survivalRate = leakerCount === 0 ? 100 : Math.max(0, 100 - (leakerCount * 15));
  const totalFired = Object.values(interceptorsFired).reduce((a, b) => a + b, 0);
  
  const primaryFired = (interceptorsFired['TAMIR'] || 0) + (interceptorsFired['PAC-3'] || 0) + (interceptorsFired['THAAD'] || 0);
  const depletionRate = Math.min(100, Math.round((primaryFired / 160) * 100));

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#00050A]/95 lg:backdrop-blur-md p-4 text-[#00E5FF] font-mono">
      <div className="max-w-5xl w-full border border-[#004466] bg-[#001A26]/90 flex flex-col shadow-2xl shadow-[#00E5FF]/20 overflow-hidden h-full max-h-[90vh] relative">
        <div className="absolute inset-0 crt-overlay opacity-20 pointer-events-none z-50" />
        
        {/* Header */}
        <div className="bg-[#002B40] px-6 py-4 border-b border-[#004466] flex justify-between items-center shrink-0">
          <div className="flex flex-col">
            <span className="font-bold tracking-widest text-xl">AFTER ACTION REPORT (AAR)</span>
            <span className="text-[10px] opacity-70 uppercase tracking-widest text-[#00FFFF]">Operation Desert Shield // Post-Mission Analysis</span>
          </div>
          <div className={`px-4 py-2 border-2 font-bold text-lg tracking-widest ${survivalRate > 70 ? 'border-[#00FF33] text-[#00FF33] bg-[#00FF33]/10 shadow-[0_0_15px_rgba(0,255,51,0.2)]' : 'border-[#FF0033] text-[#FF0033] bg-[#FF0033]/10 shadow-[0_0_15px_rgba(255,0,51,0.2)]'}`}>
            MISSION {survivalRate > 70 ? 'SUCCESS' : 'FAILURE'}
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 md:p-8 flex flex-col gap-8 overflow-y-auto custom-scrollbar flex-1">
          
          {/* Top Key Metrics Row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="border border-[#004466]/50 bg-[#00050A]/60 p-4 flex flex-col justify-between relative overflow-hidden">
              <div className="text-[10px] text-[#004466] uppercase font-bold tracking-wider mb-2 z-10">Defense Rating</div>
              <div className="text-4xl font-bold z-10">{survivalRate}%</div>
              <div className="absolute bottom-0 left-0 h-1 bg-[#00FF33] transition-all duration-1000" style={{ width: `${survivalRate}%` }} />
            </div>
            
            <div className="border border-[#004466]/50 bg-[#00050A]/60 p-4 flex flex-col justify-between">
              <div className="text-[10px] text-[#004466] uppercase font-bold tracking-wider mb-2">Total Leakers</div>
              <div className={`text-4xl font-bold ${leakerCount > 0 ? 'text-[#FF0033]' : 'text-[#00FF33]'}`}>{leakerCount}</div>
            </div>

            <div className="border border-[#004466]/50 bg-[#00050A]/60 p-4 flex flex-col justify-between">
              <div className="text-[10px] text-[#004466] uppercase font-bold tracking-wider mb-2">Defense Expenditure</div>
              <div className="text-3xl font-bold text-[#FF0033]">${(defenseCost / 1000000).toFixed(2)}M</div>
            </div>

            <div className="border border-[#004466]/50 bg-[#00050A]/60 p-4 flex flex-col justify-between">
              <div className="text-[10px] text-[#004466] uppercase font-bold tracking-wider mb-2">Enemy Threat Value</div>
              <div className="text-3xl font-bold text-[#00FF33]">${(enemyCost / 1000000).toFixed(2)}M</div>
            </div>
          </div>

          {/* Asymmetric Economic Analysis Warning */}
          {(defenseCost > 0 && enemyCost > 0) ? (
            <div className="bg-[#FFCC00]/10 p-4 border border-[#FFCC00]/30 flex items-center gap-4">
              <div className="text-[#FFCC00] text-3xl font-bold px-2">⚠️</div>
              <div className="text-sm leading-relaxed text-[#FFCC00]">
                <span className="font-bold uppercase tracking-wider">Strategic Asymmetry Detected:</span> You spent <span className="underline font-bold">${(defenseCost / enemyCost).toFixed(1)}x</span> more on defense than the enemy spent on the attack. This represents the primary economic challenge of modern autonomous warfare.
              </div>
            </div>
          ) : null}

          {/* Munitions Section */}
          <div className="flex flex-col gap-4 flex-1">
            <div className="flex justify-between items-end border-b border-[#004466] pb-2">
              <h3 className="text-[#00FFFF] font-bold text-sm tracking-widest uppercase">Munitions Expended & Magazine Status</h3>
              <div className="text-xs hidden sm:block">
                <span className="opacity-70">Total Fired: </span>
                <span className="font-bold text-[#00FFFF]">{totalFired}</span>
                <span className="mx-2 opacity-30">|</span>
                <span className="opacity-70">Magazine Depletion: </span>
                <span className={`font-bold ${depletionRate > 80 ? 'text-[#FF0033]' : depletionRate > 50 ? 'text-[#FFCC00]' : 'text-[#00FF33]'}`}>
                  {depletionRate}%
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
              {Object.entries(interceptorsFired).map(([type, count]) => {
                const max = MAX_MUNITIONS[type];
                const pct = max ? Math.min(100, (count / max) * 100) : 0;
                
                return (
                  <div key={type} className="border border-[#004466]/40 bg-[#00050A]/50 p-4 flex flex-col relative overflow-hidden group">
                    <div className="text-[10px] text-[#004466] font-bold tracking-wider mb-3 group-hover:text-[#00FFFF] transition-colors">{type}</div>
                    
                    <div className="flex items-end justify-between z-10 mb-2">
                      <div className="text-3xl font-bold">{count}</div>
                      <div className="text-xs opacity-50 mb-1">/ {max || '∞'}</div>
                    </div>

                    <div className="w-full bg-[#001A26] h-1.5 mt-auto z-10">
                      <div 
                        className={`h-full transition-all duration-1000 ${pct > 80 ? 'bg-[#FF0033]' : pct > 50 ? 'bg-[#FFCC00]' : 'bg-[#00FF33]'}`} 
                        style={{ width: max ? `${pct}%` : '100%', opacity: max ? 1 : 0.2 }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 bg-[#00111A] border-t border-[#004466] flex flex-col items-center gap-6 shrink-0">
          <div className="flex flex-col sm:flex-row justify-center gap-4 sm:gap-12 w-full">
             <div className="text-center text-[10px] tracking-widest text-[#00E5FF]/50 hover:text-[#00E5FF] transition-colors">
               SYS.ARCHITECT <br className="hidden sm:block" />
               <a href="https://builtbyvibes.com" target="_blank" rel="noopener noreferrer" className="font-bold hover:text-[#00FF33] transition-colors">BUILTBYVIBES.COM</a>
             </div>
             <div className="text-center text-[10px] tracking-widest text-[#00E5FF]/50 hover:text-[#00E5FF] transition-colors">
               SYS.COMMUNICATIONS <br className="hidden sm:block" />
               <a href="https://twitter.com/arethevibesoff" target="_blank" rel="noopener noreferrer" className="font-bold hover:text-[#00FF33] transition-colors">@ARETHEVIBESOFF</a>
             </div>
          </div>
          
          <button 
            onClick={() => window.location.reload()}
            className="w-full max-w-md py-4 bg-[#00FF33]/10 text-[#00FF33] border-2 border-[#00FF33] font-bold tracking-[0.3em] hover:bg-[#00FF33] hover:text-[#00050A] hover:shadow-[0_0_20px_rgba(0,255,51,0.4)] transition-all uppercase text-sm"
          >
            Acknowledge & Finalize Shift
          </button>
        </div>

      </div>
    </div>
  );
};

export default AfterActionReport;
