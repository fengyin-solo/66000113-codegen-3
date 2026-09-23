import React, { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useEEGStore } from '../store/eeg';
import { AbnormalSegment, BrainTrendPoint } from '../types';
import { filterPointsByWindow, formatTrendTime, getAbnormalSegments, TREND_WINDOWS } from '../services/brainTrend';

const CHANNEL_NAMES: Record<string, string> = {
  Fp1: '左前额', Fp2: '右前额', F3: '左额', F4: '右额',
  C3: '左中央', C4: '右中央', P3: '左顶', P4: '右顶',
  O1: '左枕', O2: '右枕',
};

const cardStyle: React.CSSProperties = {
  padding: '16px',
  background: '#fff',
  borderRadius: '12px',
  margin: '16px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
};

const average = (points: BrainTrendPoint[], key: 'focus' | 'relaxation' | 'fatigue') => {
  if (points.length === 0) return 0;
  return points.reduce((sum, point) => sum + point[key], 0) / points.length;
};

const TrendTooltip: React.FC<any> = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const point: BrainTrendPoint = payload[0].payload;
  return (
    <div style={{ background: 'rgba(15,23,42,0.94)', color: '#fff', padding: '10px 12px', borderRadius: '8px', fontSize: '12px', lineHeight: 1.6 }}>
      <div style={{ fontWeight: 700, marginBottom: '4px' }}>{formatTrendTime(point.time)}</div>
      <div style={{ color: '#93c5fd' }}>专注：{point.focus.toFixed(1)}</div>
      <div style={{ color: '#86efac' }}>放松：{point.relaxation.toFixed(1)}</div>
      <div style={{ color: '#fca5a5' }}>疲劳：{point.fatigue.toFixed(1)}</div>
      {point.abnormal && <div style={{ marginTop: '4px', color: '#fecaca' }}>⚠ {point.reasons.join('、')}</div>}
    </div>
  );
};

