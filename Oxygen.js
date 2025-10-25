// Oxygen.js – white background + colored header "Oxygen" + modern cards
// Keeps: realtime + PPG + session cards + auto-finalize + auto-reconnect

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, SafeAreaView, Image } from 'react-native';
import Svg, { Polyline, Line, Rect } from 'react-native-svg';
import O2 from './ViatomO2Manager';
import globalStyles from './globalStyles';

const BRAND = (globalStyles?.primaryColor?.color) || '#3b82f6'; // fallback if not defined
const DEVICE_IMG = require('./assets/Oxyfit.jpg');
const MAX_PPG_POINTS = 600;
const MAX_METRIC_POINTS = 120; // for small line charts in cards
const SESSION_GAP_MS = 4000;   // sustained searching → finalize session

const safeAvg = (arr) => (arr.length ? Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1)) : null);
const safeMin = (arr) => (arr.length ? Math.min(...arr) : null);
const safeMax = (arr) => (arr.length ? Math.max(...arr) : null);

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

  // sparkline series for cards (UI only)
  const spo2SeriesRef = useRef([]);
  const prSeriesRef   = useRef([]);

  // Session accumulation
  const sessionRef = useRef({ startTs: null, endTs: null, spo2: [], pr: [], ppgCount: 0 });
  const nextCardId = useRef(1);
  const [sessionCards, setSessionCards] = useState([]);
  const searchingSinceRef = useRef(null);

  // Auto-reconnect
  const lastDeviceIdRef = useRef(null);
  const reconnectTimerRef = useRef(null);

  const finalizeSessionIfAny = () => {
    const s = sessionRef.current;
    const hasPayload = (s.spo2.length || s.pr.length || s.ppgCount);
    if (s.startTs && hasPayload) {
      const card = {
        id: nextCardId.current++,
        startTs: s.startTs,
        endTs: s.endTs || s.startTs,
        avgSpO2: safeAvg(s.spo2), minSpO2: safeMin(s.spo2), maxSpO2: safeMax(s.spo2),
        avgPR:   safeAvg(s.pr),   minPR:   safeMin(s.pr),   maxPR:   safeMax(s.pr),
        ppgCount: s.ppgCount,
      };
      setSessionCards((prev) => [card, ...prev]);
    }
    sessionRef.current = { startTs: null, endTs: null, spo2: [], pr: [], ppgCount: 0 };
    searchingSinceRef.current = null;
  };

  useEffect(() => {
    const subs = [
      O2.addListener(O2.O2Events.Discovered, (d) => {
        setDevices((prev) => (prev.find((x)=>x.id===d.id)? prev : [...prev, d]));
      }),
      O2.addListener(O2.O2Events.Connected, (d) => {
        setConnected(d); setReady(false); setStatus('Connected — preparing…');
        if (d?.id) lastDeviceIdRef.current = d.id;
        sessionRef.current = { startTs: null, endTs: null, spo2: [], pr: [], ppgCount: 0 };
        searchingSinceRef.current = null;
        spo2SeriesRef.current = []; prSeriesRef.current = [];
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      }),
      O2.addListener(O2.O2Events.Disconnected, () => {
        finalizeSessionIfAny();
        setConnected(null); setReady(false); setStatus('Disconnected');
        setSpo2(null); setPr(null); setPi(null); setBattery(null);
        ppgRef.current = []; spo2SeriesRef.current = []; prSeriesRef.current = [];

        // auto-reconnect in 2 seconds
        if (lastDeviceIdRef.current) {
          try { O2.startScan(); } catch {}
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            O2.connect(lastDeviceIdRef.current);
          }, 2000);
        }
      }),
      O2.addListener(O2.O2Events.Ready, () => {
        setReady(true); setStatus('Ready — waiting for frames…');
      }),
      O2.addListener(O2.O2Events.Info, (info) => {
        if (typeof info?.battery === 'number') setBattery(info.battery);
      }),
      O2.addListener(O2.O2Events.RealTime, (p) => {
        if (p.type === 'O2_SEARCHING') {
          setStatus('Searching sensor contact…');
          const now = p.timestamp || Date.now();
          const s = sessionRef.current;
          const hasPayload = (s.spo2.length || s.pr.length || s.ppgCount);
          if (hasPayload) {
            if (!searchingSinceRef.current) searchingSinceRef.current = now;
            else if (now - searchingSinceRef.current >= SESSION_GAP_MS) finalizeSessionIfAny();
          }
          return;
        }

        // valid frames
        searchingSinceRef.current = null;
        setStatus('Measuring…');
        if (typeof p.spo2 === 'number') setSpo2(p.spo2);
        if (typeof p.pulseRate === 'number') setPr(p.pulseRate);
        if (typeof p.pi === 'number') setPi(p.pi / 10);
        if (typeof p.battery === 'number') setBattery(p.battery);

        const ts = p.timestamp || Date.now();
        if (!sessionRef.current.startTs) sessionRef.current.startTs = ts;
        sessionRef.current.endTs = ts;
        if (typeof p.spo2 === 'number') {
          sessionRef.current.spo2.push(p.spo2);
          const sArr = [...spo2SeriesRef.current, p.spo2]; spo2SeriesRef.current = sArr.slice(-MAX_METRIC_POINTS);
        }
        if (typeof p.pulseRate === 'number') {
          sessionRef.current.pr.push(p.pulseRate);
          const pArr = [...prSeriesRef.current, p.pulseRate]; prSeriesRef.current = pArr.slice(-MAX_METRIC_POINTS);
        }
      }),
      O2.addListener(O2.O2Events.PPG, (p) => {
        const samples = Array.isArray(p.samples) ? p.samples : [];
        if (samples.length) {
          const merged = [...ppgRef.current, ...samples.map((v) => Number(v) || 0)];
          ppgRef.current = merged.slice(-MAX_PPG_POINTS);
        }
        const ts = (p && p.timestamp) || Date.now();
        if (!sessionRef.current.startTs) sessionRef.current.startTs = ts;
        sessionRef.current.endTs = ts;
        sessionRef.current.ppgCount += samples.length || 0;
        searchingSinceRef.current = null;
      }),
      O2.addListener(O2.O2Events.Error, (e) => {
        setStatus(`Error: ${e?.error || 'Unknown'}`);
      }),
    ];

    O2.startScan();

    return () => {
      subs.forEach((s) => s.remove());
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      O2.disconnect(); O2.stopScan();
    };
  }, []);

  const connect = (id) => { if (id) lastDeviceIdRef.current = id; O2.connect(id); };

  // helpers to build sparkline SVGs
  const makeLine = (series, w, h) => {
    if (!series || series.length < 2) return { points: '', gridY: [] };
    const min = Math.min(...series), max = Math.max(...series), span = Math.max(1, max - min);
    const stepX = w / Math.max(1, series.length - 1);
    const pts = series.map((v,i)=>`${(i*stepX).toFixed(1)},${(h - ((v - min)/span)*h).toFixed(1)}`).join(' ');
    const gridY = [0.25, 0.5, 0.75].map(p => p*h);
    return { points: pts, gridY };
  };

  const ppgGraph = useMemo(() => {
    const w = 360, h = 100, data = ppgRef.current;
    if (data.length < 2) return { w, h, points: '', gridY: [] };
    const min = Math.min(...data), max = Math.max(...data), span = Math.max(1, max - min);
    const stepX = w / Math.max(1, data.length - 1);
    const points = data.map((v, i) =>
      `${(i * stepX).toFixed(1)},${(h - ((v - min) / span) * h).toFixed(1)}`
    ).join(' ');
    const gridY = [0.25, 0.5, 0.75].map((p) => p * h);
    return { w, h, points, gridY };
  }, [ppgRef.current.length]);

  const oxyLine = useMemo(() => makeLine(spo2SeriesRef.current, 320, 80), [spo2SeriesRef.current.length]);
  const prLine  = useMemo(() => makeLine(prSeriesRef.current,   320, 80), [prSeriesRef.current.length]);

  const renderItem = ({ item }) => (
    <TouchableOpacity style={styles.scanCard} onPress={() => connect(item.id)}>
      <Text style={styles.scanTitle}>{item.name || 'Unknown'}</Text>
      <Text style={styles.scanSub}>RSSI {String(item.rssi)} | {item.id}</Text>
      <Text style={[styles.scanCta, { color: BRAND }]}>Tap to connect</Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.root}>
      {/* Colored Header */}
      <View style={[styles.header, { backgroundColor: BRAND }]}>
        <Text style={styles.headerTitle}>Oxygen</Text>
        <Text style={styles.headerSub}>
          {connected ? (ready ? 'Connected' : 'Connecting…') : 'Scanning…'}  ·  {status}
        </Text>
      </View>

      {/* Content below header */}
      {!connected ? (
        <>
          <Text style={styles.sectionTitle}>Nearby Devices</Text>
          <FlatList
            data={devices}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          />
          {sessionCards.length > 0 && (
            <View style={{ paddingHorizontal: 12, paddingBottom: 24 }}>
              <Text style={styles.sectionTitle}>Previous Sessions</Text>
              {sessionCards.map((it) => <SessionCard key={it.id} item={it} />)}
            </View>
          )}
        </>
      ) : (
        <View style={{ padding: 12 }}>
          {/* Device status row */}
          <View style={styles.deviceRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image
                  source={DEVICE_IMG}
                  style={[styles.deviceImage, { borderColor: BRAND }]}
                  resizeMode="contain"
                />

              <View>
                <Text style={styles.deviceName}>{connected?.name || 'Oxyfit'}</Text>
                <Text style={[styles.connectedText, { color: BRAND }]}>Connected</Text>
              </View>
            </View>
            <View style={[styles.batteryPill, { borderColor: '#E5E7EB' }]}>
              <Text style={styles.batteryText}>{battery != null ? `${battery}%` : '--'}</Text>
            </View>
          </View>

          {/* Oxygen Level card */}
          <View style={styles.bigCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Oxygen Level</Text>
              <Text style={[styles.piPill, { borderColor: '#E5E7EB' }]}>PI: {pi != null ? `${pi.toFixed(1)}%` : '--'}</Text>
            </View>
            <View style={styles.valueRow}>
              <Text style={[styles.bigValue, { color: BRAND }]}>{spo2 != null ? spo2 : '--'}</Text>
              <Text style={styles.bigUnit}>%</Text>
            </View>
            <Svg width={320} height={100} style={{ alignSelf: 'center' }}>
              <Rect x="0" y="0" width="320" height="100" rx="8" fill="#FFFFFF" />
              {oxyLine.gridY.map((y, i) => (
                <Line key={i} x1="0" x2="320" y1={y} y2={y} stroke="#E5E7EB" strokeWidth="1" />
              ))}
              {oxyLine.points ? <Polyline points={oxyLine.points} stroke={BRAND} strokeWidth="2" fill="none" /> : null}
            </Svg>
            <View style={styles.axisRow}><Text style={styles.axisText}>1 min ago</Text><Text style={styles.axisText}>Now</Text></View>
          </View>

          {/* Pulse Rate card */}
          <View style={styles.bigCard}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Pulse Rate</Text>
            </View>
            <View style={styles.valueRow}>
              <Text style={[styles.bigValue, { color: BRAND }]}>{pr != null ? pr : '--'}</Text>
              <Text style={styles.bigUnit}>/min</Text>
            </View>
            <Svg width={320} height={100} style={{ alignSelf: 'center' }}>
              <Rect x="0" y="0" width="320" height="100" rx="8" fill="#FFFFFF" />
              {prLine.gridY.map((y, i) => (
                <Line key={i} x1="0" x2="320" y1={y} y2={y} stroke="#E5E7EB" strokeWidth="1" />
              ))}
              {prLine.points ? <Polyline points={prLine.points} stroke={BRAND} strokeWidth="2" fill="none" /> : null}
            </Svg>
            <View style={styles.axisRow}><Text style={styles.axisText}>1 min ago</Text><Text style={styles.axisText}>Now</Text></View>
          </View>

          {/* PPG graph */}
          <Text style={styles.sectionTitle}>PPG</Text>
          <View style={styles.graphCard}>
            <Svg width={ppgGraph.w} height={ppgGraph.h}>
              {ppgGraph.gridY.map((y, i) => (
                <Line key={i} x1="0" x2={ppgGraph.w} y1={y} y2={y} stroke="#E5E7EB" strokeWidth="1" />
              ))}
              {ppgGraph.points ? <Polyline points={ppgGraph.points} stroke={BRAND} strokeWidth="2" fill="none" /> : null}
            </Svg>
          </View>

          {/* Session summary cards */}
          {sessionCards.length > 0 && (
            <View style={{ paddingHorizontal: 0, paddingBottom: 24 }}>
              <Text style={styles.sectionTitle}>Previous Sessions</Text>
              {sessionCards.map((it) => <SessionCard key={it.id} item={it} />)}
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function SessionCard({ item }) {
  const durSec = Math.max(1, Math.round((item.endTs - item.startTs) / 1000));
  return (
    <View style={styles.sessionCard}>
      <Text style={styles.sessionTitle}>Session #{item.id}</Text>
      <Text style={styles.sessionSub}>
        {new Date(item.startTs).toLocaleString()} → {new Date(item.endTs).toLocaleString()}  ({durSec}s)
      </Text>
      <View style={{ height: 8 }} />
      <View style={styles.rowWrap}>
        <Text style={[styles.badge, { color: BRAND }]}>Avg SpO₂: <Text style={styles.badgeVal}>{item.avgSpO2 ?? '—'}</Text></Text>
        <Text style={[styles.badge, { color: BRAND }]}>Min SpO₂: <Text style={styles.badgeVal}>{item.minSpO2 ?? '—'}</Text></Text>
        <Text style={[styles.badge, { color: BRAND }]}>Max SpO₂: <Text style={styles.badgeVal}>{item.maxSpO2 ?? '—'}</Text></Text>
      </View>
      <View style={[styles.rowWrap, { marginTop: 4 }]}>
        <Text style={[styles.badge, { color: BRAND }]}>Avg PR: <Text style={styles.badgeVal}>{item.avgPR ?? '—'}</Text></Text>
        <Text style={[styles.badge, { color: BRAND }]}>Min PR: <Text style={styles.badgeVal}>{item.minPR ?? '—'}</Text></Text>
        <Text style={[styles.badge, { color: BRAND }]}>Max PR: <Text style={styles.badgeVal}>{item.maxPR ?? '—'}</Text></Text>
      </View>
      <Text style={styles.sessionSub}>PPG samples: <Text style={styles.badgeVal}>{item.ppgCount}</Text></Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },

  // Header (colored bar)
  header: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: 0 },
  headerTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  headerSub: { color: '#EAF2FF', marginTop: 4 },

  // Section title (black text)
  sectionTitle: { color: '#111827', fontSize: 16, fontWeight: '700', marginTop: 12, marginBottom: 8, paddingHorizontal: 12 },

  // Scan list
  scanCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#E5E7EB' },
  scanTitle: { color: '#111827', fontSize: 16, fontWeight: '600' },
  scanSub: { color: '#6B7280', marginTop: 2, fontSize: 12 },
  scanCta: { marginTop: 6, fontSize: 12 },

  // Device row
  deviceRow: {
    backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB',
    padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'
  },
  deviceImage: {
    width: 42,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    marginRight: 10,
  },
  deviceName: { color: '#111827', fontSize: 16, fontWeight: '700' },
  connectedText: { fontSize: 12, marginTop: 2 },
  batteryPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1 },
  batteryText: { color: '#374151', fontWeight: '700' },

  // Metric big cards
  bigCard: {
    backgroundColor: '#FFFFFF', borderRadius: 16, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: '#E5E7EB'
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { color: '#111827', fontSize: 16, fontWeight: '800' },
  piPill: { color: '#374151', backgroundColor: '#FFFFFF', borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },

  valueRow: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 6, marginTop: 4, marginBottom: 6 },
  bigValue: { fontSize: 34, fontWeight: '900' }, // color set inline with BRAND
  bigUnit: { color: '#6B7280', fontSize: 18, marginLeft: 4, marginBottom: 2 },

  axisRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, marginTop: 6 },
  axisText: { color: '#9CA3AF', fontSize: 11 },

  // PPG card
  graphCard: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center' },

  // Session cards
  sessionCard: { marginTop: 12, borderRadius: 12, padding: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E7EB' },
  sessionTitle: { fontSize: 16, fontWeight: '700', color: '#111827' },
  sessionSub: { color: '#6B7280', marginTop: 4 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  badge: { marginRight: 12 },
  badgeVal: { color: '#111827' },
});
