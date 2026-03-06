import React from 'react';
import { DEFENDED_ASSETS } from './constants';
import { useTrackStore } from './store';

const AfterActionReport = () => {
  const interceptorsFired = useTrackStore(state => state.interceptorsFired);
  const leakerCount = useTrackStore(state => state.leakerCount);
  const defenseCost = useTrackStore(state => state.defenseCost);
  const enemyCost = useTrackStore(state => state.enemyCost);

  const survivalRate = leakerCount === 0 ? 100 : Math.max(0, 100 - (leakerCount * 15));

  const totalFired = Object.values(interceptorsFired).reduce((a, b) => a + b, 0);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[#00050A]/95 backdrop-blur-md p-4 text-[#00E5FF] font-mono">
      <div className="max-w-3xl w-full border border-[#004466] bg-[#001A26]/90 flex flex-col shadow-2xl shadow-[#00E5FF]/20 overflow-hidden">
        
        {/* Header */}
        <div className="bg-[#002B40] px-6 py-4 border-b border-[#004466] flex justify-between items-center">
          <div className="flex flex-col">
            <span className="font-bold tracking-widest text-lg">AFTER ACTION REPORT (AAR)</span>
            <span className="text-[10px] opacity-70 uppercase">Operation Desert Shield // Post-Mission Analysis</span>
          </div>
          <div className={`px-3 py-1 border font-bold text-sm ${survivalRate > 70 ? 'border-[#00FF33] text-[#00FF33]' : 'border-[#FF0033] text-[#FF0033]'}`}>
            MISSION STATUS: {survivalRate > 70 ? 'SUCCESS' : 'FAILURE'}
          </div>
        </div>

        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8 overflow-auto max-h-[80vh]">
          
          {/* Left Column: Combat Stats */}
          <div className="space-y-6">
            <section>
              <h3 className="text-[#00FFFF] font-bold border-b border-[#004466] mb-3 pb-1 text-xs tracking-tighter uppercase">Defensive Performance</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <span className="text-xs opacity-70 uppercase text-[#004466]">Defense Rating</span>
                  <span className="text-2xl font-bold">{survivalRate}%</span>
                </div>
                <div className="w-full bg-[#00050A] h-2 rounded-full overflow-hidden">
                  <div className="h-full bg-[#00FF33] transition-all duration-1000" style={{ width: `${survivalRate}%` }} />
                </div>
                
                <div className="flex justify-between items-center text-xs">
                  <span className="opacity-70">Total Leakers Impacted</span>
                  <span className={leakerCount > 0 ? 'text-[#FF0033] font-bold' : 'text-[#00FF33]'}>{leakerCount}</span>
                </div>

                <div className="flex justify-between items-center text-xs border-t border-[#004466]/30 pt-3 mt-3">
                  <span className="opacity-70">Magazine Depletion</span>
                  {(() => {
                    const primaryFired = (interceptorsFired['TAMIR'] || 0) + (interceptorsFired['PAC-3'] || 0) + (interceptorsFired['THAAD'] || 0);
                    const depletionRate = Math.min(100, Math.round((primaryFired / 160) * 100));
                    return (
                      <span className={`font-bold ${depletionRate > 80 ? 'text-[#FF0033]' : depletionRate > 50 ? 'text-[#FFCC00]' : 'text-[#00FF33]'}`}>
                        {depletionRate}% ({primaryFired}/160)
                      </span>
                    );
                  })()}
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[#00FFFF] font-bold border-b border-[#004466] mb-3 pb-1 text-xs tracking-tighter uppercase">Munitions Expended</h3>
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(interceptorsFired).map(([type, count]) => (
                  <div key={type} className="border border-[#004466]/30 p-2 bg-[#00050A]/30">
                    <div className="text-[10px] text-[#004466] leading-none mb-1">{type}</div>
                    <div className="text-xl font-bold">{count}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10px] opacity-50 italic">Total Interceptors Fired: {totalFired}</div>
            </section>
          </div>

          {/* Right Column: Financial Impact */}
          <div className="space-y-6 bg-[#00050A]/40 p-6 border border-[#004466]/20">
            <h3 className="text-[#FFCC00] font-bold border-b border-[#FFCC00]/30 mb-3 pb-1 text-xs tracking-tighter uppercase text-center">Asymmetric Economic Analysis</h3>
            
            <div className="space-y-6 py-4">
              <div className="text-center">
                <div className="text-[10px] text-[#004466] uppercase mb-1">Defense Expenditure</div>
                <div className="text-3xl font-bold text-[#FF0033]">${(defenseCost / 1000000).toFixed(2)}M</div>
              </div>

              <div className="flex items-center justify-center gap-4 text-[#004466]">
                <div className="h-px bg-[#004466]/30 flex-1" />
                <span className="text-[10px]">VS</span>
                <div className="h-px bg-[#004466]/30 flex-1" />
              </div>

              <div className="text-center">
                <div className="text-[10px] text-[#004466] uppercase mb-1">Enemy Threat Value</div>
                <div className="text-3xl font-bold text-[#00FF33]">${(enemyCost / 1000000).toFixed(2)}M</div>
              </div>

              <div className="bg-[#FFCC00]/10 p-4 border border-[#FFCC00]/30 rounded text-xs leading-relaxed text-[#FFCC00]">
                <span className="font-bold">STRATEGIC NOTE:</span> You spent <span className="underline">${(defenseCost / enemyCost).toFixed(1)}x</span> more on defense than the enemy spent on the attack. This represents the primary challenge of modern high-volume autonomous warfare.
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-6 bg-[#00111A] border-t border-[#004466] flex flex-col items-center gap-4">
          <p className="text-[10px] text-center max-w-md opacity-50">
            This data has been synthesized for the UAE Ministry of Defense. Share these results to improve regional air defense awareness.
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="w-full max-w-sm py-3 bg-[#00FF33]/10 text-[#00FF33] border border-[#00FF33] font-bold tracking-[0.3em] hover:bg-[#00FF33] hover:text-[#00050A] transition-all uppercase"
          >
            Acknowledge & Finalize Shift
          </button>
        </div>

      </div>
    </div>
  );
};

export default AfterActionReport;