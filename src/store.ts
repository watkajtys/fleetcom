import { create } from 'zustand';
import { Track, TrackType, DefendedAsset } from './types';
import { INITIAL_TRACKS, DEFENDED_ASSETS } from './constants';

interface TrackStore {
  tracks: Record<string, Track>;
  trackIds: string[];
  assets: Record<string, DefendedAsset>;
  lastSweepTime: number;
  
  // Stats
  interceptorsFired: Record<string, number>;
  leakerCount: number;
  destroyedAssetIds: string[];
  defenseCost: number;
  enemyCost: number;
  
  // Actions
  setTracks: (updater: (currentTracks: Track[]) => Track[], currentSimTime?: number) => void;
  addTracks: (newTracks: Track[]) => void;
  updateTrack: (id: string, updater: (track: Track) => Partial<Track>) => void;
  getTrack: (id: string) => Track | undefined;
  getAllTracks: () => Track[];
  
  // Asset Actions
  applyDamage: (assetId: string, amount: number) => { currentIntegrity: number, destroyed: boolean };
  
  // Stat Actions
  incrementInterceptorsFired: (type: string, amount?: number) => void;
  addLeaker: (assetId?: string) => void;
  addDefenseCost: (amount: number) => void;
  addEnemyCost: (amount: number) => void;
}

export const useTrackStore = create<TrackStore>((set, get) => {
  const initialMap: Record<string, Track> = {};
  const initialIds: string[] = [];
  INITIAL_TRACKS.forEach(t => {
    initialMap[t.id] = t;
    initialIds.push(t.id);
  });

  const assetMap: Record<string, DefendedAsset> = {};
  DEFENDED_ASSETS.forEach(a => {
    assetMap[a.id] = { ...a };
  });

  return {
    tracks: initialMap,
    trackIds: initialIds,
    assets: assetMap,
    lastSweepTime: Date.now(),
    
    interceptorsFired: { 'PAC-3': 0, 'TAMIR': 0, 'THAAD': 0, 'AMRAAM': 0, 'C-RAM': 0 },
    leakerCount: 0,
    destroyedAssetIds: [],
    defenseCost: 0,
    enemyCost: 0,

    setTracks: (updater, currentSimTime) => {
      set((state) => {
        const currentArray = state.trackIds.map(id => state.tracks[id]);
        const newArray = updater(currentArray);
        
        const newMap: Record<string, Track> = {};
        const newIds: string[] = [];
        newArray.forEach(t => {
          newMap[t.id] = t;
          newIds.push(t.id);
        });

        const newState: any = { tracks: newMap, trackIds: newIds };
        if (currentSimTime !== undefined) {
          newState.lastSweepTime = currentSimTime;
        }

        return newState;
      });
    },

    addTracks: (newTracks) => {
      set((state) => {
        const newMap = { ...state.tracks };
        const newIds = [...state.trackIds];
        
        newTracks.forEach(t => {
          if (!newMap[t.id]) {
            newIds.push(t.id);
          }
          newMap[t.id] = t;
        });

        return { tracks: newMap, trackIds: newIds };
      });
    },

    updateTrack: (id, updater) => {
      set((state) => {
        const track = state.tracks[id];
        if (!track) return state;
        return {
          tracks: {
            ...state.tracks,
            [id]: { ...track, ...updater(track) }
          }
        };
      });
    },

    getTrack: (id) => get().tracks[id],
    getAllTracks: () => {
      const state = get();
      return state.trackIds.map(id => state.tracks[id]);
    },

    applyDamage: (assetId, amount) => {
      let currentIntegrity = 0;
      let destroyed = false;

      set(state => {
        const asset = state.assets[assetId];
        if (!asset) return state;

        const newIntegrity = Math.max(0, asset.integrity - amount);
        const newlyDestroyed = newIntegrity <= 0 && !asset.isDestroyed;
        
        currentIntegrity = newIntegrity;
        destroyed = newlyDestroyed;

        return {
          assets: {
            ...state.assets,
            [assetId]: { 
              ...asset, 
              integrity: newIntegrity, 
              isDestroyed: asset.isDestroyed || newlyDestroyed 
            }
          },
          destroyedAssetIds: newlyDestroyed 
            ? [...state.destroyedAssetIds, assetId] 
            : state.destroyedAssetIds
        };
      });

      return { currentIntegrity, destroyed };
    },

    incrementInterceptorsFired: (type, amount = 1) => {
      set(state => ({
        interceptorsFired: {
          ...state.interceptorsFired,
          [type]: (state.interceptorsFired[type] || 0) + amount
        }
      }));
    },

    addLeaker: (assetId) => {
      set(state => ({
        leakerCount: state.leakerCount + 1
      }));
    },

    addDefenseCost: (amount) => set(state => ({ defenseCost: state.defenseCost + amount })),
    addEnemyCost: (amount) => set(state => ({ enemyCost: state.enemyCost + amount }))
  };
});
