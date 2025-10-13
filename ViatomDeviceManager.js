// manager.js
import { NativeEventEmitter, NativeModules } from 'react-native';

const { ViatomDeviceManager } = NativeModules;
const eventEmitter = new NativeEventEmitter(ViatomDeviceManager);

export default {
  // Scanning & Connection
  startScan: () => ViatomDeviceManager.startScan(),
  stopScan: () => ViatomDeviceManager.stopScan(),
  connectToDevice: (deviceId) => ViatomDeviceManager.connectToDevice(deviceId),
  disconnectDevice: () => ViatomDeviceManager.disconnectDevice(),

  // Blood Pressure Methods
  startBPMeasurement: () => ViatomDeviceManager.startBPMeasurement(),
  stopBPMeasurement: () => ViatomDeviceManager.stopBPMeasurement(),
  requestBPConfig: () => ViatomDeviceManager.requestBPConfig(),

  // NOTE: native method is requestBPRunStatus (not requestBPRealStatus)
  requestBPRunStatus: () => ViatomDeviceManager.requestBPRunStatus(),
  syncBPConfig: (config) => ViatomDeviceManager.syncBPConfig(config),

  // Device Info
  requestDeviceInfo: () => ViatomDeviceManager.requestDeviceInfo(),
  requestBatteryInfo: () => ViatomDeviceManager.requestBatteryInfo(),

  // Mode Switching
  enterECGMode: () => ViatomDeviceManager.enterECGMode(),
  enterHistoryMode: () => ViatomDeviceManager.enterHistoryMode(),

  // Event Listeners
  addListener: (eventName, callback) => eventEmitter.addListener(eventName, callback),
  removeAllListeners: (eventName) => eventEmitter.removeAllListeners(eventName),
};
