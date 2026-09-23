import { create } from 'zustand';
import { EEGData, BandPower, BrainState, CorrelationData, Recording, RecordingFrame, PlaybackState, BrainTrendPoint, BrainTrendError, TrendWindow } from '../types';
import { buildPlaybackTrend, createBrainTrendPoint, createTrendError, DEFAULT_TREND_WINDOW, MAX_TREND_POINTS_PER_CHANNEL, TREND_WINDOWS } from '../services/brainTrend';

const STORAGE_KEY = 'eeg_recordings';
const TREND_WINDOW_KEY = 'eeg_brain_trend_window';

const loadRecordings = (): Recording[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

const saveRecordings = (recordings: Recording[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recordings));
  } catch {}
};

const loadTrendWindow = (): TrendWindow => {
  try {
    const stored = localStorage.getItem(TREND_WINDOW_KEY) as TrendWindow | null;
    return stored && TREND_WINDOWS.some(window => window.key === stored) ? stored : DEFAULT_TREND_WINDOW;
  } catch {
    return DEFAULT_TREND_WINDOW;
  }
};

interface EEGState {
  eegData: EEGData | null;
  selectedChannel: string;
  bandPower: BandPower | null;
  isStreaming: boolean;
  brainState: BrainState | null;
  brainStateChannel: string | null;
  brainTrendsByChannel: Record<string, BrainTrendPoint[]>;
  brainTrendErrorsByChannel: Record<string, BrainTrendError>;
  liveTrendRetryToken: number;
  playbackBrainTrend: BrainTrendPoint[];
  playbackTrendError: BrainTrendError | null;
  playbackTrendRetryToken: number;
  trendWindow: TrendWindow;
  playbackReturnChannel: string | null;
  correlationData: CorrelationData | null;
  isRecording: boolean;
  recordingStartTime: number;
  currentRecordingFrames: RecordingFrame[];
  recordings: Recording[];
  playbackMode: boolean;
  activeRecording: Recording | null;
  playbackState: PlaybackState;
  setEEGData: (d: EEGData | null) => void;
  setChannel: (c: string) => void;
  setBandPower: (b: BandPower | null) => void;
  setStreaming: (v: boolean) => void;
  setBrainState: (s: BrainState | null) => void;
  setBrainStateChannel: (channel: string | null) => void;
  addBrainTrendPoint: (channel: string, state: BrainState) => boolean;
  clearBrainTrendError: (channel: string) => void;
  requestLiveTrendRetry: () => void;
  buildPlaybackBrainTrend: (recording: Recording) => void;
  requestPlaybackTrendRetry: () => void;
  setTrendWindow: (window: TrendWindow) => void;
  setCorrelationData: (c: CorrelationData | null) => void;
  startRecording: () => void;
  stopRecording: (name: string) => void;
  addRecordingFrame: (eeg: EEGData, bands: BandPower, brainState: BrainState, correlation: CorrelationData) => void;
  deleteRecording: (id: string) => void;
  enterPlaybackMode: (recording: Recording) => void;
  exitPlaybackMode: () => void;
  setPlaybackTime: (time: number) => void;
  togglePlayback: () => void;
  setPlaybackPlaying: (playing: boolean) => void;
}

