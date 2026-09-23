import React from 'react';
import { WaveformChart } from './components/WaveformChart';
import { BandPowerChart } from './components/BandPowerChart';
import { ChannelSelector } from './components/ChannelSelector';
import { BrainStateDashboard } from './components/BrainStateDashboard';
import { BrainStateTrend } from './components/BrainStateTrend';
import { CorrelationChart } from './components/CorrelationChart';
import { RecordingPanel } from './components/RecordingPanel';

const App: React.FC = () => (
  <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
    <nav style={{ width: '220px', background: '#0d1b2a', color: '#fff', padding: '20px 0', boxShadow: '2px 0 8px rgba(0,0,0,0.1)' }}>
      <div style={{ padding: '0 16px', marginBottom: '8px' }}>
        <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, letterSpacing: '1px' }}>🧠 EEG Lab</h2>
        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>脑电数据分析平台</div>
      </div>
      <ChannelSelector />
    </nav>
    <main style={{ flex: 1, overflow: 'auto', background: '#f5f7fa' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 600px', minWidth: 0 }}>
          <WaveformChart />
          <BandPowerChart />
          <CorrelationChart />
        </div>
        <div style={{ flex: '0 0 340px', maxWidth: '400px' }}>
          <BrainStateDashboard />
          <BrainStateTrend />
          <RecordingPanel />
        </div>
      </div>
    </main>
  </div>
);
export default App;
