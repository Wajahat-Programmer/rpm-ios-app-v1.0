import { NativeEventEmitter, NativeModules } from 'react-native';

const { ViatomDeviceManager } = NativeModules;
const eventEmitter = new NativeEventEmitter(ViatomDeviceManager);

export default {
  startScan: () => ViatomDeviceManager.startScan(),
  stopScan: () => ViatomDeviceManager.stopScan(),
  connectToDevice: (deviceId) => ViatomDeviceManager.connectToDevice(deviceId),
  disconnectDevice: () => ViatomDeviceManager.disconnectDevice(),
  
  addListener: (eventName, callback) => eventEmitter.addListener(eventName, callback),
  removeAllListeners: (eventName) => eventEmitter.removeAllListeners(eventName),
};