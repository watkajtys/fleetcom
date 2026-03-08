import { create } from 'zustand';
import { Track, TrackType, DefendedAsset, EngagementDoctrine } from './types';
import { INITIAL_TRACKS, DEFENDED_ASSETS } from './constants';

interface TrackStore {
  tracks: Record<string, Track>;
  trackIds: string[];
  assets: Record<string, DefendedAsset>;
  lastSweepTime: number;
  
  // Stats
  interceptorsFired: Record<string, number>;
  leakerCount: number;
  defenseCost: number;
  enemyCost: number;
  
  // Actions
  setTracks: (updater: (currentTracks: Track[]) => Track[], currentSimTime?: number) => void;
  addTracks: (newTracks: Track[]) => void;
  updateTrack: (id: string, updater: (track: Track) => Partial<Track>) => void;
  getTrack: (id: string) => Track | undefined;
  getAllTracks: () => Track[];
  
  // Stat Actions
  incrementInterceptorsFired: (type: string, amount?: number) => void;
  addLeaker: (assetId?: string) => void;
  addDefenseCost: (amount: number) => void;
  addEnemyCost: (amount: number) => void;

  // ROE State
  wcs: 'TIGHT' | 'FREE';
  setWcs: (wcs: 'TIGHT' | 'FREE') => void;
  doctrine: EngagementDoctrine;
  setDoctrine: (doctrineOrUpdater: EngagementDoctrine | ((prev: EngagementDoctrine) => EngagementDoctrine)) => void;
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
    defenseCost: 0,
    enemyCost: 0,
    wcs: 'TIGHT',
    setWcs: (wcs) => set({ wcs }),
    doctrine: { autoEngageTBM: 0, autoEngageCM: 0, autoEngageUAS: 0, autoEngageRocket: 0 },
    setDoctrine: (doctrineOrUpdater) => set(state => ({
      doctrine: typeof doctrineOrUpdater === 'function' ? doctrineOrUpdater(state.doctrine) : doctrineOrUpdater
    })),

    setTracks: (updater, currentSimTime) => {
      set((state) => {
        const currentArray = state.trackIds.map(id => state.tracks[id]);
        const newArray = updater(currentArray);
        
        // Optimization: If the array reference hasn't changed and there's no sim time update,
        // we can bail out entirely to prevent React from re-rendering components.
        if (newArray === currentArray && currentSimTime === undefined) {
          return state;
        }
        
        const newState: any = {};
        
        if (newArray !== currentArray) {
          const newMap: Record<string, Track> = {};
          const newIds: string[] = [];
          newArray.forEach(t => {
            newMap[t.id] = t;
            newIds.push(t.id);
          });
          newState.tracks = newMap;
          newState.trackIds = newIds;
        }

        if (currentSimTime !== undefined) {
          newState.lastSweepTime = currentSimTime;
        }

        return Object.keys(newState).length > 0 ? newState : state;
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
