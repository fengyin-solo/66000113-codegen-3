import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts';
import { useEEGStore } from '../store/eeg';
import { BrainState, TrendPoint, TrendWindowKey, AnomalySegment } from '../types';

const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕'
};

const WINDOWS: { key: TrendWindowKey; label: string; ms: number | null }[] = [
  { key: '30s', label: '30 秒', ms: 30_000 },
  { key: '60s', label: '1 分钟', ms: 60_000 },
  { key: '180s', label: '3 分钟', ms: 180_000 },
  { key: 'all', label: '全部', ms: null },
];

const WINDOW_STORAGE_KEY = 'eeg_trend_window_v1';
const COLLAPSED_STORAGE_KEY = 'eeg_trend_collapsed_v1';

// 异常判定阈值
const FATIGUE_LIMIT = 80;      // 疲劳超限
const FOCUS_LOAD_LIMIT = 90;   // 专注高负荷
const JUMP_LIMIT = 30;         // 相邻采样点突变
const GAP_LIMIT_MS = 6_000;    // 采集中断判定

const isValidScore = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

const loadWindow = (): TrendWindowKey => {
  const v = localStorage.getItem(WINDOW_STORAGE_KEY);
  return (WINDOWS.some(w => w.key === v) ? v : '60s') as TrendWindowKey;
};

const formatClock = (ms: number) => new Date(ms).toLocaleTimeString('zh-CN', { hour12: false });
const formatRel = (ms: number) => {
  const s = Math.max(0, ms / 1000);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
};

interface RawPoint {
  t: number;
  focus: unknown;
  relaxation: unknown;
  fatigue: unknown;
}

const buildTrend = (raw: RawPoint[], gapLimitMs: number): { points: TrendPoint[]; invalidCount: number; totalCount: number } => {
  const points: TrendPoint[] = [];
  let invalidCount = 0;
  let prev: TrendPoint | null = null;

  for (const r of raw) {
    if (!isValidScore(r.focus) || !isValidScore(r.relaxation) || !isValidScore(r.fatigue)) {
      invalidCount += 1;
      prev = null; // 无效点打断突变/中断的连续性判定
      continue;
    }
    const reasons: string[] = [];
    if (r.fatigue >= FATIGUE_LIMIT) reasons.push('疲劳超限');
    if (r.focus >= FOCUS_LOAD_LIMIT) reasons.push('专注高负荷');
    if (prev) {
      if (r.t - prev.t > gapLimitMs) reasons.push('数据中断');
      if (Math.abs(r.focus - prev.focus) >= JUMP_LIMIT) reasons.push('专注突变');
      if (Math.abs(r.relaxation - prev.relaxation) >= JUMP_LIMIT) reasons.push('放松突变');
      if (Math.abs(r.fatigue - prev.fatigue) >= JUMP_LIMIT) reasons.push('疲劳突变');
    }
    const p: TrendPoint = {
      t: r.t,
      focus: r.focus,
      relaxation: r.relaxation,
      fatigue: r.fatigue,
      abnormal: reasons.length > 0,
      reasons,
    };
    points.push(p);
    prev = p;
  }
  return { points, invalidCount, totalCount: raw.length };
};

const mergeSegments = (points: TrendPoint[], abnormalIndices: Set<number>): AnomalySegment[] => {
  const segments: AnomalySegment[] = [];
  let current: { p: TrendPoint; idx: number }[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const reasonCount: Record<string, number> = {};
    current.forEach(({ p }) => p.reasons.forEach(r => { reasonCount[r] = (reasonCount[r] || 0) + 1; }));
    const kind = Object.keys(reasonCount).sort((a, b) => reasonCount[b] - reasonCount[a])[0] || '异常';
    segments.push({
      start: current[0].p.t,
      end: current[current.length - 1].p.t,
      kind,
      reasons: Object.keys(reasonCount),
    });
    current = [];
  };
  points.forEach((p, idx) => {
    if (!abnormalIndices.has(idx)) { flush(); return; }
    if (current.length > 0 && idx !== current[current.length - 1].idx + 1) flush();
    current.push({ p, idx });
  });
  flush();
  return segments;
};

