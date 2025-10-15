// BloodPressure.js
import React, {useState, useMemo, useEffect, useRef} from 'react';
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
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

const {width: SCREEN_WIDTH, height: SCREEN_HEIGHT} = Dimensions.get('window');

const X_LABELS = ['9/6', '9/7', '9/8', '9/9', '9/10', '9/11', 'Today'];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const getMarkerLeftPercent = systolic => {
  const min = 90;
  const max = 180;
  const v = clamp(systolic, min, max);
  return ((v - min) / (max - min)) * 100;
};

function BPChart({width, data}) {
  const padding = {left: 10, right: 48, top: 18, bottom: 26};
  const w = width - 2;
  const h = SCREEN_HEIGHT * 0.22;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const Y_MIN = 60;
  const Y_MAX = 160;
  const bracketLabels = [160, 135, 110, 85, 60];

  // If not enough points, return a small placeholder
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

  const sysPoints = data
    .map((d, i) => `${xFor(i)},${yFor(d.systolic)}`)
    .join(' ');
  const diaPoints = data
    .map((d, i) => `${xFor(i)},${yFor(d.diastolic)}`)
    .join(' ');

  const diaAreaPoints = useMemo(() => {
    const topLine = data
      .map((d, i) => `${xFor(i)},${yFor(d.diastolic)}`)
      .join(' ');
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
      <Polyline
        points={diaPoints}
        fill="none"
        stroke="#7f8c8d"
        strokeWidth="1.5"
      />
      <Polyline
        points={sysPoints}
        fill="none"
        stroke="#4a4a4a"
        strokeWidth="1.5"
      />

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
        const points = `${cx},${cy - size} ${cx - size},${cy + size} ${
          cx + size
        },${cy + size}`;
        return (
          <Polygon
            key={`dia-tri-${i}`}
            points={points}
            fill="#4a4a4a"
            opacity="0.8"
          />
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
        points={`${padding.left + chartW + 10},${todayDiaY - 6} ${
          padding.left + chartW + 4
        },${todayDiaY + 6} ${padding.left + chartW + 16},${todayDiaY + 6}`}
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

      {X_LABELS.map((lab, i) => (
        <SvgText
          key={`x-${lab}`}
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

function BPMChart({width, data}) {
  const padding = {left: 10, right: 48, top: 18, bottom: 26};
  const w = width - 2;
  const h = SCREEN_HEIGHT * 0.22;
  const chartW = w - padding.left - padding.right;
  const chartH = h - padding.top - padding.bottom;

  const Y_MIN = 50;
  const Y_MAX = 90;
  const bracketLabels = [90, 80, 70, 60, 50];

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

      <SvgLine
        x1={padding.left}
        x2={padding.left + chartW}
        y1={yFor(72)}
        y2={yFor(72)}
        stroke="#7acb6a"
        strokeWidth="1.5"
      />

      <Polyline
        points={bpmPoints}
        fill="none"
        stroke="#4a4a4a"
        strokeWidth="1.5"
      />

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

      <SvgLine
        x1={todayX}
        x2={todayX}
        y1={padding.top}
        y2={padding.top + chartH}
        stroke="#9ec6dd"
        strokeWidth="2"
      />

      {X_LABELS.map((lab, i) => (
        <SvgText
          key={`x-bpm-${lab}`}
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
  const [batteryLevel, setBatteryLevel] = useState(null);


  // dynamic list of BP readings (most recent first)
  const [bloodPressureData, setBloodPressureData] = useState([]);

  useEffect(() => {
    // --- Device discovery
    const discoverySubscription = ViatomDeviceManager.addListener('onDeviceDiscovered', (device) => {
      console.log('[BLE] Discovered:', device);
      setDevices((prev) => (prev.find((d) => d.id === device.id) ? prev : [...prev, device]));
    });

    // --- Connection
    const connectionSubscription = ViatomDeviceManager.addListener('onDeviceConnected', (device) => {
      console.log('[BLE] Connected:', device);
      setConnectedDevice(device);
    });

    const disconnectionSubscription = ViatomDeviceManager.addListener('onDeviceDisconnected', (payload) => {
      console.log('[BLE] Disconnected:', payload);
      setConnectedDevice(null);
      setRealTimeData(null);
      setIsMeasuring(false);
      if (measurementTimeoutRef.current) {
        clearTimeout(measurementTimeoutRef.current);
        measurementTimeoutRef.current = null;
      }
    });

    // --- Real-time data (progress + final)
    const dataSubscription = ViatomDeviceManager.addListener('onRealTimeData', (data) => {
      console.log('[DATA] onRealTimeData:', data);
      handleRealTimeData(data);
    });

    const resultSubscription = ViatomDeviceManager.addListener('onMeasurementResult', (data) => {
  console.log('[BP] Final Result received:', data);

  // Stop measuring in UI
  stopMeasurementUIOnly();

  const now = new Date();
  const newReading = {
    id: Date.now(),
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString(),
    systolic: Number(data.systolic),
    diastolic: Number(data.diastolic),
    bpm: Number(data.pulse),
    mean: Number(data.meanPressure),
  };

  setBloodPressureData((prev) => [newReading, ...prev].slice(0, 20));
  setRealTimeData({
    type: 'BP',
    systolic: newReading.systolic,
    diastolic: newReading.diastolic,
    pulse: newReading.bpm,
    mean: newReading.mean,
  });

  showToastMessage(
    `Measurement Complete: ${newReading.systolic}/${newReading.diastolic} mmHg, Pulse: ${newReading.bpm} BPM`,
    3000
  );
});


    // --- BP mode state
    const modeSubscription = ViatomDeviceManager.addListener('onBPModeChanged', (payload) => {
      console.log('[BP] Mode changed:', payload);
      if (payload?.active === false) {
        setIsMeasuring(false);
      }
    });

    // --- BP status (started/ending / snapshots)
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

    // --- Errors
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
      modeSubscription.remove();
      statusSubscription.remove();
      errorSubscription.remove();

      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      if (measurementTimeoutRef.current) clearTimeout(measurementTimeoutRef.current);
    };
  }, []);

  const showToastMessage = (message, duration = 2000) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(message);
    setShowToast(true);
    toastTimeoutRef.current = setTimeout(() => setShowToast(false), duration);
  };

  const handleRealTimeData = (data) => {
    if (!data || !data.type) return;

      if (data.type === 'BP_STATUS_UPDATE') {
    console.log('[UI] Battery update received:', data);
    if (typeof data.batteryLevel === 'number') {
      setBatteryLevel(data.batteryLevel);
    }
    return;
  }


    // Small cue from native when live stream requested
    if (data.type === 'BP_REALDATA_REQUESTED') {
      showToastMessage(data.message || 'Request real data.');
      setIsMeasuring(true);
      return;
    }

    // Live progress
  if (data.type === 'BP_PROGRESS' && typeof data.pressure === 'number') {
    const isDeflating = !!data.isDeflating;
    setRealTimeData({
      type: 'BP_PROGRESS',
      pressure: Number(data.pressure) || 0,
      isDeflating,
      hasPulse: !!data.hasPulse,
      pulseRate: Number(data.pulseRate) || 0,
    });

    // 🔹 Add this to show inflating/deflating text
    if (!isDeflating && (data.pressure ?? 0) > 0) {
      showToastMessage('Inflating...');
    } else if (isDeflating) {
      showToastMessage('Deflating...');
    }

    setIsMeasuring(true);
    return;
  }


    // Final result
    if (data.type === 'BP') {
      // Stop measuring in UI immediately
      stopMeasurementUIOnly();

      const now = new Date();
      const newReading = {
        id: Date.now(), // ensure stable key in list
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString(),
        systolic: Number(data.systolic),
        diastolic: Number(data.diastolic),
        bpm: Number(data.pulse),
        mean: typeof data.mean === 'number' ? Number(data.mean) : undefined,
      };

      setBloodPressureData((prev) => [newReading, ...prev].slice(0, 20));
      showToastMessage(
        `Measurement: ${newReading.systolic}/${newReading.diastolic} mmHg, Pulse: ${newReading.bpm} BPM`,
        3000
      );

      // Update the real-time panel with final result
      setRealTimeData({
        type: 'BP',
        systolic: newReading.systolic,
        diastolic: newReading.diastolic,
        pulse: newReading.bpm,
        mean: newReading.mean,
      });

      return;
    }

    // Optional: handle BP_STATUS if you want to render it
    if (data.type === 'BP_STATUS') {
      // console.log('[BP] Run Status snapshot:', data);
      return;
    }

    // ECG or other types can be ignored here
  };

  // Only update UI flags/timeouts here (native already exits BP mode)
  const stopMeasurementUIOnly = () => {
    if (measurementTimeoutRef.current) {
      clearTimeout(measurementTimeoutRef.current);
      measurementTimeoutRef.current = null;
    }
    setIsMeasuring(false);
  };

  const startScanning = () => {
    console.log('[BLE] Start scanning');
    setDevices([]);
    setIsScanning(true);
    ViatomDeviceManager.startScan();
    setTimeout(() => {
      setIsScanning(false);
      ViatomDeviceManager.stopScan();
    }, 10000);
  };

  const stopScanning = () => {
    console.log('[BLE] Stop scanning');
    setIsScanning(false);
    ViatomDeviceManager.stopScan();
  };

  const connectToDevice = (deviceId) => {
    console.log('[BLE] Connect to:', deviceId);
    ViatomDeviceManager.connectToDevice(deviceId);
  };

  const disconnectDevice = () => {
    console.log('[BLE] Disconnect');
    ViatomDeviceManager.disconnectDevice();
    setConnectedDevice(null);
    setRealTimeData(null);
    setIsMeasuring(false);
  };

  const startMeasurement = () => {
    if (!connectedDevice) {
      Alert.alert('Error', 'Please connect to a device first');
      return;
    }

    // Reset panel
    setRealTimeData(null);
    setIsMeasuring(true);

    console.log('[BP] Starting measurement (native will request live stream)');
    ViatomDeviceManager.startBPMeasurement();

    // (optional) ask for a status snapshot in parallel
    ViatomDeviceManager.requestBPRunStatus?.();

    // Align with native timeout (3 minutes)
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
    ViatomDeviceManager.stopBPMeasurement();
    stopMeasurementUIOnly();
  };

  const handleBack = () => navigation?.navigate?.('Home');

  const renderDeviceConnectionModal = () => (
    <Modal
      visible={showDeviceModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowDeviceModal(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Connect to BP Device</Text>

          {isLoading ? (
            <View style={{ alignItems: 'center', padding: 20 }}>
              <ActivityIndicator size="large" color={globalStyles.primaryColor.color} />
              <Text style={{ marginTop: 10 }}>Connecting...</Text>
            </View>
          ) : (
            <>
              <Text style={styles.modalText}>
                {connectedDevice
                  ? 'Connected to Device'
                  : isScanning
                  ? 'Scanning for devices...'
                  : 'Select a device to connect'}
              </Text>

              {!connectedDevice && (
                <>
                  <ScrollView style={{ maxHeight: 200, width: '100%', marginVertical: 10 }}>
                    {devices.length === 0 ? (
                      <Text style={{ textAlign: 'center', color: '#666', marginVertical: 10 }}>
                        {isScanning ? 'Scanning for devices...' : 'No devices found. Tap "Scan" to search.'}
                      </Text>
                    ) : (
                      devices.map((d, idx) => (
                        <TouchableOpacity
                          key={`${d.id ?? idx}`}
                          style={{ padding: 10, borderBottomWidth: 1, borderColor: '#eee' }}
                          onPress={() => connectToDevice(d.id)}
                        >
                          <Text style={{ fontWeight: '600' }}>{d.name ?? 'Unknown Device'}</Text>
                          {d.id && <Text style={{ color: '#666', fontSize: 12 }}>{d.id}</Text>}
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>

                  {!isScanning ? (
                    <TouchableOpacity style={styles.connectButton} onPress={startScanning}>
                      <Text style={styles.connectButtonText}>Scan for Devices</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity style={styles.cancelButton} onPress={stopScanning}>
                      <Text style={styles.cancelButtonText}>Stop Scanning</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowDeviceModal(false);
                  if (isScanning) stopScanning();
                }}
              >
                <Text style={styles.cancelButtonText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );

const renderConnectionStatus = () => (
  <View style={styles.connectionStatus}>
    <View
      style={[
        styles.statusIndicator,
        { backgroundColor: connectedDevice ? '#4CAF50' : '#F44336' },
      ]}
    />
    <Text style={styles.statusText}>
      {connectedDevice ? 'Connected' : 'Disconnected'}
    </Text>

    {/* Battery level display */}
    {batteryLevel !== null && (
      <Text style={{ marginLeft: 10, color: '#333', fontWeight: '600' }}>
        🔋 {batteryLevel}%
      </Text>
    )}

    <TouchableOpacity
      style={styles.connectButtonSmall}
      onPress={() => setShowDeviceModal(true)}>
      <Text style={styles.connectButtonTextSmall}>
        {connectedDevice ? 'Disconnect' : 'Connect'}
      </Text>
    </TouchableOpacity>
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

      {connectedDevice && (
        <TouchableOpacity style={[styles.controlButton, { minWidth: 100 }]} onPress={disconnectDevice}>
          <Text style={styles.controlButtonText}>Disconnect</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const renderRealTimeData = () => {
    if (!realTimeData) return null;

    return (
      <View style={styles.realTimeContainer}>
        <Text style={styles.realTimeTitle}>Real-time Data</Text>

        {/* Live Pressure */}
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

        {/* Final Result */}
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

        {/* Measuring indicator */}
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
          <Text
            style={[
              styles.tabText,
              activeTab === 'LIST' && styles.activeTabText,
            ]}>
            LIST
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'GRAPH' && styles.activeTab]}
          onPress={() => setActiveTab('GRAPH')}>
          <Text
            style={[
              styles.tabText,
              activeTab === 'GRAPH' && styles.activeTabText,
            ]}>
            GRAPH
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'LIST' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {bloodPressureData.length === 0 ? (
            <View style={{padding: 20, alignItems: 'center'}}>
              <Text style={{color: '#666'}}>
                No blood pressure readings yet.
              </Text>
            </View>
          ) : (
            bloodPressureData.map(item => (
              <View key={item.id} style={styles.dayBlock}>
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
                    <View
                      style={[
                        styles.colorSegment,
                        {backgroundColor: '#50b36d'},
                      ]}
                    />
                    <View
                      style={[
                        styles.colorSegment,
                        {backgroundColor: '#9bd47d'},
                      ]}
                    />
                    <View
                      style={[
                        styles.colorSegment,
                        {backgroundColor: '#ffd060'},
                      ]}
                    />
                    <View
                      style={[
                        styles.colorSegment,
                        {backgroundColor: '#ffa43b'},
                      ]}
                    />
                    <View
                      style={[
                        styles.colorSegment,
                        {backgroundColor: '#ff7a2b'},
                      ]}
                    />

                    <View
                      style={[
                        styles.marker,
                        {left: `${getMarkerLeftPercent(item.systolic)}%`},
                      ]}
                    />
                  </View>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      ) : (
        <View style={{flex: 1}}>
          <TouchableOpacity activeOpacity={0.8} style={styles.filterFab}>
            <Svg width={28} height={28} viewBox="0 0 24 24">
              <Polygon
                points="4,5 20,5 14,12 14,18 10,20 10,12"
                fill="#ffffff"
              />
            </Svg>
          </TouchableOpacity>

          <ScrollView
            contentContainerStyle={styles.graphScrollContent}
            showsVerticalScrollIndicator={false}>
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
                    {bloodPressureData[0]?.time ?? '—'}
                  </Text>
                  <Text style={styles.goalText}>
                    Your goal: SYS 120 / DIA 80
                  </Text>
                </View>
                <Text style={styles.bigReading}>
                  {bloodPressureData[0]
                    ? `${bloodPressureData[0].systolic}/${bloodPressureData[0].diastolic}`
                    : '—/—'}{' '}
                  <Text style={styles.mmHg}>mmHg</Text>
                </Text>
              </View>

              <BPChart
                width={SCREEN_WIDTH - 20}
                data={bloodPressureData.length ? bloodPressureData : []}
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
                    {bloodPressureData[0]?.time ?? '—'}
                  </Text>
                  <Text style={styles.goalText}>Your goal: 72</Text>
                </View>
                <Text style={styles.bigReadingRight}>
                  {bloodPressureData[0] ? `${bloodPressureData[0].bpm}` : '—'}{' '}
                  <Text style={styles.mmHg}>bpm</Text>
                </Text>
              </View>

              <BPMChart
                width={SCREEN_WIDTH - 20}
                data={bloodPressureData.length ? bloodPressureData : []}
              />
            </View>
          </ScrollView>
        </View>
      )}

      {renderDeviceConnectionModal()}

      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator
            size="large"
            color={globalStyles.primaryColor.color}
          />
          <Text style={styles.loadingText}>Processing...</Text>
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
  container: {
    flex: 1,
    backgroundColor: '#ebf2f9',
  },
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
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#fff',
    margin: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 2},
    elevation: 2,
  },
  statusIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  statusText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  connectButtonSmall: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  connectButtonTextSmall: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  controlsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 10,
    backgroundColor: '#fff',
    margin: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 2},
    elevation: 2,
  },
  controlButton: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
    minWidth: 140,
    alignItems: 'center',
  },
  controlButtonActive: {
    backgroundColor: '#F44336',
  },
  controlButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  realTimeContainer: {
    backgroundColor: '#fff',
    padding: 15,
    margin: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 2},
    elevation: 2,
  },
  realTimeTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  measurementRow: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  measurementLabel: {
    fontWeight: '600',
    color: '#666',
  },
  measurementValue: {
    color: '#333',
    fontWeight: 'bold',
  },
  measuringIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  measuringText: {
    marginLeft: 8,
    color: '#666',
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
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  modalText: {
    fontSize: 16,
    marginBottom: 20,
    textAlign: 'center',
  },
  connectButton: {
    backgroundColor: globalStyles.primaryColor.color,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 5,
    marginBottom: 10,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    padding: 10,
  },
  cancelButtonText: {
    color: '#666',
    fontSize: 16,
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
    paddingVertical: 10,
  },
  activeTab: {
    borderBottomWidth: 2,
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
    borderRadius: 8,
    padding: 15,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 2},
    elevation: 2,
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
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 3,
    shadowOffset: {width: 0, height: 2},
    elevation: 2,
  },
  graphHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
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
  filterFab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: globalStyles.primaryColor.color,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: {width: 0, height: 2},
    elevation: 5,
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