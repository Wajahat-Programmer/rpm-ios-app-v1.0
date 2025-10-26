// BloodPressure.js
import React, {useState, useMemo, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Alert,
  Modal,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Svg, {
  Polyline,
  Line as SvgLine,
  Circle,
  Polygon,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import globalStyles from './globalStyles';
import ViatomDeviceManager from './ViatomDeviceManager';
import axios from 'axios';

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const getMarkerLeftPercent = systolic => {
  const min = 90;
  const max = 180;
  const v = clamp(systolic, min, max);
  return ((v - min) / (max - min)) * 100;
};

// API Configuration
const API_BASE_URL = 'https://rmtrpm.duckdns.org/rpm-be/api/dev-data';
const DEV_TYPE = 'bp'; // Blood Pressure device type

// Configure axios to include credentials (cookies)
axios.defaults.withCredentials = true;

// Function to store device data
const storeDeviceData = async (deviceData) => {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/devices/data`,
      deviceData,
      {
        withCredentials: true,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('✅ Device data stored successfully');
    return response.data;
  } catch (error) {
    console.error('❌ Error storing device data:', error);
    throw error;
  }
};

// Function to fetch historical data
const fetchHistoricalData = async (days = 7) => {
  try {
    console.log(`📥 Fetching historical BP data for last ${days} days`);
    const response = await axios.get(
      `${API_BASE_URL}/devices/getUserReadingData?deviceType=bp&days=${days}`,
      { withCredentials: true }
    );
    if (response.data.success) {
      console.log(`✅ Loaded ${response.data.data.records.length} historical records`);
      return response.data.data.records;
    }
    return [];
  } catch (error) {
    console.error('❌ Error fetching historical data:', error);
    throw error;
  }
};

function BPChart({width, data, xLabels}) {
  const padding = {left: 10, right: 48, top: 18, bottom: 26};
  const w = width - 2;
  const h = SCREEN_HEIGHT * 0.22;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const Y_MIN = 60;
  const Y_MAX = 160;
  const bracketLabels = [160, 135, 110, 85, 60];

  if (!data || data.length < 2) {
    return (
      <Svg width={w} height={h}>
        <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />
        <SvgText
          x={w / 2}
          y={h / 2}
          fontSize="12"
          fill="#7a7a7a"
          textAnchor="middle">
          Not enough data to show chart
        </SvgText>
      </Svg>
    );
  }

  const xFor = i => padding.left + (chartW / (data.length - 1)) * i;
  const yFor = val => padding.top + (Y_MAX - val) * (chartH / (Y_MAX - Y_MIN));

  const sysPoints = data.map((d, i) => `${xFor(i)},${yFor(d.systolic)}`).join(' ');
  const diaPoints = data.map((d, i) => `${xFor(i)},${yFor(d.diastolic)}`).join(' ');

  const diaAreaPoints = useMemo(() => {
    const topLine = data.map((d, i) => `${xFor(i)},${yFor(d.diastolic)}`).join(' ');
    const bottomRight = `${padding.left + chartW},${padding.top + chartH}`;
    const bottomLeft = `${padding.left},${padding.top + chartH}`;
    return `${topLine} ${bottomRight} ${bottomLeft}`;
  }, [chartW, chartH, data]);

  const todayX = xFor(data.length - 1);
  const todaySysY = yFor(data[data.length - 1].systolic);
  const todayDiaY = yFor(data[data.length - 1].diastolic);

  return (
    <Svg width={w} height={h}>
      <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />

      {[0.25, 0.5, 0.75].map(p => (
        <SvgLine
          key={`grid-${p}`}
          x1={padding.left}
          x2={padding.left + chartW}
          y1={padding.top + chartH * p}
          y2={padding.top + chartH * p}
          stroke="#e9ecef"
          strokeWidth="1"
        />
      ))}

      <SvgLine
        x1={padding.left}
        x2={padding.left + chartW}
        y1={yFor(120)}
        y2={yFor(120)}
        stroke="#7acb6a"
        strokeWidth="1.5"
      />
      <SvgLine
        x1={padding.left}
        x2={padding.left + chartW}
        y1={yFor(80)}
        y2={yFor(80)}
        stroke="#7acb6a"
        strokeWidth="1.5"
      />

      <Polygon points={diaAreaPoints} fill="#dfe4ea" opacity="0.5" />
      <Polyline points={diaPoints} fill="none" stroke="#7f8c8d" strokeWidth="1.5" />
      <Polyline points={sysPoints} fill="none" stroke="#4a4a4a" strokeWidth="1.5" />

      {data.map((d, i) => (
        <Circle
          key={`sys-dot-${i}`}
          cx={xFor(i)}
          cy={yFor(d.systolic)}
          r="4"
          fill="#ffffff"
          stroke="#4a4a4a"
          strokeWidth="1.5"
        />
      ))}

      {data.map((d, i) => {
        const cx = xFor(i);
        const cy = yFor(d.diastolic);
        const size = 6;
        const points = `${cx},${cy - size} ${cx - size},${cy + size} ${cx + size},${cy + size}`;
        return (
          <Polygon key={`dia-tri-${i}`} points={points} fill="#4a4a4a" opacity="0.8" />
        );
      })}

      <SvgLine
        x1={padding.left + chartW + 10}
        x2={padding.left + chartW + 10}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#7aa9c9"
        strokeWidth="2"
      />
      <Circle
        cx={padding.left + chartW + 10}
        cy={todaySysY}
        r="6"
        stroke="#0d6ea5"
        strokeWidth="2"
        fill="#ffffff"
      />
      <Polygon
        points={`${padding.left + chartW + 10},${todayDiaY - 6} ${padding.left + chartW + 4},${todayDiaY + 6} ${padding.left + chartW + 16},${todayDiaY + 6}`}
        fill="#0d6ea5"
      />

      {bracketLabels.map(val => (
        <React.Fragment key={`br-${val}`}>
          <SvgLine
            x1={padding.left + chartW + 6}
            x2={padding.left + chartW + 14}
            y1={yFor(val)}
            y2={yFor(val)}
            stroke="#7aa9c9"
            strokeWidth="2"
          />
          <SvgText
            x={padding.left + chartW + 18}
            y={yFor(val) + 4}
            fill="#7a7a7a"
            fontSize="10">
            {val}
          </SvgText>
        </React.Fragment>
      ))}

      <SvgLine
        x1={todayX}
        x2={todayX}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#9ec6dd"
        strokeWidth="2"
      />

      {xLabels.map((lab, i) => (
        <SvgText
          key={`x-${lab}-${i}`}
          x={xFor(i)}
          y={padding.top + chartH + 18}
          fontSize="10"
          fill="#7a7a7a"
          textAnchor="middle">
          {lab}
        </SvgText>
      ))}
    </Svg>
  );
}

function BPMChart({width, data, xLabels}) {
  const padding = {left: 10, right: 48, top: 18, bottom: 26};
  const w = width - 2;
  const h = SCREEN_HEIGHT * 0.22;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  // --- derive Y range from data (so 100/110 will show) ---
  const bpmVals = (data ?? []).map(d => Number(d.bpm)).filter(v => Number.isFinite(v));
  // sensible fallbacks if no data
  const rawMin = bpmVals.length ? Math.min(...bpmVals) : 50;
  const rawMax = bpmVals.length ? Math.max(...bpmVals) : 90;

  // add a little padding and clamp to practical bounds
  let Y_MIN = Math.max(40, Math.floor((rawMin - 5) / 5) * 5);
  let Y_MAX = Math.min(140, Math.ceil((rawMax + 5) / 5) * 5);
  if (Y_MAX - Y_MIN < 20) { Y_MIN = Math.max(40, Y_MIN - 5); Y_MAX = Math.min(140, Y_MAX + 5); }

  // build tick labels every 10 bpm within range (top -> bottom)
  const bracketLabels = [];
  for (let v = Math.ceil(Y_MAX / 10) * 10; v >= Y_MIN; v -= 10) {
    bracketLabels.push(v);
  }

  if (!data || data.length < 2) {
    return (
      <Svg width={w} height={h}>
        <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />
        <SvgText
          x={w / 2}
          y={h / 2}
          fontSize="12"
          fill="#7a7a7a"
          textAnchor="middle">
          Not enough data to show chart
        </SvgText>
      </Svg>
    );
  }

  const xFor = i => padding.left + (chartW / (data.length - 1)) * i;
  const yFor = val => padding.top + (Y_MAX - Number(val)) * (chartH / (Y_MAX - Y_MIN));

  const bpmPoints = data.map((d, i) => `${xFor(i)},${yFor(d.bpm)}`).join(' ');
  const todayX = xFor(data.length - 1);
  const todayY = yFor(data[data.length - 1].bpm);

  return (
    <Svg width={w} height={h}>
      <Rect x="0" y="0" width={w} height={h} fill="#ffffff" rx="6" />

      {[0.25, 0.5, 0.75].map(p => (
        <SvgLine
          key={`grid-bpm-${p}`}
          x1={padding.left}
          x2={padding.left + chartW}
          y1={padding.top + chartH * p}
          y2={padding.top + chartH * p}
          stroke="#e9ecef"
          strokeWidth="1"
        />
      ))}

      {/* goal line at 72, only if in visible range */}
      {72 >= Y_MIN && 72 <= Y_MAX && (
        <SvgLine
          x1={padding.left}
          x2={padding.left + chartW}
          y1={yFor(72)}
          y2={yFor(72)}
          stroke="#7acb6a"
          strokeWidth="1.5"
        />
      )}

      <Polyline points={bpmPoints} fill="none" stroke="#4a4a4a" strokeWidth="1.5" />

      {data.map((d, i) => (
        <Circle
          key={`bpm-dot-${i}`}
          cx={xFor(i)}
          cy={yFor(d.bpm)}
          r="4"
          fill="#ffffff"
          stroke="#4a4a4a"
          strokeWidth="1.5"
        />
      ))}

      {/* right rail + marker */}
      <SvgLine
        x1={padding.left + chartW + 10}
        x2={padding.left + chartW + 10}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#7aa9c9"
        strokeWidth="2"
      />
      <Circle
        cx={padding.left + chartW + 10}
        cy={todayY}
        r="6"
        stroke="#0d6ea5"
        strokeWidth="2"
        fill="#ffffff"
      />

      {/* right-side tick labels */}
      {bracketLabels.map(val => (
        <React.Fragment key={`bpm-br-${val}`}>
          <SvgLine
            x1={padding.left + chartW + 6}
            x2={padding.left + chartW + 14}
            y1={yFor(val)}
            y2={yFor(val)}
            stroke="#7aa9c9"
            strokeWidth="2"
          />
          <SvgText
            x={padding.left + chartW + 18}
            y={yFor(val) + 4}
            fill="#7a7a7a"
            fontSize="10">
            {val}
          </SvgText>
        </React.Fragment>
      ))}

      {/* vertical today cursor */}
      <SvgLine
        x1={todayX}
        x2={todayX}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#9ec6dd"
        strokeWidth="2"
      />

      {/* X labels */}
      {xLabels.map((lab, i) => (
        <SvgText
          key={`x-bpm-${lab}-${i}`}
          x={xFor(i)}
          y={padding.top + chartH + 18}
          fontSize="10"
          fill="#7a7a7a"
          textAnchor="middle">
          {lab}
        </SvgText>
      ))}
    </Svg>
  );
}


export default function BloodPressure({ navigation }) {
  const [activeTab, setActiveTab] = useState('LIST');
  const [devices, setDevices] = useState([]);
  const [connectedDevice, setConnectedDevice] = useState(null);

  const [realTimeData, setRealTimeData] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [isMeasuring, setIsMeasuring] = useState(false);

  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);

  const toastTimeoutRef = useRef(null);
  const measurementTimeoutRef = useRef(null);
  const scanGuardRef = useRef(false); // ← prevents duplicate scans
  const [batteryLevel, setBatteryLevel] = useState(null);

  const [historicalData, setHistoricalData] = useState([]);
  const [filterDays, setFilterDays] = useState(7);
  const [refreshing, setRefreshing] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [shouldAutoReconnect, setShouldAutoReconnect] = useState(true);
  // const connectedDeviceRef = useRef(null);

  const connectedDeviceRef = useRef({
  name: null,
  id: null,
  batteryLevel: null
});

// Add this method to force reconnection to the last device
const attemptAutoReconnect = useCallback(() => {
  console.log('[BP] Manual reconnection attempt');
  setShouldAutoReconnect(true);
  
  // First try the native auto-reconnect
  ViatomDeviceManager.enableAutoReconnect?.(true);
  
  // Then start scanning
  safeStartScan();
  
  // If we have previously discovered devices, try connecting to the first BP device
  if (devices.length > 0) {
    const bpDevice = devices.find(d => d.name && d.name.includes('BP2A'));
    if (bpDevice && !connectedDevice) {
      console.log('[BP] Attempting connection to previously discovered device:', bpDevice.name);
      setTimeout(() => connectToDevice(bpDevice.id), 500);
    }
  }
}, [devices, connectedDevice, safeStartScan]);
  const showToastMessage = (message, duration = 2000) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    setShowToast(true);
    toastTimeoutRef.current = setTimeout(() => setShowToast(false), duration);
  };

const storeMeasurementData = async (reading) => {
  try {
    const currentDevice = connectedDeviceRef.current;
    
    const deviceData = {
      devId: currentDevice?.id || 'bp_device_001',
      devType: DEV_TYPE,
      data: {
        systolic: reading.systolic,
        diastolic: reading.diastolic,
        pulse: reading.bpm,
        mean: reading.mean,
        timestamp: new Date().toISOString(),
        date: reading.date,
        time: reading.time,
        deviceInfo: {
          name: currentDevice?.name || 'Blood Pressure Monitor',
          id: currentDevice?.id || 'unknown_device_id',
          batteryLevel: currentDevice?.batteryLevel, // Battery info sent here
          type: 'viatom'
        }
      }
    };
    
    console.log('📤 Storing device data with battery:', deviceData);
    await storeDeviceData(deviceData);
    console.log('✅ Device data stored with battery info');

    loadHistoricalData(filterDays);
  } catch (error) {
    console.error('❌ Failed to store device data:', error);
  }
};

  const loadHistoricalData = async (days = 7) => {
    try {
      setIsLoading(true);
      const data = await fetchHistoricalData(days);
      const formattedData = data.map(item => ({
        id: item.id,
        date: new Date(item.createdAt).toLocaleDateString(),
        time: new Date(item.createdAt).toLocaleTimeString(),
        systolic: item.data.systolic,
        diastolic: item.data.diastolic,
        bpm: item.data.pulse,
        mean: item.data.mean,
        timestamp: item.createdAt
      }));
      setHistoricalData(formattedData);
      setFilterDays(days);
    } catch (error) {
      console.error('Error loading historical data:', error);
      showToastMessage('Failed to load historical data');
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHistoricalData(filterDays);
  };

  const generateXLabels = (data) => {
    if (!data || data.length === 0) return ['No Data'];
    const dates = data.map(item => {
      const date = new Date(item.timestamp || item.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const uniqueDates = [...new Set(dates)].slice(-7);
    return uniqueDates;
  };

  const getDisplayData = () => {
    // sort a copy (avoid mutating state)
    return [...historicalData].sort((a, b) => {
      const dateA = new Date(a.timestamp || a.date);
      const dateB = new Date(b.timestamp || b.date);
      return dateB - dateA;
    });
  };

  // Add this useEffect to debug connected device state
useEffect(() => {
  console.log('🔧 Connected Device State Updated:', {
    name: connectedDevice?.name,
    id: connectedDevice?.id,
    exists: !!connectedDevice
  });
}, [connectedDevice]);

  // ----- Native Event Subscriptions (attach once) -----
  useEffect(() => {
    // Load initial historical data
    loadHistoricalData(7);

const discoverySubscription = ViatomDeviceManager.addListener('onDeviceDiscovered', (device) => {
  console.log('[BLE] Discovered:', device);
  
  // If this looks like our BP device and we're trying to auto-reconnect, attempt connection
  if (shouldAutoReconnect && device.name && device.name.includes('BP2A')) {
    console.log('[BP] Auto-reconnect: Found BP device, attempting connection');
    // Small delay to avoid connection storms
    setTimeout(() => {
      if (!connectedDevice) {
        connectToDevice(device.id);
      }
    }, 1000);
  }
  
  setDevices((prev) => (prev.find((d) => d.id === device.id) ? prev : [...prev, device]));
});

const connectionSubscription = ViatomDeviceManager.addListener('onDeviceConnected', (device) => {
  console.log('[BLE] Connected:', device);
  
  // Ensure device info is properly set
  const deviceInfo = {
    name: device.name || 'BP2A 2943', // Fallback name from discovery
    id: device.id,
    batteryLevel: batteryLevel
  };
  
  setConnectedDevice(deviceInfo);
  
  // Store device info in ref with battery
  connectedDeviceRef.current = deviceInfo;
  console.log('💾 Stored device in ref:', connectedDeviceRef.current);
  
  ViatomDeviceManager.requestDeviceInfo?.();
  ViatomDeviceManager.requestBPConfig?.();
  
  // Stop scanning once connected
  ViatomDeviceManager.stopScan?.();
});

const disconnectionSubscription = ViatomDeviceManager.addListener('onDeviceDisconnected', (payload) => {
  console.log('[BLE] Disconnected:', payload);
  setConnectedDevice(null);
  // Clear the ref when disconnected
  connectedDeviceRef.current = null;
  setRealTimeData(null);
  setIsMeasuring(false);
  if (measurementTimeoutRef.current) {
    clearTimeout(measurementTimeoutRef.current);
    measurementTimeoutRef.current = null;
  }
  // Native does a recovery scan. Nudge a normal scan soon for UX.
  setTimeout(() => safeStartScan(), 600);
});

    const dataSubscription = ViatomDeviceManager.addListener('onRealTimeData', (data) => {
      console.log('[DATA] onRealTimeData:', data);
      handleRealTimeData(data);
    });

const resultSubscription = ViatomDeviceManager.addListener('onMeasurementResult', (evt) => {
  if (evt?.type !== 'BP_RESULT') return;
  console.log('[BP] Final Result received:', evt);

  stopMeasurementUIOnly();
  const now = new Date();
  
  // Use the ref to get device info
  const currentDevice = connectedDeviceRef.current;
  console.log('💾 Device info from ref:', currentDevice);
  
  const newReading = {
    id: Date.now(),
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    systolic: Number(evt.systolic),
    diastolic: Number(evt.diastolic),
    bpm: Number(evt.pulse),
    mean: Number(evt.meanPressure),
    timestamp: now.toISOString(),
    // Include device info from ref
    deviceName: currentDevice?.name,
    deviceId: currentDevice?.id
  };
  console.log('📝 Final reading with device:', { 
    deviceName: currentDevice?.name, 
    deviceId: currentDevice?.id 
  });
  storeMeasurementData(newReading);
  setRealTimeData({
    type: 'BP',
    systolic: newReading.systolic,
    diastolic: newReading.diastolic,
    pulse: newReading.bpm,
    mean: newReading.mean,
    phase: 'done',
  });
  showToastMessage(
    `Measurement Complete: ${newReading.systolic}/${newReading.diastolic} mmHg, Pulse: ${newReading.bpm} BPM`,
    3000
  );
});

    const modeSubscription = ViatomDeviceManager.addListener('onBPModeChanged', (payload) => {
      console.log('[BP] Mode changed:', payload);
      if (payload?.active === false) setIsMeasuring(false);
    });

    const statusSubscription = ViatomDeviceManager.addListener('onBPStatusChanged', (payload) => {
      console.log('[BP] Status:', payload);
      if (payload?.status === 'measurement_started') {
        showToastMessage('Measurement started');
        setIsMeasuring(true);
      } else if (payload?.status === 'measurement_ending') {
        showToastMessage('Finishing up…');
      } else if (payload?.status === 'measurement_completed') {
        showToastMessage('Measurement complete');
        stopMeasurementUIOnly();
      }
    });

    const errorSubscription = ViatomDeviceManager.addListener('onDeviceError', (err) => {
      console.warn('[BP] Error:', err);
      showToastMessage(err?.message || err?.error || 'Device error');
      setIsMeasuring(false);
    });

    return () => {
      discoverySubscription.remove();
      connectionSubscription.remove();
      disconnectionSubscription.remove();
      dataSubscription.remove();
      resultSubscription.remove();
      modeSubscription.remove();
      statusSubscription.remove();
      errorSubscription.remove();

      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (measurementTimeoutRef.current) clearTimeout(measurementTimeoutRef.current);
    };
  }, []);

  // ----- Safe scan wrapper to avoid duplicate scans -----
  const safeStartScan = useCallback(() => {
    if (scanGuardRef.current) return;
    scanGuardRef.current = true;
    console.log('[BLE] Safe scan start');
    ViatomDeviceManager.startScan?.();
    setTimeout(() => { scanGuardRef.current = false; }, 1500);
  }, []);

  // ----- Screen focus: scan if not connected -----
// Add this useEffect to handle the auto-reconnect logic more aggressively
useEffect(() => {
  // When we have historical data loaded but no device connected, force reconnection
  if (historicalData.length > 0 && !connectedDevice && shouldAutoReconnect) {
    console.log('[BP] Historical data loaded but no device - forcing reconnection attempt');
    // Give a small delay to allow any ongoing native auto-reconnect to complete
    const reconnectTimer = setTimeout(() => {
      if (!connectedDevice) {
        console.log('[BP] Force starting scan for reconnection');
        safeStartScan();
        
        // Enable more aggressive scanning for reconnection
        ViatomDeviceManager.enableAutoReconnect?.(true);
      }
    }, 2000);
    
    return () => clearTimeout(reconnectTimer);
  }
}, [historicalData, connectedDevice, shouldAutoReconnect]);

// Update the useFocusEffect to be more aggressive about reconnection
useFocusEffect(
  useCallback(() => {
    console.log('[BP] Screen focused, checking connection state');
    
    // Always enable auto-reconnect when coming to this screen
    setShouldAutoReconnect(true);
    ViatomDeviceManager.enableAutoReconnect?.(true);
    
    if (!connectedDevice) {
      console.log('[BP] No connected device, starting aggressive scan');
      // Don't clear devices - keep previous discoveries
      safeStartScan();
      
      // Set a longer timeout for reconnection scenarios
      const scanTimeout = setTimeout(() => {
        if (!connectedDevice) {
          console.log('[BP] Extended scan complete, stopping');
          ViatomDeviceManager.stopScan?.();
        }
      }, 15000); // 15 seconds for reconnection
      
      return () => clearTimeout(scanTimeout);
    } else {
      console.log('[BP] Device already connected:', connectedDevice.name);
    }
    
    return () => {
      console.log('[BP] Screen unfocused - keeping background connection');
      // Don't stop scanning completely, allow background reconnection
    };
  }, [connectedDevice, safeStartScan])
);

// Add this useEffect to handle connection state changes
useEffect(() => {
  // When device disconnects, enable auto-reconnect for next focus
  if (!connectedDevice) {
    setShouldAutoReconnect(true);
  }
}, [connectedDevice]);


const handleRealTimeData = (data) => {
  if (!data || !data.type) return;

if (data.type === 'BP_STATUS_UPDATE') {
  console.log('[UI] Battery update received:', data);
  if (typeof data.batteryLevel === 'number') {
    setBatteryLevel(data.batteryLevel);
    // Store battery level in the device ref
    if (connectedDeviceRef.current) {
      connectedDeviceRef.current.batteryLevel = data.batteryLevel;
    }
    console.log('🔋 Battery level stored:', data.batteryLevel);
  }
  return;
}

  if (data.type === 'BP_REALDATA_REQUESTED') {
    showToastMessage(data.message || 'Request real data.');
    setIsMeasuring(true);
    return;
  }

  if (data.type === 'BP_PROGRESS' && typeof data.pressure === 'number') {
    const defl = !!data.isDeflating;
    const infl = typeof data.isInflating === 'boolean' ? !!data.isInflating : !defl;
    const phase = data.phase || (defl ? 'deflating' : 'inflating');
    setRealTimeData({
      type: 'BP_PROGRESS',
      pressure: Number(data.pressure) || 0,
      isDeflating: defl,
      isInflating: infl,
      phase,
      hasPulse: !!data.hasPulse,
      pulseRate: Number(data.pulseRate) || 0,
    });
    if (!defl && (data.pressure ?? 0) > 0) showToastMessage('Inflating...');
    else if (defl) showToastMessage('Deflating...');
    setIsMeasuring(true);
    return;
  }

if (data.type === 'BP') {
  stopMeasurementUIOnly();
  const now = new Date();
  // Use the ref to get device info
  const currentDevice = connectedDeviceRef.current;
  
  const newReading = {
    id: Date.now(),
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    systolic: Number(data.systolic),
    diastolic: Number(data.diastolic),
    bpm: Number(data.pulse),
    mean: typeof data.mean === 'number' ? Number(data.mean) : undefined,
    timestamp: now.toISOString(),
    // Include device info from ref
    deviceName: currentDevice?.name,
    deviceId: currentDevice?.id
  };
  console.log('📝 Storing reading with device:', { 
    deviceName: currentDevice?.name, 
    deviceId: currentDevice?.id 
  });
  storeMeasurementData(newReading);
  showToastMessage(
    `Measurement: ${newReading.systolic}/${newReading.diastolic} mmHg, Pulse: ${newReading.bpm} BPM`,
    3000
  );
  setRealTimeData({
    type: 'BP',
    systolic: newReading.systolic,
    diastolic: newReading.diastolic,
    pulse: newReading.bpm,
    mean: newReading.mean,
  });
  return;
}
};

  const stopMeasurementUIOnly = () => {
    if (measurementTimeoutRef.current) {
      clearTimeout(measurementTimeoutRef.current);
      measurementTimeoutRef.current = null;
    }
    setIsMeasuring(false);
  };

  // ----- Scanning helpers (modal buttons still use these) -----
  const startScanning = () => {
    console.log('[BLE] Start scanning (manual)');
    setDevices([]);
    setIsScanning(true);
    safeStartScan();
    setTimeout(() => {
      setIsScanning(false);
      ViatomDeviceManager.stopScan?.();
    }, 10000);
  };

  const stopScanning = () => {
    console.log('[BLE] Stop scanning');
    setIsScanning(false);
    ViatomDeviceManager.stopScan?.();
  };

const connectToDevice = (deviceId) => {
  console.log('[BLE] Connect to:', deviceId);
  setShouldAutoReconnect(true); // Enable auto-reconnect when user manually connects
  ViatomDeviceManager.connectToDevice?.(deviceId);
};

const disconnectDevice = () => {
  console.log('[BLE] Disconnect - disabling auto-reconnect');
  setShouldAutoReconnect(false); // User manually disconnected, don't auto-reconnect
  ViatomDeviceManager.disconnectDevice?.();
  setConnectedDevice(null);
  setRealTimeData(null);
  setIsMeasuring(false);
};

  const startMeasurement = () => {
    if (!connectedDevice) {
      Alert.alert('Error', 'Please connect to a device first');
      return;
    }
    setRealTimeData(null);
    setIsMeasuring(true);

    console.log('[BP] Starting measurement (native will request live stream)');
    ViatomDeviceManager.startBPMeasurement?.();

    ViatomDeviceManager.requestBPRunStatus?.();

    if (measurementTimeoutRef.current) clearTimeout(measurementTimeoutRef.current);
    measurementTimeoutRef.current = setTimeout(() => {
      Alert.alert(
        'Measurement Timeout',
        'The measurement took too long. Please check device connection and try again.'
      );
      setIsMeasuring(false);
      measurementTimeoutRef.current = null;
    }, 180000);
  };

  const stopMeasurement = () => {
    console.log('[BP] Stop measurement (user action)');
    ViatomDeviceManager.stopBPMeasurement?.();
    stopMeasurementUIOnly();
  };

  const handleBack = () => navigation?.navigate?.('Home');

  // ----- Modals -----
  const renderFilterModal = () => (
    <Modal
      visible={showFilterModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowFilterModal(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Select Time Period</Text>
          <Text style={styles.modalSubtitle}>Show data from last:</Text>

          {[7, 14, 21, 30].map(days => (
            <TouchableOpacity
              key={days}
              style={[styles.filterOption, filterDays === days && styles.filterOptionActive]}
              onPress={() => { loadHistoricalData(days); setShowFilterModal(false); }}
            >
              <Text style={[styles.filterOptionText, filterDays === days && styles.filterOptionTextActive]}>
                {days} {days === 1 ? 'Day' : 'Days'}
              </Text>
              {filterDays === days && <Text style={styles.selectedIndicator}>✓</Text>}
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.cancelButton} onPress={() => setShowFilterModal(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  const renderDeviceConnectionModal = () => (
    <Modal
      visible={showDeviceModal}
      transparent
      animationType="fade"
      onRequestClose={() => setShowDeviceModal(false)}
      onShow={() => {
        // auto-scan when opening modal while disconnected
        if (!connectedDevice) startScanning();
      }}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Connect to BP Device</Text>

          {isLoading ? (
            <View style={{ alignItems: 'center', padding: 20 }}>
              <ActivityIndicator size="large" color={globalStyles.primaryColor.color} />
              <Text style={{ marginTop: 10, color: '#666' }}>Connecting...</Text>
            </View>
          ) : (
            <>
              <Text style={styles.modalSubtitle}>
                {connectedDevice
                  ? 'Connected to Device'
                  : isScanning
                  ? 'Scanning for devices...'
                  : 'Select a device to connect'}
              </Text>

              {!connectedDevice && (
                <>
                  <ScrollView style={styles.deviceList} showsVerticalScrollIndicator={false}>
                    {devices.length === 0 ? (
                      <View style={styles.noDevicesContainer}>
                        <Text style={styles.noDevicesText}>
                          {isScanning ? 'Scanning for devices...' : 'No devices found. Tap "Scan" to search.'}
                        </Text>
                      </View>
                    ) : (
                      devices.map((d, idx) => (
                        <TouchableOpacity
                          key={`${d.id ?? idx}`}
                          style={styles.deviceItem}
                          onPress={() => connectToDevice(d.id)}
                        >
                          <View style={styles.deviceIcon}>
                            <Image 
                              source={require('./assets/device_bp.png')} 
                              style={styles.deviceIconImage}
                              resizeMode="contain"
                            />
                          </View>
                          <View style={styles.deviceInfo}>
                            <Text style={styles.deviceName}>{d.name ?? 'Unknown Device'}</Text>
                            {d.id && <Text style={styles.deviceId}>{d.id}</Text>}
                          </View>
                          <View style={styles.connectIndicator}>
                            <Text style={styles.connectIndicatorText}>Connect</Text>
                          </View>
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>

                  <View style={styles.modalButtons}>
                    {!isScanning ? (
                      <TouchableOpacity style={styles.primaryButton} onPress={startScanning}>
                        <Text style={styles.primaryButtonText}>Scan for Devices</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.secondaryButton} onPress={stopScanning}>
                        <Text style={styles.secondaryButtonText}>Stop Scanning</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              )}

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  setShowDeviceModal(false);
                  if (isScanning) stopScanning();
                }}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

  // ----- Header connection status row -----

const renderConnectionStatus = () => (
  <View style={styles.deviceRow}>
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Image
        source={require('./assets/device_bp.png')} // Use your BP device image
        style={[styles.deviceImage, { borderColor: globalStyles.primaryColor.color }]}
        resizeMode="contain"
      />
      
      <View>
        <Text style={styles.deviceName}>{connectedDevice?.name || 'Blood Pressure Monitor'}</Text>
        <Text style={[styles.connectedText, { color: globalStyles.primaryColor.color }]}>
          {connectedDevice ? 'Connected' : 'Disconnected'}
        </Text>
      </View>
    </View>
    
    {batteryLevel !== null && (
      <View style={[styles.batteryPill, { borderColor: '#E5E7EB' }]}>
        <Text style={styles.batteryText}>{batteryLevel}%</Text>
      </View>
    )}
  </View>
);

  const renderDeviceControls = () => (
    <View style={styles.controlsContainer}>
      <TouchableOpacity
        style={[styles.controlButton, isMeasuring && styles.controlButtonActive]}
        onPress={isMeasuring ? stopMeasurement : startMeasurement}
        disabled={!connectedDevice}
      >
        <Text style={styles.controlButtonText}>{isMeasuring ? 'Stop Measurement' : 'Start Measurement'}</Text>
      </TouchableOpacity>
    </View>
  );

  const renderRealTimeData = () => {
    if (!realTimeData) return null;

    return (
      <View style={styles.realTimeContainer}>
        <Text style={styles.realTimeTitle}>Real-time Data</Text>

        {realTimeData.type === 'BP_PROGRESS' && (
          <>
            <View style={styles.measurementRow}>
              <Text style={styles.measurementLabel}>Current Pressure:&nbsp;</Text>
              <Text
                style={[
                  styles.measurementValue,
                  { color: realTimeData.pressure > 0 ? '#e74c3c' : '#95a5a6' },
                ]}
              >
                {realTimeData.pressure ?? 0} mmHg
              </Text>
            </View>

            <View style={styles.measurementRow}>
              <Text style={styles.measurementLabel}>Status:&nbsp;</Text>
              <Text
                style={[
                  styles.measurementValue,
                  { color: realTimeData.isDeflating ? '#f39c12' : '#3498db' },
                ]}>
                {realTimeData.isDeflating ? 'Deflating...' : 'Inflating...'}
              </Text>
            </View>

            {realTimeData.hasPulse && realTimeData.pulseRate > 0 && (
              <View style={styles.measurementRow}>
                <Text style={styles.measurementLabel}>Pulse Detected:&nbsp;</Text>
                <Text style={[styles.measurementValue, { color: '#27ae60' }]}>
                  {realTimeData.pulseRate} BPM
                </Text>
              </View>
            )}
          </>
        )}

        {realTimeData.type === 'BP' && (
          <>
            <View style={styles.measurementRow}>
              <Text style={styles.measurementLabel}>Result:&nbsp;</Text>
              <Text style={[styles.measurementValue, { color: '#2c3e50', fontSize: 18 }]}>
                {realTimeData.systolic ?? 0}/{realTimeData.diastolic ?? 0} mmHg
              </Text>
            </View>

            {typeof realTimeData.mean === 'number' && (
              <View style={styles.measurementRow}>
                <Text style={styles.measurementLabel}>Mean:&nbsp;</Text>
                <Text style={[styles.measurementValue]}>{realTimeData.mean} mmHg</Text>
              </View>
            )}

            <View style={styles.measurementRow}>
              <Text style={styles.measurementLabel}>Pulse:&nbsp;</Text>
              <Text style={[styles.measurementValue, { color: '#27ae60' }]}>
                {realTimeData.pulse ?? 0} BPM
              </Text>
            </View>
          </>
        )}

        {isMeasuring && (
          <View style={styles.measuringIndicator}>
            <ActivityIndicator size="small" color={globalStyles.primaryColor.color} />
            <Text style={styles.measuringText}>
              {realTimeData?.type === 'BP_PROGRESS' ? 'Measuring…' : 'Measurement in progress…'}
            </Text>
          </View>
        )}
      </View>
    );
  };

  // const displayData = getDisplayData();
  // const chartData = displayData.slice(0, 7).reverse();
  // const xLabels = generateXLabels(chartData);
  const displayData = getDisplayData();

// FIXED: Use all historical data from the filtered period, sorted chronologically
const chartData = [...historicalData].sort((a, b) => {
  const dateA = new Date(a.timestamp || a.date);
  const dateB = new Date(b.timestamp || b.date);
  return dateA - dateB; // Sort oldest to newest for proper timeline
});

const xLabels = generateXLabels(chartData);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: globalStyles.primaryColor.color }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack}>
            <Image style={styles.backIcon} source={require('./assets/icon_back.png')} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Blood Pressure</Text>
        </View>
      </SafeAreaView>

      {renderConnectionStatus()}
      {renderDeviceControls()}
      {renderRealTimeData()}

      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'LIST' && styles.activeTab]}
          onPress={() => setActiveTab('LIST')}>
          <Text style={[styles.tabText, activeTab === 'LIST' && styles.activeTabText]}>
            LIST
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'GRAPH' && styles.activeTab]}
          onPress={() => setActiveTab('GRAPH')}>
          <Text style={[styles.tabText, activeTab === 'GRAPH' && styles.activeTabText]}>
            GRAPH
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'LIST' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[globalStyles.primaryColor.color]}
            />
          }>
          {historicalData.length > 0 && (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>
                Last {filterDays} Days
              </Text>
            </View>
          )}

          {historicalData.length === 0 ? (
            <View style={{padding: 20, alignItems: 'center'}}>
              <Text style={{color: '#666'}}>No blood pressure readings yet.</Text>
            </View>
          ) : (
            <>
              {historicalData.map(item => (
                <View key={`historical-${item.id}`} style={styles.dayBlock}>
                  <View style={styles.dateHeader}>
                    <Text style={styles.dateHeaderText}>{item.date}</Text>
                  </View>

                  <View style={styles.card}>
                    <Text style={styles.timeText}>{item.time}</Text>
                    <View style={styles.row}>
                      <Text style={styles.bpText}>
                        {item.systolic}/{item.diastolic}
                        <Text style={styles.unit}> mmHg</Text>
                      </Text>
                      <Text style={styles.bpmText}>
                        {item.bpm}
                        <Text style={styles.unitSmall}> bpm</Text>
                      </Text>
                    </View>

                    <View style={styles.colorBarWrapper}>
                      <View style={[styles.colorSegment, {backgroundColor: '#50b36d'}]} />
                      <View style={[styles.colorSegment, {backgroundColor: '#9bd47d'}]} />
                      <View style={[styles.colorSegment, {backgroundColor: '#ffd060'}]} />
                      <View style={[styles.colorSegment, {backgroundColor: '#ffa43b'}]} />
                      <View style={[styles.colorSegment, {backgroundColor: '#ff7a2b'}]} />

                      <View
                        style={[
                          styles.marker,
                          {left: `${getMarkerLeftPercent(item.systolic)}%`},
                        ]}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        <View style={{flex: 1}}>
          <ScrollView
            contentContainerStyle={styles.graphScrollContent}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[globalStyles.primaryColor.color]}
              />
            }>
            <View style={styles.graphHeader}>
              <Text style={styles.graphTitle}>Blood Pressure Trends</Text>
              <TouchableOpacity 
                style={styles.filterIconButton}
                onPress={() => setShowFilterModal(true)}
              >
                <Image 
                  source={require('./assets/filter_icon.png')} 
                  style={styles.filterIcon}
                />
              </TouchableOpacity>
            </View>

            <View style={styles.graphCard}>
              <View style={styles.graphHeader}>
                <View style={[styles.iconCircle, {backgroundColor: '#7acb6a'}]}>
                  <Text style={styles.iconText}>👤</Text>
                </View>
                <Text style={styles.graphTitleBlue}>BLOOD PRESSURE</Text>
                <View style={{flex: 1}} />
                <Text style={styles.legendRight}>SYS ○ / DIA ▲</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <View style={{flex: 1}}>
                  <Text style={styles.smallMuted}>Today</Text>
                  <Text style={styles.smallMuted}>
                    {displayData[0]?.time ?? '—'}
                  </Text>
                  <Text style={styles.goalText}>
                    Your goal: SYS 120 / DIA 80
                  </Text>
                </View>
                <Text style={styles.bigReading}>
                  {displayData[0]
                    ? `${displayData[0].systolic}/${displayData[0].diastolic}`
                    : '—/—'}{' '}
                  <Text style={styles.mmHg}>mmHg</Text>
                </Text>
              </View>

              <BPChart
                width={SCREEN_WIDTH - 20}
                data={chartData}
                xLabels={xLabels}
              />
            </View>

            <View style={styles.graphCard}>
              <View style={styles.graphHeader}>
                <View style={[styles.iconCircle, {backgroundColor: '#cfecc5'}]}>
                  <Text style={[styles.iconText, {color: '#59b54b'}]}>♥</Text>
                </View>
                <Text style={styles.graphTitleBlue}>PULSE RATE</Text>
                <View style={{flex: 1}} />
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <View style={{flex: 1}}>
                  <Text style={styles.smallMuted}>Today</Text>
                  <Text style={styles.smallMuted}>
                    {displayData[0]?.time ?? '—'}
                  </Text>
                  <Text style={styles.goalText}>Your goal: 72</Text>
                </View>
                <Text style={styles.bigReadingRight}>
                  {displayData[0] ? `${displayData[0].bpm}` : '—'}{' '}
                  <Text style={styles.mmHg}>bpm</Text>
                </Text>
              </View>

              <BPMChart
                width={SCREEN_WIDTH - 20}
                data={chartData}
                xLabels={xLabels}
              />
            </View>
          </ScrollView>
        </View>
      )}

      {renderDeviceConnectionModal()}
      {renderFilterModal()}

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator
            size="large"
            color={globalStyles.primaryColor.color}
          />
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      )}

      {showToast && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ebf2f9' },
  header: {
    width: '100%',
    height: SCREEN_HEIGHT * 0.08,
    backgroundColor: globalStyles.primaryColor.color,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingTop: 10,
  },
  backIcon: {
    width: SCREEN_WIDTH * 0.06,
    height: SCREEN_WIDTH * 0.06,
    resizeMode: 'contain',
    tintColor: '#fff',
  },
  headerTitle: {
    color: 'white',
    fontSize: SCREEN_WIDTH * 0.05,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
    marginRight: SCREEN_WIDTH * 0.08,
  },

  deviceRow: {
  backgroundColor: '#FFFFFF', 
  borderRadius: 16, 
  borderWidth: 1, 
  borderColor: '#E5E7EB',
  padding: 12, 
  marginBottom: 12, 
  flexDirection: 'row', 
  alignItems: 'center', 
  justifyContent: 'space-between',
  marginHorizontal: 12,
  marginTop: 12,
},
deviceImage: {
  width: 42,
  height: 28,
  borderRadius: 8,
  backgroundColor: '#FFFFFF',
  borderWidth: 1,
  marginRight: 10,
},
deviceName: { 
  color: '#111827', 
  fontSize: 16, 
  fontWeight: '700' 
},
connectedText: { 
  fontSize: 12, 
  marginTop: 2 
},
batteryPill: { 
  paddingHorizontal: 10, 
  paddingVertical: 6, 
  borderRadius: 999, 
  backgroundColor: '#FFFFFF', 
  borderWidth: 1 
},
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: '#fff',
    margin: 10,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  batterySection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
  },
  connectSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIndicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#333',
  },
batteryText: { 
  color: '#374151', 
  fontWeight: '700' 
},
  connectButtonSmall: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 100,
    alignItems: 'center',
  },
  connectButtonActive: {
    backgroundColor: globalStyles.primaryColor.color,
  },
  connectButtonTextSmall: {
    color: '#666',
    fontSize: 14,
    fontWeight: '600',
  },
  controlsContainer: {
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  controlButton: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 10,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  controlButtonActive: {
    backgroundColor: '#F44336',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  realTimeContainer: {
    backgroundColor: '#fff',
    padding: 18,
    margin: 10,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  realTimeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
    color: '#333',
  },
  measurementRow: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'center',
  },
  measurementLabel: {
    fontWeight: '600',
    color: '#666',
    fontSize: 14,
  },
  measurementValue: {
    color: '#333',
    fontWeight: 'bold',
    fontSize: 14,
  },
  measuringIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  measuringText: {
    marginLeft: 8,
    color: '#666',
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    width: '80%',
    maxWidth: 300
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
    color: '#333',
  },
  modalSubtitle: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
    color: '#666',
  },
  modalText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  deviceList: {
    maxHeight: 200,
    width: '100%',
    marginVertical: 16,
  },
  noDevicesContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noDevicesText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
deviceIcon: {
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: '#f0f0f0',
  justifyContent: 'center',
  alignItems: 'center',
  marginRight: 12,
  overflow: 'hidden',
},
deviceIconImage: {
  width: 24,
  height: 24,
},
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontWeight: '600',
    fontSize: 16,
    color: '#333',
  },
  deviceId: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  connectIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: globalStyles.primaryColor.color,
    borderRadius: 12,
  },
  connectIndicatorText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  modalButtons: {
    width: '100%',
    marginBottom: 16,
  },
  primaryButton: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  secondaryButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  closeButton: {
    padding: 12,
    alignItems: 'center',
    width: '100%',
  },
  closeButtonText: {
    color: '#666',
    fontSize: 16,
    fontWeight: '500',
  },
  connectButton: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
    marginBottom: 10,
    width: '100%',
    alignItems: 'center',
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 10,
    marginTop: 10,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    width: '100%',
  },
  filterOptionActive: {
    backgroundColor: '#f8f9fa',
  },
  filterOptionText: {
    fontSize: 16,
    color: '#333',
  },
  filterOptionTextActive: {
    color: globalStyles.primaryColor.color,
    fontWeight: '600',
  },
  selectedIndicator: {
    color: globalStyles.primaryColor.color,
    fontSize: 18,
    fontWeight: 'bold',
  },
  graphHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
  },
  graphTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  filterIconButton: {
    padding: 8,
  },
  filterIcon: {
    width: 34,
    height: 34,
    tintColor: globalStyles.primaryColor.color,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 15,
    backgroundColor: '#f8f9fa',
    marginBottom: 8,
    borderLeftWidth: 4,
    borderLeftColor: globalStyles.primaryColor.color,
  },
  sectionHeaderText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#333',
  },
  tabContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    backgroundColor: globalStyles.primaryColor.color,
    paddingVertical: SCREEN_HEIGHT * 0.01,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
  },
  activeTab: {
    borderBottomWidth: 3,
    borderBottomColor: '#fff',
  },
  tabText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 16,
    fontWeight: '600',
  },
  activeTabText: {
    color: '#fff',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
  },
  dayBlock: {
    marginBottom: 15,
  },
  dateHeader: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#e6f2ff',
    borderRadius: 6,
    marginBottom: 8,
  },
  dateHeaderText: {
    color: '#2c80ff',
    fontWeight: '600',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  timeText: {
    color: '#666',
    fontSize: 12,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bpText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  bpmText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
  },
  unit: {
    fontSize: 14,
    fontWeight: 'normal',
  },
  unitSmall: {
    fontSize: 12,
    fontWeight: 'normal',
  },
  colorBarWrapper: {
    height: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 4,
    flexDirection: 'row',
    overflow: 'hidden',
    position: 'relative',
  },
  colorSegment: {
    flex: 1,
    height: '100%',
  },
  marker: {
    position: 'absolute',
    top: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#2c80ff',
  },
  graphScrollContent: {
    padding: 10,
  },
  graphCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  iconText: {
    fontSize: 16,
  },
  graphTitleBlue: {
    color: '#2c80ff',
    fontWeight: 'bold',
    fontSize: 16,
  },
  legendRight: {
    color: '#666',
    fontSize: 12,
  },
  divider: {
    height: 1,
    backgroundColor: '#eee',
    marginVertical: 10,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  smallMuted: {
    color: '#666',
    fontSize: 12,
  },
  goalText: {
    color: '#2c80ff',
    fontSize: 12,
    marginTop: 4,
  },
  bigReading: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  bigReadingRight: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'right',
  },
  mmHg: {
    fontSize: 14,
    fontWeight: 'normal',
    color: '#666',
  },
  toastContainer: {
    position: 'absolute',
    bottom: 50,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    zIndex: 1000,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
});