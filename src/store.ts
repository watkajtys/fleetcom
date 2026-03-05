import { create } from 'zustand';
import { Track, TrackType } from './types';
import { INITIAL_TRACKS } from './constants';

interface TrackStore {
  tracks: Record<string, Track>;
  trackIds: string[];
  
  // Stats
  interceptorsFired: Record<string, number>;
  leakerCount: number;
  destroyedAssetIds: string[];
  defenseCost: number;
  enemyCost: number;
  
  // Actions
  setTracks: (updater: (currentTracks: Track[]) => Track[]) => void;
  addTracks: (newTracks: Track[]) => void;
  updateTrack: (id: string, updater: (track: Track) => Partial<Track>) => void;
  getTrack: (id: string) => Track | undefined;
  getAllTracks: () => Track[];
  
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

  return {
    tracks: initialMap,
    trackIds: initialIds,
    
    interceptorsFired: { 'PAC-3': 0, 'TAMIR': 0, 'THAAD': 0, 'AMRAAM': 0, 'C-RAM': 0 },
    leakerCount: 0,
    destroyedAssetIds: [],
    defenseCost: 0,
    enemyCost: 0,

    setTracks: (updater) => {
      set((state) => {
        const currentArray = state.trackIds.map(id => state.tracks[id]);
        const newArray = updater(currentArray);
        
        const newMap: Record<string, Track> = {};
        const newIds: string[] = [];
        newArray.forEach(t => {
          newMap[t.id] = t;
          newIds.push(t.id);
        });

        return { tracks: newMap, trackIds: newIds };
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
        leakerCount: state.leakerCount + 1,
        destroyedAssetIds: assetId && !state.destroyedAssetIds.includes(assetId) 
          ? [...state.destroyedAssetIds, assetId] 
          : state.destroyedAssetIds
      }));
    },

    addDefenseCost: (amount) => set(state => ({ defenseCost: state.defenseCost + amount })),
    addEnemyCost: (amount) => set(state => ({ enemyCost: state.enemyCost + amount }))
  };
});
