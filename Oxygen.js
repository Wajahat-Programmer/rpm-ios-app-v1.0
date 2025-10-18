// Oxygen.js – scan list + auto realtime metrics + PPG graph

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import O2 from './ViatomO2Manager';

const MAX_PPG_POINTS = 600;

export default function Oxygen() {
  const [devices, setDevices] = useState([]);
  const [connected, setConnected] = useState(null);
  const [ready, setReady] = useState(false);

  const [spo2, setSpo2] = useState(null);
  const [pr, setPr] = useState(null);
  const [pi, setPi] = useState(null);
  const [battery, setBattery] = useState(null);
  const [status, setStatus] = useState('Idle');

  const ppgRef = useRef([]);

  useEffect(() => {
    const subs = [
      O2.addListener(O2.O2Events.Discovered, (d) => {
        console.log('[O2] discovered', d);
        setDevices((prev) => (prev.find((x) => x.id === d.id) ? prev : [...prev, d]));
      }),
      O2.addListener(O2.O2Events.Connected, (d) => {
        console.log('[O2] connected', d);
        setConnected(d); setReady(false); setStatus('Connected — preparing…');
      }),
      O2.addListener(O2.O2Events.Disconnected, (d) => {
        console.log('[O2] disconnected', d);
        setConnected(null); setReady(false); setStatus('Disconnected');
        setSpo2(null); setPr(null); setPi(null); setBattery(null);
        ppgRef.current = [];
      }),
      O2.addListener(O2.O2Events.Ready, () => {
        console.log('[O2] ready (native will auto-start streaming)');
        setReady(true); setStatus('Ready — waiting for frames…');
      }),
      O2.addListener(O2.O2Events.Info, (info) => {
        console.log('[O2] info', info);
        if (typeof info?.battery === 'number') setBattery(info.battery);
      }),
      O2.addListener(O2.O2Events.RealTime, (p) => {
        console.log('[O2] realtime', p);
        if (p.type === 'O2_SEARCHING') { setStatus('Searching sensor contact…'); return; }
        setStatus('Measuring…');
        if (typeof p.spo2 === 'number') setSpo2(p.spo2);
        if (typeof p.pulseRate === 'number') setPr(p.pulseRate);
        if (typeof p.pi === 'number') setPi(p.pi / 10);   // PI is ×10 from native
        if (typeof p.battery === 'number') setBattery(p.battery);
      }),
      O2.addListener(O2.O2Events.PPG, (p) => {
        const samples = Array.isArray(p.samples) ? p.samples : [];
        if (samples.length) {
          const merged = [...ppgRef.current, ...samples.map((v) => Number(v) || 0)];
          ppgRef.current = merged.slice(-MAX_PPG_POINTS);
        }
      }),
      O2.addListener(O2.O2Events.Error, (e) => {
        console.warn('[O2] error', e);
        setStatus(`Error: ${e?.error || 'Unknown'}`);
      }),
    ];

    O2.startScan();

    return () => {
      subs.forEach((s) => s.remove());
      // Optional: clean up when leaving the screen
      O2.disconnect();
      O2.stopScan();
    };
  }, []);

  const connect = (id) => O2.connect(id);

  const graph = useMemo(() => {
    const w = 360, h = 120, data = ppgRef.current;
    if (data.length < 2) return { w, h, points: '', gridY: [] };
    const min = Math.min(...data), max = Math.max(...data), span = Math.max(1, max - min);
    const stepX = w / Math.max(1, data.length - 1);
    const points = data.map((v, i) => `${(i*stepX).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`).join(' ');
    const gridY = [0.25, 0.5, 0.75].map((p) => p * h);
    return { w, h, points, gridY };
  }, [ppgRef.current.length]);

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.card} onPress={() => connect(item.id)}>
      <Text style={styles.title}>{item.name || 'Unknown'}</Text>
      <Text style={styles.sub}>RSSI {String(item.rssi)} | {item.id}</Text>
      <Text style={styles.cta}>Tap to connect</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.h1}>Pulse O₂ (iOS)</Text>
        <Text style={styles.status}>
          {connected ? (ready ? 'Ready' : 'Connecting…') : 'Scanning…'} — {status}
        </Text>
      </View>

      {!connected ? (
        <>
          <Text style={styles.h2}>Nearby Devices</Text>
          <FlatList
            data={devices}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={{ padding: 12 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
        </>
      ) : (
        <View style={{ padding: 12 }}>
          <View style={styles.metrics}>
            <Metric label="SpO₂" value={spo2 != null ? `${spo2}%` : '—'} />
            <Metric label="Pulse" value={pr != null ? `${pr} bpm` : '—'} />
            <Metric label="PI" value={pi != null ? `${pi.toFixed(1)}%` : '—'} />
            <Metric label="Battery" value={battery != null ? `${battery}%` : '—'} />
          </View>

          <Text style={styles.h2}>PPG</Text>
          <View style={styles.graphCard}>
            <Svg width={graph.w} height={graph.h}>
              {graph.gridY.map((y, i) => (
                <Line key={i} x1="0" x2={graph.w} y1={y} y2={y} stroke="#eeeeee" strokeWidth="1" />
              ))}
              {graph.points ? <Polyline points={graph.points} stroke="#3b82f6" strokeWidth="2" fill="none" /> : null}
            </Svg>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220' },
  header: { padding: 12 },
  h1: { color: 'white', fontSize: 22, fontWeight: '700' },
  h2: { color: 'white', fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 6, paddingHorizontal: 12 },
  status: { color: '#9fb0c5', marginTop: 4 },
  card: { backgroundColor: '#101a33', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1f2a44' },
  title: { color: 'white', fontSize: 16, fontWeight: '600' },
  sub: { color: '#9fb0c5', marginTop: 2, fontSize: 12 },
  cta: { color: '#60a5fa', marginTop: 6, fontSize: 12 },
  metrics: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginBottom: 8 },
  metric: { flexGrow: 1, minWidth: '45%', backgroundColor: '#101a33', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1f2a44' },
  metricLabel: { color: '#9fb0c5', fontSize: 12 },
  metricValue: { color: 'white', fontSize: 18, fontWeight: '700', marginTop: 2 },
  graphCard: { backgroundColor: '#0f172a', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#1f2a44', alignItems: 'center' },
});