type ViewStatus =
  | { kind: 'ready' }
  | { kind: 'empty'; title: string; detail: string; canRetry: boolean }
  | { kind: 'error'; title: string; detail: string; canRetry: boolean; resetOnRetry: boolean };

const TrendTooltip: React.FC<any> = ({ active, payload, label, playback }) => {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background: 'rgba(255,255,255,0.96)', border: '1px solid #ddd', borderRadius: '8px', padding: '8px 10px', fontSize: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
      <div style={{ fontWeight: 600, color: '#555', marginBottom: '4px' }}>
        {playback ? formatRel(label) : formatClock(label)}
      </div>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} style={{ color: entry.color, display: 'flex', justifyContent: 'space-between', gap: '12px', lineHeight: '18px' }}>
          <span>{entry.name}</span>
          <span style={{ fontWeight: 600 }}>{Number(entry.value).toFixed(1)}</span>
        </div>
      ))}
      {payload[0]?.payload?.abnormal && (
        <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px dashed #eee', color: '#d32f2f' }}>
          ⚠ {payload[0].payload.reasons.join('、')}
        </div>
      )}
    </div>
  );
};

export const BrainStateTrend: React.FC = () => {
  const {
    selectedChannel, playbackMode, activeRecording, playbackState,
    trendHistory, appendTrendPoint, clearChannelTrend,
  } = useEEGStore();

  const [windowKey, setWindowKey] = useState<TrendWindowKey>(loadWindow);
  const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1');
  // null = 跟随最新（实时）/ 跟随播放头（回放）；数值 = 固定查看窗口右端
  const [viewEnd, setViewEnd] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const isPlayback = playbackMode && !!activeRecording;
  const viewChannel = isPlayback && activeRecording ? activeRecording.channel : selectedChannel;
  const channelName = CHANNEL_NAMES[viewChannel] || viewChannel;
  const winMs = WINDOWS.find(w => w.key === windowKey)?.ms ?? null;

  // 重新打开后保留窗口偏好
  useEffect(() => { localStorage.setItem(WINDOW_STORAGE_KEY, windowKey); }, [windowKey]);
  useEffect(() => { localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0'); }, [collapsed]);

  // 连续切换通道 / 进出回放时：恢复跟随对应数据，并清掉上一通道的错误态（窗口保留）
  useEffect(() => {
    setViewEnd(null);
    setErrorMsg(null);
    setRetrying(false);
  }, [viewChannel, playbackMode, activeRecording?.id]);

  // 组装原始序列（实时来自按通道隔离的趋势历史；回放来自录制帧，不写入实时历史）
  const { points: allPoints, invalidCount, totalCount } = useMemo(() => {
    let raw: RawPoint[] = [];
    if (isPlayback && activeRecording) {
      raw = activeRecording.frames.map(f => ({
        t: f.relativeTime * 1000,
        focus: f.brainState?.focus,
        relaxation: f.brainState?.relaxation,
        fatigue: f.brainState?.fatigue,
      }));
      return buildTrend(raw, GAP_LIMIT_MS);
    }
    const history: BrainState[] = trendHistory[viewChannel] || [];
    raw = history.map(s => ({ t: s.timestamp, focus: s.focus, relaxation: s.relaxation, fatigue: s.fatigue }));
    return buildTrend(raw, GAP_LIMIT_MS);
  }, [isPlayback, activeRecording, trendHistory, viewChannel]);

  const seriesMin = allPoints.length ? allPoints[0].t : 0;
  const seriesMax = allPoints.length ? allPoints[allPoints.length - 1].t : 0;
  const followEnd = isPlayback ? playbackState.currentTime * 1000 : seriesMax;
  const end = viewEnd ?? followEnd;
  const viewStart = winMs === null
    ? (isPlayback ? 0 : seriesMin)
    : end - winMs;

  const visiblePoints = useMemo(
    () => allPoints.filter(p => p.t >= viewStart && p.t <= end),
    [allPoints, viewStart, end]
  );

  // 窗口内异常段：用于高亮与计数
  const segments = useMemo(() => {
    const abnormalIdx = new Set<number>();
    visiblePoints.forEach((p, i) => { if (p.abnormal) abnormalIdx.add(i); });
    return mergeSegments(visiblePoints, abnormalIdx);
  }, [visiblePoints]);

  // 全局异常段：用于"上一/下一异常段"跨窗口跳转
  const allSegments = useMemo(() => {
    const abnormalIdx = new Set<number>();
    allPoints.forEach((p, i) => { if (p.abnormal) abnormalIdx.add(i); });
    return mergeSegments(allPoints, abnormalIdx);
  }, [allPoints]);

  const latest = visiblePoints.length ? visiblePoints[visiblePoints.length - 1] : null;

  // 手动拉取一次趋势评分（独立请求，不触碰实时评分卡 brainState）
  const fetchOneTrendPoint = async (resetFirst: boolean) => {
    setRetrying(true);
    setErrorMsg(null);
    try {
      if (resetFirst) clearChannelTrend(selectedChannel);
      const { data } = await axios.get(`/api/eeg/brain-state/${selectedChannel}`);
      if (!data || data.error || !data.state) {
        throw new Error(`通道 ${selectedChannel} 返回了无效结果或不支持该通道`);
      }
      const st = data.state as BrainState;
      if (!isValidScore(st.focus) || !isValidScore(st.relaxation) || !isValidScore(st.fatigue)) {
        throw new Error('返回的评分超出有效范围（应为 0–100 的数值）');
      }
      appendTrendPoint({ ...st, channel: data.channel || selectedChannel });
    } catch (e: any) {
      if (axios.isAxiosError(e)) {
        setErrorMsg('趋势计算失败：无法连接采集服务（/api/eeg/brain-state），请确认后端服务正在运行后重试。');
      } else {
        setErrorMsg(`趋势计算失败：${e?.message || '未知错误'}`);
      }
    } finally {
      setRetrying(false);
    }
  };

  // 计算视图状态：空态 / 错误（说明原因）/ 就绪
  const status: ViewStatus = (() => {
    if (isPlayback && activeRecording && activeRecording.frames.length === 0) {
      return {
        kind: 'empty',
        title: '该录制暂无可分析的趋势数据',
        detail: '录制中没有保存任何脑状态帧，无法绘制专注 / 放松 / 疲劳趋势。',
        canRetry: false,
      };
    }
    const allInvalid = allPoints.length === 0 && invalidCount > 0;
    // 所有采样点均无效：致命错误，展示原因并允许清空重试
    if (allInvalid) {
      return {
        kind: 'error',
        title: '趋势计算失败',
        detail: `最近 ${totalCount} 个采样点的评分均不在有效范围（应为 0–100 的数值），无法绘制趋势。`,
        canRetry: !isPlayback,
        resetOnRetry: true,
      };
    }
    if (!isPlayback && (trendHistory[viewChannel] || []).length === 0 && !errorMsg) {
      return {
        kind: 'empty',
        title: `通道 ${viewChannel}（${channelName}）暂无趋势数据`,
        detail: '趋势与通道采集联动，约每 3 秒随采集刷新；收到首个有效脑状态评分后将自动开始绘制。',
        canRetry: true,
      };
    }
    if (allPoints.length === 0 && !errorMsg) {
      return {
        kind: 'empty',
        title: '暂无趋势数据',
        detail: isPlayback ? '该录制中没有可解析的脑状态评分。' : '等待通道采集中，首个评分到达后自动绘制。',
        canRetry: !isPlayback,
      };
    }
    if (allPoints.length === 0 && errorMsg) {
      return { kind: 'error', title: '趋势计算失败', detail: errorMsg, canRetry: !isPlayback, resetOnRetry: false };
    }
    if (visiblePoints.length === 0) {
      return {
        kind: 'empty',
        title: '当前时间窗口内暂无数据',
        detail: winMs !== null
          ? `正在查看的 ${WINDOWS.find(w => w.key === windowKey)?.label} 区间没有有效采样点，可切换到更宽窗口或返回最新。`
          : '当前查看区间没有有效采样点。',
        canRetry: false,
      };
    }
    return { kind: 'ready' };
  })();

  // 非致命错误（已有趋势可显示时）：以条幅形式说明，不遮挡曲线
  const banner: { detail: string; resetOnRetry: boolean } | null = (() => {
    if (status.kind !== 'ready') return null;
    if (allPoints.length > 0 && invalidCount / Math.max(1, totalCount) > 0.5) {
      return { detail: `约 ${Math.round((invalidCount / totalCount) * 100)}% 的历史评分点无效，已跳过；建议清空后重新采集。`, resetOnRetry: true };
    }
    if (errorMsg) return { detail: errorMsg, resetOnRetry: false };
    return null;
  })();

  const jumpToSegment = (seg: AnomalySegment) => {
    if (winMs === null) return;
    const span = Math.max(winMs, seriesMax - seriesMin || 1);
    let target = seg.end + span * 0.15;
    const minEnd = seriesMin + span;
    if (target < minEnd) target = minEnd;
    if (target > seriesMax) target = seriesMax;
    setViewEnd(target);
  };

  const goPrevSegment = () => {
    if (allSegments.length === 0 || winMs === null) return;
    const before = [...allSegments].reverse().find(s => s.end < end - 500);
    if (before) jumpToSegment(before);
  };
  const goNextSegment = () => {
    if (allSegments.length === 0 || winMs === null) return;
    const after = allSegments.find(s => s.start > end + 500);
    if (after) jumpToSegment(after);
  };

  const pill: React.CSSProperties = {
    padding: '4px 10px', borderRadius: '14px', border: '1px solid #ddd',
    background: '#fff', color: '#555', fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s',
  };

  return (
    <div style={{ padding: '16px', background: '#fff', borderRadius: '12px', margin: '16px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
      <h3
        style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', cursor: 'pointer', userSelect: 'none' }}
        onClick={() => setCollapsed(c => !c)}
        title={collapsed ? '展开趋势' : '收起趋势'}
      >
        <span style={{ fontSize: '20px' }}>📉</span>
        <span>{viewChannel}</span>
        <span style={{ fontSize: '13px', color: '#666', fontWeight: 400 }}>{channelName} · 脑状态趋势</span>
        {isPlayback
          ? <span style={{ fontSize: '12px', color: '#6a1b9a', fontWeight: 500 }}>⏮ 回放联动{activeRecording ? ` · ${activeRecording.name}` : ''}</span>
          : <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: '#388e3c', fontWeight: 500 }}>
              <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#388e3c', animation: 'trend-pulse 2s infinite' }} />
              采集联动
            </span>}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#999' }}>{collapsed ? '展开 ▸' : '收起 ▾'}</span>
      </h3>

      {!collapsed && (
        <>
          {/* 时间窗口切换（跨重开保留） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '12px', color: '#888' }}>窗口</span>
            {WINDOWS.map(w => (
              <button
                key={w.key}
                onClick={() => setWindowKey(w.key)}
                style={{
                  ...pill,
                  borderColor: windowKey === w.key ? '#1565c0' : '#ddd',
                  background: windowKey === w.key ? '#1565c0' : '#fff',
                  color: windowKey === w.key ? '#fff' : '#555',
                  fontWeight: windowKey === w.key ? 600 : 400,
                }}
              >
                {w.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button onClick={goPrevSegment} disabled={allSegments.length === 0 || winMs === null} style={{ ...pill, cursor: allSegments.length && winMs !== null ? 'pointer' : 'not-allowed', opacity: allSegments.length && winMs !== null ? 1 : 0.5 }} title={allSegments.length ? `共 ${allSegments.length} 段异常，可跨窗口跳转` : '未检出异常段'}>
              ⚠ 上一异常段
            </button>
            <button onClick={goNextSegment} disabled={allSegments.length === 0 || winMs === null} style={{ ...pill, cursor: allSegments.length && winMs !== null ? 'pointer' : 'not-allowed', opacity: allSegments.length && winMs !== null ? 1 : 0.5 }} title={allSegments.length ? `共 ${allSegments.length} 段异常，可跨窗口跳转` : '未检出异常段'}>
              下一异常段 ⚠
            </button>
            {viewEnd !== null && (
              <button onClick={() => setViewEnd(null)} style={{ ...pill, borderColor: '#1565c0', color: '#1565c0' }}>
                {isPlayback ? '返回播放头' : '↻ 返回最新'}
              </button>
            )}
          </div>

          {status.kind === 'ready' && (
            <>
              {banner && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', marginBottom: '10px', background: '#fff8e1', border: '1px solid #ffe082', borderRadius: '8px', fontSize: '12px', color: '#a06a00' }}>
                  <span>⚠️ {banner.detail}</span>
                  {!isPlayback && (
                    <button
                      onClick={() => fetchOneTrendPoint(banner.resetOnRetry)}
                      disabled={retrying}
                      style={{ marginLeft: 'auto', flexShrink: 0, padding: '4px 12px', borderRadius: '6px', border: '1px solid #f9a825', background: '#fff', color: '#a06a00', fontSize: '12px', fontWeight: 600, cursor: retrying ? 'wait' : 'pointer' }}
                    >
                      {retrying ? '重试中…' : '重试'}
                    </button>
                  )}
                </div>
              )}
              {/* 概览统计：窗口内最新值 + 异常段数（仅读取，不回写实时评分） */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                <Stat label="专注" value={latest?.focus ?? null} color="#1976d2" />
                <Stat label="放松" value={latest?.relaxation ?? null} color="#388e3c" />
                <Stat label="疲劳" value={latest?.fatigue ?? null} color="#d32f2f" />
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', color: '#888' }}>
                  <span>窗口内 {visiblePoints.length} 个采样点</span>
                  <span style={{ color: segments.length ? '#d32f2f' : '#388e3c', fontWeight: 600 }}>
                    {segments.length
                      ? `⚠ 窗口内 ${segments.length} 段异常${allSegments.length !== segments.length ? `（共 ${allSegments.length} 段）` : ''}`
                      : (allSegments.length ? `窗口内无异常（共 ${allSegments.length} 段）` : '✓ 未检出异常段')}
                  </span>
                  {invalidCount > 0 && <span style={{ color: '#f9a825' }}>已忽略 {invalidCount} 个无效点</span>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: '#777', marginBottom: '4px' }}>
                <span style={{ color: '#1976d2' }}>— 专注</span>
                <span style={{ color: '#388e3c' }}>— 放松</span>
                <span style={{ color: '#d32f2f' }}>— 疲劳</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span style={{ display: 'inline-block', width: '12px', height: '8px', background: 'rgba(211,47,47,0.12)', border: '1px solid rgba(211,47,4f,0.4)', borderRadius: '2px' }} />
                  异常段（疲劳≥{FATIGUE_LIMIT} / 专注≥{FOCUS_LOAD_LIMIT} / 突变≥{JUMP_LIMIT} / 中断&gt;{GAP_LIMIT_MS / 1000}s）
                </span>
              </div>

              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={visiblePoints} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="linear"
                    domain={[viewStart, end]}
                    allowDataOverflow
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => isPlayback ? formatRel(v as number) : formatClock(v as number)}
                    tickLine={false}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} />
                  <Tooltip content={<TrendTooltip playback={isPlayback} />} />
                  {segments.map((s, i) => {
                    const span = winMs ?? Math.max(1, seriesMax - seriesMin);
                    const minW = span * 0.006;
                    return (
                      <ReferenceArea key={i} x1={s.start} x2={Math.max(s.end, s.start + minW)} fill="#d32f2f" fillOpacity={0.1} stroke="#d32f2f" strokeOpacity={0.35} />
                    );
                  })}
                  {isPlayback && playbackState.currentTime * 1000 >= viewStart && playbackState.currentTime * 1000 <= end && (
                    <ReferenceLine x={playbackState.currentTime * 1000} stroke="#6a1b9a" strokeDasharray="4 3" />
                  )}
                  <Line type="monotone" dataKey="focus" name="专注" stroke="#1976d2" dot={false} strokeWidth={1.8} isAnimationActive={false} />
                  <Line type="monotone" dataKey="relaxation" name="放松" stroke="#388e3c" dot={false} strokeWidth={1.8} isAnimationActive={false} />
                  <Line type="monotone" dataKey="fatigue" name="疲劳" stroke="#d32f2f" dot={false} strokeWidth={1.8} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <div style={{ fontSize: '11px', color: '#aaa', marginTop: '4px', textAlign: 'right' }}>
                {isPlayback
                  ? `${formatRel(viewStart)} – ${formatRel(end)} / 共 ${formatRel(activeRecording?.duration ? activeRecording.duration * 1000 : end)}`
                  : `${formatClock(viewStart)} – ${formatClock(end)}`}
                {viewEnd === null ? ` · ${isPlayback ? '跟随播放头' : '跟随最新采集'}` : ' · 历史查看中'}
              </div>
            </>
          )}

          {status.kind === 'empty' && (
            <div style={{ padding: '28px 16px', textAlign: 'center', border: '1px dashed #e0e0e0', borderRadius: '10px', background: '#fafbfc' }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>📭</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>{status.title}</div>
              <div style={{ fontSize: '12px', color: '#999', lineHeight: 1.7, marginBottom: status.canRetry ? '14px' : 0 }}>{status.detail}</div>
              {status.canRetry && (
                <button
                  onClick={() => fetchOneTrendPoint(false)}
                  disabled={retrying}
                  style={{ padding: '7px 18px', borderRadius: '7px', border: '1px solid #1565c0', background: '#fff', color: '#1565c0', fontSize: '13px', fontWeight: 600, cursor: retrying ? 'wait' : 'pointer' }}
                >
                  {retrying ? '拉取中…' : '立即拉取一次'}
                </button>
              )}
            </div>
          )}

          {status.kind === 'error' && (
            <div style={{ padding: '24px 16px', textAlign: 'center', border: '1px solid #ffcdd2', borderRadius: '10px', background: '#fff5f5' }}>
              <div style={{ fontSize: '28px', marginBottom: '8px' }}>⚠️</div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: '#c62828', marginBottom: '6px' }}>{status.title}</div>
              <div style={{ fontSize: '12px', color: '#a34444', lineHeight: 1.7, marginBottom: status.canRetry ? '14px' : 0 }}>{status.detail}</div>
              {status.canRetry && (
                <button
                  onClick={() => fetchOneTrendPoint(status.resetOnRetry)}
                  disabled={retrying}
                  style={{ padding: '7px 18px', borderRadius: '7px', border: 'none', background: '#d32f2f', color: '#fff', fontSize: '13px', fontWeight: 600, cursor: retrying ? 'wait' : 'pointer' }}
                >
                  {retrying ? '重试中…' : status.resetOnRetry ? '清空本通道趋势并重试' : '重试'}
                </button>
              )}
              {isPlayback && (
                <div style={{ fontSize: '11px', color: '#999', marginTop: '10px' }}>回放数据为录制时的固定快照，无法重新采集；请退出回放后在实时模式重试。</div>
              )}
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes trend-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number | null; color: string }> = ({ label, value, color }) => (
  <div style={{ padding: '6px 12px', borderRadius: '8px', background: `${color}0d`, border: `1px solid ${color}33`, display: 'flex', alignItems: 'baseline', gap: '6px' }}>
    <span style={{ fontSize: '11px', color: '#777' }}>{label}</span>
    <span style={{ fontSize: '17px', fontWeight: 700, color }}>
      {value === null ? '--' : value.toFixed(1)}
    </span>
  </div>
);
