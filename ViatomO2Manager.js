// ViatomO2Manager.js
import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

const LINKING_ERROR =
  `The package 'ViatomO2Manager' doesn't seem to be linked. Make sure:\n\n` +
  (Platform.OS === 'ios' ? "- You have run 'pod install'\n" : '') +
  '- Rebuilt the app after installing the package\n' +
  '- You are not using Expo Go (needs a custom dev client)\n';

const Native = NativeModules.ViatomO2Manager
  ? NativeModules.ViatomO2Manager
  : new Proxy({}, { get() { throw new Error(LINKING_ERROR); } });

const emitter = new NativeEventEmitter(Native);

export const O2Events = {
  Discovered: 'onO2DeviceDiscovered',
  Connected: 'onO2DeviceConnected',
  Disconnected: 'onO2DeviceDisconnected',
  Ready: 'onO2Ready',
  Info: 'onO2Info',
  RealTime: 'onO2RealTime',
  PPG: 'onO2PPG',
  Error: 'onO2Error',
};

export function addListener(event, cb) { return emitter.addListener(event, cb); }
export function startScan() { return Native.startO2Scan(); }
export function stopScan() { return Native.stopO2Scan(); }
export function connect(deviceId) { return Native.connectO2(deviceId); }
export function disconnect() { return Native.disconnectO2(); }

export default { O2Events, addListener, startScan, stopScan, connect, disconnect };
