import { MISSION_STEPS as defaultSteps } from '../mission';

export interface ScenarioDef {
  id: string;
  title: string;
  location: string;
  threatLevel: string;
  description: string;
  mapType: 'LAND' | 'NAVAL';
  initialInventory: {
    pac3: number;
    tamir: number;
    thaad: number;
    cram: number;
    sm2?: number;
    sm6?: number;
    essm?: number;
  };
  defendedAssets: { id: string; x: number; y: number; hasCram: boolean }[];
  steps: typeof defaultSteps;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'dubai-swarm',
    title: 'OPERATION DESERT SHIELD',
    location: 'NORTHERN EMIRATES SECTOR',
    threatLevel: 'HIGH (SATURATION STRIKE)',
    description: 'Intelligence indicates a high probability of a coordinated, multi-domain strike by non-state actors targeting critical infrastructure in Dubai (Port Rashid, DWC, Burj Khalifa).',
    mapType: 'LAND',
    initialInventory: {
      pac3: 32,
      tamir: 120,
      thaad: 8,
      cram: 999
    },
    defendedAssets: [
      { id: 'CITY_CENTER', x: 25.20, y: 55.27, hasCram: true },
      { id: 'PORT_RASHID', x: 25.26, y: 55.27, hasCram: true },
      { id: 'DWC_AIRPORT', x: 24.90, y: 55.15, hasCram: false },
      { id: 'BURJ_KHALIFA', x: 25.19, y: 55.27, hasCram: true },
      { id: 'AL_MINHAD_AB', x: 25.02, y: 55.36, hasCram: true }, // Fighter Base
    ],
    steps: defaultSteps
  }
];