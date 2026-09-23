export interface EEGData { channels: string[]; sample_rate: number; data: Record<string, number[]>; time: number[]; duration: number; }
export interface BandPower { delta: number; theta: number; alpha: number; beta: number; gamma: number; }
export interface BrainState {
  focus: number;
  relaxation: number;
  fatigue: number;
  status: 'focused' | 'relaxed' | 'fatigued' | 'neutral';
  statusLabel: string;
  statusColor: string;
  timestamp: number;
}

export type TrendWindow = '30s' | '60s' | '180s';

export interface BrainTrendPoint {
  time: number;
  timestamp: number;
  focus: number;
  relaxation: number;
  fatigue: number;
  abnormal: boolean;
  reasons: string[];
  abnormalMarker?: number | null;
}

export interface BrainTrendError {
  message: string;
  updatedAt: number;
}

export interface AbnormalSegment {
  start: number;
  end: number;
  points: number;
  reasons: string[];
  maxFatigue: number;
  minFocus: number;
}
export interface ChannelCorrelation {
  channel: string;
  targetChannel: string;
  correlation: number;
  coherence: number;
}
export interface CorrelationData {
  targetChannel: string;
  correlations: ChannelCorrelation[];
}

export interface RecordingFrame {
  relativeTime: number;
  eeg: EEGData;
  bands: BandPower;
  brainState: BrainState;
  correlation: CorrelationData;
}

export interface Recording {
  id: string;
  name: string;
  channel: string;
  startTime: number;
  endTime: number;
  duration: number;
  frames: RecordingFrame[];
}

export interface PlaybackState {
  isPlaying: boolean;
  currentTime: number;
  currentFrame: RecordingFrame | null;
}