const EmptyState: React.FC<{
  title: string;
  description: string;
  actionLabel: string;
  onRetry: () => void;
  secondaryAction?: React.ReactNode;
}> = ({ title, description, actionLabel, onRetry, secondaryAction }) => (
  <div style={{ padding: '26px 12px', textAlign: 'center', border: '1px dashed #d7dee8', borderRadius: '10px', background: '#f8fafc' }}>
    <div style={{ fontSize: '28px', marginBottom: '8px' }}>📉</div>
    <div style={{ fontSize: '14px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>{title}</div>
    <div style={{ fontSize: '12px', color: '#64748b', lineHeight: 1.7, marginBottom: '14px' }}>{description}</div>
    <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
      <button
        onClick={onRetry}
        style={{ padding: '8px 14px', border: 'none', borderRadius: '7px', background: '#1565c0', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
      >
        {actionLabel}
      </button>
      {secondaryAction}
    </div>
  </div>
);

export const BrainStateTrend: React.FC = () => {
  const {
    selectedChannel,
    playbackMode,
    activeRecording,
    playbackState,
    eegData,
    brainState,
    brainStateChannel,
    brainTrendsByChannel,
    brainTrendErrorsByChannel,
    playbackBrainTrend,
    playbackTrendError,
    playbackTrendRetryToken,
    trendWindow,
    setTrendWindow,
    requestLiveTrendRetry,
    buildPlaybackBrainTrend,
    addBrainTrendPoint,
    setPlaybackTime,
    exitPlaybackMode,
  } = useEEGStore();

  const [selectedAnomalyIndex, setSelectedAnomalyIndex] = useState(0);
  const channelName = CHANNEL_NAMES[selectedChannel] || selectedChannel;
  const livePoints = brainTrendsByChannel[selectedChannel] || [];
  const liveError = brainTrendErrorsByChannel[selectedChannel] || null;
  const sourcePoints = playbackMode ? playbackBrainTrend : livePoints;
  const sourceError = playbackMode ? playbackTrendError : liveError;

  useEffect(() => {
    if (playbackMode || !brainState || brainStateChannel !== selectedChannel) return;
    useEEGStore.getState().addBrainTrendPoint(selectedChannel, brainState);
  }, [playbackMode, selectedChannel, brainState, brainStateChannel]);

  useEffect(() => {
    if (playbackMode && activeRecording && playbackTrendError) {
      buildPlaybackBrainTrend(activeRecording);
    }
  }, [playbackTrendRetryToken]); // eslint-disable-line react-hooks/exhaustive-deps

  const visiblePoints = useMemo(
    () => filterPointsByWindow(sourcePoints, trendWindow, playbackMode ? 'playback' : 'live', playbackState.currentTime),
    [sourcePoints, trendWindow, playbackMode, playbackState.currentTime],
  );

  const abnormalSegments = useMemo(() => getAbnormalSegments(visiblePoints), [visiblePoints]);
  const abnormalPoints = visiblePoints.filter(point => point.abnormal);

  useEffect(() => {
    setSelectedAnomalyIndex(0);
  }, [abnormalSegments.length, selectedChannel, trendWindow, playbackMode, activeRecording?.id]);

  const latest = visiblePoints[visiblePoints.length - 1];
  const selectedSegment: AbnormalSegment | null = abnormalSegments[selectedAnomalyIndex] || null;
  const isWaitingForChannel = !playbackMode && (!brainState || !eegData || brainStateChannel !== selectedChannel);

  const handleRetry = () => {
    if (playbackMode) {
      if (activeRecording) buildPlaybackBrainTrend(activeRecording);
      return;
    }
    requestLiveTrendRetry();
    if (brainState && brainStateChannel === selectedChannel) {
      addBrainTrendPoint(selectedChannel, brainState);
    }
  };

  const selectSegment = (index: number) => {
    if (abnormalSegments.length === 0) return;
    const normalized = (index + abnormalSegments.length) % abnormalSegments.length;
    setSelectedAnomalyIndex(normalized);
    if (playbackMode) {
      setPlaybackTime(abnormalSegments[normalized].start);
    }
  };

  const headerBadge = playbackMode ? (
    <span style={{ fontSize: '11px', color: '#6a1b9a', background: '#f3e5f5', borderRadius: '999px', padding: '3px 8px', fontWeight: 600 }}>
      ⏮ 回放趋势
    </span>
  ) : (
    <span style={{ fontSize: '11px', color: '#1565c0', background: '#e3f2fd', borderRadius: '999px', padding: '3px 8px', fontWeight: 600 }}>
      ● 采集联动
    </span>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '20px' }}>📈</span>
            脑状态趋势概览
            {headerBadge}
          </h3>
          <div style={{ fontSize: '12px', color: '#64748b', marginTop: '5px' }}>
            {selectedChannel} · {channelName}
            {playbackMode && activeRecording ? ` · ${activeRecording.name}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '8px' }}>
          {TREND_WINDOWS.map(window => (
            <button
              key={window.key}
              onClick={() => setTrendWindow(window.key)}
              style={{
                border: 'none',
                borderRadius: '6px',
                padding: '5px 8px',
                fontSize: '11px',
                fontWeight: trendWindow === window.key ? 700 : 500,
                color: trendWindow === window.key ? '#fff' : '#64748b',
                background: trendWindow === window.key ? '#1565c0' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {window.label.replace('近 ', '')}
            </button>
          ))}
        </div>
      </div>

      {sourceError && sourcePoints.length === 0 ? (
        <EmptyState
          title="趋势计算失败"
          description={`原因：${sourceError.message}。即时评分卡和原始采集数据不会被该失败结果覆盖，可重新计算。`}
          actionLabel="重试计算"
          onRetry={handleRetry}
          secondaryAction={playbackMode ? (
            <button
              onClick={exitPlaybackMode}
              style={{ padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: '7px', background: '#fff', color: '#475569', fontSize: '12px', cursor: 'pointer' }}
            >
              返回实时
            </button>
          ) : undefined}
        />
      ) : playbackMode && (!activeRecording || activeRecording.frames.length === 0) ? (
        <EmptyState
          title="暂无回放数据"
          description="当前没有可用于趋势统计的录制帧。请退出回放并重新开始采集，或选择包含数据的录制。"
          actionLabel="返回实时采集"
          onRetry={exitPlaybackMode}
        />
      ) : !playbackMode && livePoints.length === 0 && isWaitingForChannel ? (
        <EmptyState
          title={eegData ? `等待 ${selectedChannel} 通道数据` : '暂无采集数据'}
          description={
            eegData
              ? `正在等待 ${selectedChannel}（${channelName}）的第一帧采集结果。旧通道数据不会用于该通道趋势。`
              : '采集尚未返回数据。开始采集后，专注、放松、疲劳会按样本独立累计，不影响即时评分。'
          }
          actionLabel="立即采集"
          onRetry={requestLiveTrendRetry}
        />
      ) : visiblePoints.length === 0 ? (
        <EmptyState
          title="当前窗口暂无数据"
          description={`已保留 ${selectedChannel} 的历史趋势，但所选时间窗口内没有样本。可切换更宽窗口，或重新采集。`}
          actionLabel="重新采集"
          onRetry={requestLiveTrendRetry}
        />
      ) : (
        <>
          {sourceError && (
            <div style={{ marginBottom: '10px', padding: '9px 10px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
              <span>最近一次趋势计算失败：{sourceError.message}，图中保留此前有效数据。</span>
              <button onClick={handleRetry} style={{ border: 'none', background: '#dc2626', color: '#fff', borderRadius: '6px', padding: '5px 9px', fontSize: '11px', cursor: 'pointer', flexShrink: 0 }}>重试</button>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' }}>
            {[
              { label: '最新专注', value: latest?.focus ?? 0, color: '#1976d2' },
              { label: '最新放松', value: latest?.relaxation ?? 0, color: '#388e3c' },
              { label: '最新疲劳', value: latest?.fatigue ?? 0, color: '#d32f2f' },
              { label: '异常段', value: abnormalSegments.length, color: abnormalSegments.length > 0 ? '#f97316' : '#64748b', suffix: ' 段' },
            ].map(item => (
              <div key={item.label} style={{ padding: '9px', borderRadius: '8px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '10px', color: '#64748b', marginBottom: '3px' }}>{item.label}</div>
                <div style={{ fontSize: '17px', fontWeight: 800, color: item.color }}>
                  {typeof item.value === 'number' && item.label !== '异常段' ? item.value.toFixed(1) : item.value}{item.suffix || ''}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '11px', color: '#64748b' }}>
              窗口均值：专注 {average(visiblePoints, 'focus').toFixed(0)} · 放松 {average(visiblePoints, 'relaxation').toFixed(0)} · 疲劳 {average(visiblePoints, 'fatigue').toFixed(0)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button disabled={abnormalSegments.length === 0} onClick={() => selectSegment(selectedAnomalyIndex - 1)} style={segmentButtonStyle(abnormalSegments.length === 0)}>‹</button>
              <span style={{ fontSize: '11px', color: abnormalSegments.length ? '#b45309' : '#64748b', minWidth: '62px', textAlign: 'center' }}>
                {abnormalSegments.length ? `异常 ${selectedAnomalyIndex + 1}/${abnormalSegments.length}` : '无异常'}
              </span>
              <button disabled={abnormalSegments.length === 0} onClick={() => selectSegment(selectedAnomalyIndex + 1)} style={segmentButtonStyle(abnormalSegments.length === 0)}>›</button>
            </div>
          </div>

          {selectedSegment && (
            <button
              onClick={() => selectSegment(selectedAnomalyIndex)}
              style={{ width: '100%', textAlign: 'left', marginBottom: '8px', padding: '8px 10px', borderRadius: '8px', border: '1px solid #fed7aa', background: '#fff7ed', color: '#9a3412', fontSize: '11px', cursor: playbackMode ? 'pointer' : 'default' }}
            >
              {formatTrendTime(selectedSegment.start)} - {formatTrendTime(selectedSegment.end)} · {selectedSegment.reasons.join('、')}
              {playbackMode ? ' · 点击定位回放' : ''}
            </button>
          )}

          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={visiblePoints} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="time" tickFormatter={formatTrendTime} tick={{ fontSize: 10 }} minTickGap={24} />
              <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 10 }} />
              <Tooltip content={<TrendTooltip />} />
              {abnormalSegments.map((segment, index) => (
                <ReferenceArea
                  key={`${segment.start}-${index}`}
                  x1={segment.start}
                  x2={Math.max(segment.end, segment.start + 0.8)}
                  y1={0}
                  y2={100}
                  fill="#ef4444"
                  fillOpacity={index === selectedAnomalyIndex ? 0.18 : 0.08}
                  stroke="#ef4444"
                  strokeOpacity={0.3}
                />
              ))}
              <Line type="monotone" dataKey="focus" name="专注" stroke="#1976d2" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="relaxation" name="放松" stroke="#388e3c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="fatigue" name="疲劳" stroke="#d32f2f" strokeWidth={2} dot={false} />
              {abnormalPoints.map(point => (
                <ReferenceDot key={`${point.time}-${point.timestamp}`} x={point.time} y={98} r={4} fill="#dc2626" stroke="#fff" strokeWidth={1} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '6px', fontSize: '11px', color: '#64748b' }}>
            <span><i style={{ display: 'inline-block', width: '10px', height: '3px', background: '#1976d2', marginRight: '4px' }} />专注</span>
            <span><i style={{ display: 'inline-block', width: '10px', height: '3px', background: '#388e3c', marginRight: '4px' }} />放松</span>
            <span><i style={{ display: 'inline-block', width: '10px', height: '3px', background: '#d32f2f', marginRight: '4px' }} />疲劳</span>
            <span><i style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', marginRight: '4px' }} />异常采样</span>
          </div>
        </>
      )}
    </div>
  );
};

const segmentButtonStyle = (disabled: boolean): React.CSSProperties => ({
  width: '24px',
  height: '24px',
  borderRadius: '6px',
  border: '1px solid #cbd5e1',
  background: disabled ? '#f8fafc' : '#fff',
  color: disabled ? '#cbd5e1' : '#9a3412',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: '14px',
  lineHeight: 1,
});
