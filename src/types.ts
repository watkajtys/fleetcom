export type TrackType = 'PENDING' | 'UNKNOWN' | 'ASSUMED_FRIEND' | 'FRIEND' | 'NEUTRAL' | 'SUSPECT' | 'HOSTILE';
export type TrackCategory = 'FW' | 'RW' | 'UAS' | 'CM' | 'TBM';

export interface Track {
  id: string;
  type: TrackType;
  x: number; // 0-100 NM (1 unit = 1 Nautical Mile)
  y: number; // 0-100 NM
  alt: number; // feet
  spd: number; // knots
  hdg: number; // degrees
  category: TrackCategory;
  history: {x: number, y: number}[];
  iffInterrogated: boolean;
  tq: number; // Track Quality 1-9
  coasting: boolean; // True if radar temporarily lost lock
  engagedBy: 'PAC-3' | 'SHORAD' | 'THAAD' | 'VIPER' | string | null;
  engagementTime?: number;
  interceptDuration?: number;
  interceptTtl?: number;
  launchPos?: {x: number, y: number};
  sensor: 'LCL' | 'L16' | 'FUS';
  threatName?: string;
  detected?: boolean;
  // Fighter specific properties
  isFighter?: boolean;
  isRTB?: boolean;
  missilesRemaining?: number;
  targetWaypoint?: {x: number, y: number} | null;
}

export interface SystemLog {
  id: number;
  time: string;
  message: string;
  type: 'INFO' | 'WARN' | 'ALERT' | 'ACTION';
  acknowledged: boolean;
}