export const useEEGStore = create<EEGState>((set, get) => ({
  eegData: null,
  selectedChannel: 'Fp1',
  bandPower: null,
  isStreaming: false,
  brainState: null,
  brainStateChannel: null,
  brainTrendsByChannel: {},
  brainTrendErrorsByChannel: {},
  liveTrendRetryToken: 0,
  playbackBrainTrend: [],
  playbackTrendError: null,
  playbackTrendRetryToken: 0,
  trendWindow: loadTrendWindow(),
  playbackReturnChannel: null,
  correlationData: null,
  isRecording: false,
  recordingStartTime: 0,
  currentRecordingFrames: [],
  recordings: loadRecordings(),
  playbackMode: false,
  activeRecording: null,
  playbackState: {
    isPlaying: false,
    currentTime: 0,
    currentFrame: null,
  },
  setEEGData: (d) => set({ eegData: d }),
  setChannel: (c) => set(state => state.playbackMode
    ? {}
    : { selectedChannel: c, brainStateChannel: null }),
  setBandPower: (b) => set({ bandPower: b }),
  setStreaming: (v) => set({ isStreaming: v }),
  setBrainState: (s) => set({ brainState: s }),
  setBrainStateChannel: (channel) => set({ brainStateChannel: channel }),
  addBrainTrendPoint: (channel, state) => {
    const current = get().brainTrendsByChannel[channel] || [];
    const previous = current[current.length - 1];
    const anchorTimestamp = current[0]?.timestamp;
    try {
      let time = 0;
      if (previous) {
        if (!Number.isFinite(state?.timestamp) || !Number.isFinite(anchorTimestamp)) {
          throw new Error('采样时间戳缺失，无法对齐趋势窗口');
        }
        time = (state.timestamp - anchorTimestamp) / 1000;
      }
      const point = createBrainTrendPoint(state, previous, time);
      if (previous && (!Number.isFinite(point.time) || point.time < previous.time)) {
        throw new Error('趋势采样时间顺序异常');
      }
      if (previous && point.timestamp === previous.timestamp) {
        if (get().brainTrendErrorsByChannel[channel]) get().clearBrainTrendError(channel);
        return true;
      }
      const nextPoints = [...current, point].slice(-MAX_TREND_POINTS_PER_CHANNEL);
      set({
        brainTrendsByChannel: { ...get().brainTrendsByChannel, [channel]: nextPoints },
        brainTrendErrorsByChannel: Object.fromEntries(Object.entries(get().brainTrendErrorsByChannel).filter(([key]) => key !== channel)),
      });
      return true;
    } catch (error) {
      set({
        brainTrendErrorsByChannel: {
          ...get().brainTrendErrorsByChannel,
          [channel]: createTrendError(error),
        },
      });
      return false;
    }
  },
  clearBrainTrendError: (channel) => {
    const errors = { ...get().brainTrendErrorsByChannel };
    delete errors[channel];
    set({ brainTrendErrorsByChannel: errors });
  },
  requestLiveTrendRetry: () => set({ liveTrendRetryToken: get().liveTrendRetryToken + 1 }),
  buildPlaybackBrainTrend: (recording) => {
    try {
      const playbackBrainTrend = buildPlaybackTrend(recording);
      set({ playbackBrainTrend, playbackTrendError: null });
    } catch (error) {
      set({ playbackBrainTrend: [], playbackTrendError: createTrendError(error) });
    }
  },
  requestPlaybackTrendRetry: () => set({ playbackTrendRetryToken: get().playbackTrendRetryToken + 1 }),
  setTrendWindow: (window) => {
    if (!TREND_WINDOWS.some(item => item.key === window)) return;
    try {
      localStorage.setItem(TREND_WINDOW_KEY, window);
    } catch {}
    set({ trendWindow: window });
  },
  setCorrelationData: (c) => set({ correlationData: c }),
  startRecording: () => {
    const { selectedChannel } = get();
    set({
      isRecording: true,
      recordingStartTime: Date.now(),
      currentRecordingFrames: [],
      playbackMode: false,
      activeRecording: null,
      selectedChannel: get().playbackReturnChannel || get().selectedChannel,
      playbackReturnChannel: null,
      playbackBrainTrend: [],
      playbackTrendError: null,
    });
  },
  stopRecording: (name: string) => {
    const { currentRecordingFrames, recordingStartTime, selectedChannel } = get();
    if (currentRecordingFrames.length === 0) {
      set({ isRecording: false, currentRecordingFrames: [] });
      return;
    }
    const endTime = Date.now();
    const duration = (endTime - recordingStartTime) / 1000;
    const newRecording: Recording = {
      id: `rec_${endTime}`,
      name: name || `录制 ${new Date(recordingStartTime).toLocaleString()}`,
      channel: selectedChannel,
      startTime: recordingStartTime,
      endTime,
      duration,
      frames: currentRecordingFrames,
    };
    const recordings = [...get().recordings, newRecording];
    saveRecordings(recordings);
    set({
      isRecording: false,
      recordingStartTime: 0,
      currentRecordingFrames: [],
      recordings,
    });
  },
  addRecordingFrame: (eeg, bands, brainState, correlation) => {
    const { isRecording, recordingStartTime, currentRecordingFrames } = get();
    if (!isRecording) return;
    const relativeTime = (Date.now() - recordingStartTime) / 1000;
    const frame: RecordingFrame = { relativeTime, eeg, bands, brainState, correlation };
    set({ currentRecordingFrames: [...currentRecordingFrames, frame] });
  },
  deleteRecording: (id) => {
    const recordings = get().recordings.filter(r => r.id !== id);
    saveRecordings(recordings);
    const { activeRecording } = get();
    if (activeRecording?.id === id) {
      set({
        recordings,
        playbackMode: false,
        activeRecording: null,
        selectedChannel: get().playbackReturnChannel || get().selectedChannel,
        brainStateChannel: null,
        playbackReturnChannel: null,
        playbackBrainTrend: [],
        playbackTrendError: null,
      });
    } else {
      set({ recordings });
    }
  },
  enterPlaybackMode: (recording) => {
    if (recording.frames.length === 0) return;
    let playbackBrainTrend: BrainTrendPoint[] = [];
    let playbackTrendError: BrainTrendError | null = null;
    try {
      playbackBrainTrend = buildPlaybackTrend(recording);
    } catch (error) {
      playbackTrendError = createTrendError(error);
    }
    set({
      playbackMode: true,
      activeRecording: recording,
      playbackReturnChannel: get().playbackReturnChannel || get().selectedChannel,
      selectedChannel: recording.channel,
      brainStateChannel: recording.channel,
      playbackState: {
        isPlaying: false,
        currentTime: 0,
        currentFrame: recording.frames[0],
      },
      eegData: recording.frames[0].eeg,
      bandPower: recording.frames[0].bands,
      brainState: recording.frames[0].brainState,
      correlationData: recording.frames[0].correlation,
      playbackBrainTrend,
      playbackTrendError,
    });
  },
  exitPlaybackMode: () => {
    const { playbackReturnChannel } = get();
    set({
      playbackMode: false,
      activeRecording: null,
      selectedChannel: playbackReturnChannel || get().selectedChannel,
      brainStateChannel: null,
      playbackReturnChannel: null,
      playbackBrainTrend: [],
      playbackTrendError: null,
      playbackState: {
        isPlaying: false,
        currentTime: 0,
        currentFrame: null,
      },
    });
  },
  setPlaybackTime: (time) => {
    const { activeRecording } = get();
    if (!activeRecording || activeRecording.frames.length === 0) return;
    const frames = activeRecording.frames;
    let frameIndex = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].relativeTime <= time) {
        frameIndex = i;
      } else {
        break;
      }
    }
    const frame = frames[frameIndex];
    set({
      playbackState: {
        ...get().playbackState,
        currentTime: time,
        currentFrame: frame,
      },
      eegData: frame.eeg,
      bandPower: frame.bands,
      brainState: frame.brainState,
      correlationData: frame.correlation,
    });
  },
  togglePlayback: () => {
    const { playbackState } = get();
    set({
      playbackState: {
        ...playbackState,
        isPlaying: !playbackState.isPlaying,
      },
    });
  },
  setPlaybackPlaying: (playing) => {
    set({
      playbackState: {
        ...get().playbackState,
        isPlaying: playing,
      },
    });
  },
}));
