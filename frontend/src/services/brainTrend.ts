import {
  AbnormalSegment,
  BrainState,
  BrainTrendError,
  BrainTrendPoint,
  Recording,
  TrendWindow,
} from '../types';

export const TREND_WINDOWS: { key: TrendWindow; label: string; seconds: number }[] = [
  { key: '30s', label: '近 30 秒', seconds: 30 },
  { key: '60s', label: '近 60 秒', seconds: 60 },
  { key: '180s', label: '近 3 分钟', seconds: 180 },
];

export const DEFAULT_TREND_WINDOW: TrendWindow = '60s';
export const MAX_TREND_POINTS_PER_CHANNEL = 240;
const GAP_SECONDS = 8;

const validateScore = (value: unknown, label: string): number => {
  const score = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(score)) {
    throw new Error(`${label}不是有效数字`);
  }
  return Math.min(100, Math.max(0, score));
};

const round = (value: number) => Math.round(value * 10) / 10;

export const createTrendError = (error: unknown): BrainTrendError => ({
  message: error instanceof Error && error.message.trim()
    ? error.message
    : '未知原因导致趋势统计失败',
  updatedAt: Date.now(),
});

export const createBrainTrendPoint = (
  state: BrainState,
  previous: BrainTrendPoint | undefined,
  time: number,
): BrainTrendPoint => {
  if (!state || typeof state !== 'object') {
    throw new Error('即时评分为空，无法生成趋势点');
  }
  if (!Number.isFinite(time) || time < 0) {
    throw new Error('采样时间缺失，无法生成趋势点');
  }

  const focus = validateScore(state.focus, '专注度');
  const relaxation = validateScore(state.relaxation, '放松度');
  const fatigue = validateScore(state.fatigue, '疲劳度');
  const reasons: string[] = [];

  if (fatigue >= 75) reasons.push('疲劳过高');
  if (focus <= 35) reasons.push('专注偏低');
  if (relaxation <= 25) reasons.push('放松偏低');

  if (previous && Number.isFinite(previous.time) && time > previous.time) {
    const interval = Math.max(time - previous.time, 0.001);
    const focusDelta = (focus - previous.focus) / interval;
    const fatigueDelta = (fatigue - previous.fatigue) / interval;
    if (Math.abs(focusDelta) >= 8) {
      reasons.push(focusDelta < 0 ? '专注快速下降' : '专注快速波动');
    }
    if (fatigueDelta >= 8) {
      reasons.push('疲劳快速上升');
    }
  }

  return {
    time: round(time),
    timestamp: Number.isFinite(state.timestamp) ? state.timestamp : Date.now(),
    focus: round(focus),
    relaxation: round(relaxation),
    fatigue: round(fatigue),
    abnormal: reasons.length > 0,
    reasons,
    abnormalMarker: reasons.length > 0 ? 100 : null,
  };
};

export const buildPlaybackTrend = (recording: Recording): BrainTrendPoint[] => {
  if (!recording.frames || recording.frames.length === 0) {
    throw new Error('该录制没有可用帧，无法计算回放趋势');
  }

  const points: BrainTrendPoint[] = [];
  recording.frames.forEach((frame, index) => {
    if (!frame || !Number.isFinite(frame.relativeTime) || !frame.brainState) {
      throw new Error(`第 ${index + 1} 帧缺少评分或时间信息`);
    }
    const point = createBrainTrendPoint(frame.brainState, points[points.length - 1], frame.relativeTime);
    if (points.length === 0 || point.time !== points[points.length - 1].time) {
      points.push(point);
    }
  });

  if (points.length === 0) {
    throw new Error('录制帧没有形成有效趋势点');
  }
  return points;
};

export const filterPointsByWindow = (
  points: BrainTrendPoint[],
  windowKey: TrendWindow,
  mode: 'live' | 'playback',
  currentTime?: number,
): BrainTrendPoint[] => {
  const seconds = TREND_WINDOWS.find(item => item.key === windowKey)?.seconds
    ?? TREND_WINDOWS.find(item => item.key === DEFAULT_TREND_WINDOW)!.seconds;
  if (points.length === 0) return [];

  const end = mode === 'playback' && Number.isFinite(currentTime)
    ? Number(currentTime)
    : points[points.length - 1].time;
  const start = mode === 'playback'
    ? Math.max(0, end - seconds)
    : Math.max(points[0].time, end - seconds);

  return points.filter(point => point.time >= start - 0.05 && point.time <= end + 0.05);
};

export const getAbnormalSegments = (points: BrainTrendPoint[]): AbnormalSegment[] => {
  const segments: AbnormalSegment[] = [];
  let group: BrainTrendPoint[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const reasons = Array.from(new Set(group.flatMap(point => point.reasons)));
    segments.push({
      start: group[0].time,
      end: group[group.length - 1].time,
      points: group.length,
      reasons,
      maxFatigue: Math.max(...group.map(point => point.fatigue)),
      minFocus: Math.min(...group.map(point => point.focus)),
    });
    group = [];
  };

  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (!point.abnormal || (previous && point.time - previous.time > GAP_SECONDS)) {
      flush();
    }
    if (point.abnormal) group.push(point);
  });
  flush();
  return segments;
};

export const formatTrendTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
};
