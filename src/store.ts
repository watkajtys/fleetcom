import { create } from 'zustand';
import { Track, TrackType } from './types';
import { INITIAL_TRACKS } from './constants';

interface TrackStore {
  tracks: Record<string, Track>;
  trackIds: string[];
  
  // Actions
  setTracks: (updater: (currentTracks: Track[]) => Track[]) => void;
  addTracks: (newTracks: Track[]) => void;
  updateTrack: (id: string, updater: (track: Track) => Partial<Track>) => void;
  getTrack: (id: string) => Track | undefined;
  getAllTracks: () => Track[];
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
    }
  };
});
