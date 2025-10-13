#import "ViatomDeviceManager.h"
#import <VTMProductLib/VTMProductLib.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLog.h>

// --------------------------------------
// Singleton subclass as recommended by SDK
// --------------------------------------
@interface ViatomURATUtilsSingleton : VTMURATUtils <CBPeripheralDelegate>
+ (instancetype)sharedInstance;
@end

@implementation ViatomURATUtilsSingleton
+ (instancetype)sharedInstance {
    static ViatomURATUtilsSingleton *sharedInstance = nil;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        sharedInstance = [[self alloc] init];
    });
    return sharedInstance;
}
@end

@interface ViatomDeviceManager() <CBCentralManagerDelegate, VTMURATUtilsDelegate, VTMURATDeviceDelegate>
@property (nonatomic, strong) CBCentralManager *centralManager;
@property (nonatomic, strong) ViatomURATUtilsSingleton *viatomUtils;
@property (nonatomic, strong) NSMutableArray *discoveredPeripherals;
@property (nonatomic, strong) CBPeripheral *connectedPeripheral;
@property (nonatomic, assign) BOOL isBPModeActive;
@property (nonatomic, assign) BOOL isWaitingForBPResult;
@property (nonatomic, strong) NSTimer *measurementTimeoutTimer;

// added to align with deploy-first flow
@property (nonatomic, assign) BOOL isDeployed;
@property (nonatomic, assign) BOOL pendingStart;
@end

@implementation ViatomDeviceManager

RCT_EXPORT_MODULE();

- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"onDeviceDiscovered",
    @"onDeviceConnected",
    @"onDeviceDisconnected",
    @"onRealTimeData",
    @"onDeviceError",
    @"onBPModeChanged",
    @"onBPConfigReceived",
    @"onBPStatusChanged",
    @"onMeasurementResult"
  ];
}

- (instancetype)init {
  self = [super init];
  if (self) {
    self.centralManager = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue()];
    self.discoveredPeripherals = [NSMutableArray array];
    self.viatomUtils = [ViatomURATUtilsSingleton sharedInstance];
    self.viatomUtils.delegate = self;
    self.viatomUtils.deviceDelegate = self;
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup { return YES; }

- (void)dealloc {
  [self.measurementTimeoutTimer invalidate];
  self.measurementTimeoutTimer = nil;
}

#pragma mark - Utils

static inline double vt_normalize_pressure(short raw) {
  int absval = (raw >= 0 ? raw : -raw);
  if (absval > 1000) { // e.g., 12000 -> 120.00 mmHg
    return ((double)raw) / 100.0;
  }
  return (double)raw;
}

static inline uint16_t vt_u16le(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static inline int16_t  vt_s16le(const uint8_t *p) { return (int16_t)(p[0] | (p[1] << 8)); }

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  if (central.state == CBManagerStatePoweredOn) {
    [self.centralManager scanForPeripheralsWithServices:nil
                                                options:@{CBCentralManagerScanOptionAllowDuplicatesKey: @NO}];
  } else {
    [self sendEventWithName:@"onDeviceError"
                       body:@{@"error": @"Bluetooth not available",
                              @"state": @(central.state)}];
  }
}

- (void)centralManager:(CBCentralManager *)central
   didDiscoverPeripheral:(CBPeripheral *)peripheral
       advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                    RSSI:(NSNumber *)RSSI {

  NSString *deviceName = peripheral.name ?: advertisementData[CBAdvertisementDataLocalNameKey];
  if (!deviceName) deviceName = @"Unknown";

  NSArray *supportedPrefixes = @[@"Viatom", @"ER1", @"ER2", @"BP2A", @"BP2", @"BP2W", @"Checkme"];
  BOOL isSupportedDevice = NO;
  for (NSString *prefix in supportedPrefixes) {
    if ([deviceName hasPrefix:prefix]) { isSupportedDevice = YES; break; }
  }

  if (isSupportedDevice && RSSI.integerValue > -80) {
    if (![self.discoveredPeripherals containsObject:peripheral]) {
      [self.discoveredPeripherals addObject:peripheral];
      [self sendEventWithName:@"onDeviceDiscovered"
                         body:@{@"name": deviceName,
                                @"id": peripheral.identifier.UUIDString,
                                @"rssi": RSSI ?: @0}];
    }
  }
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
  [self.centralManager stopScan];
  self.connectedPeripheral = peripheral;

  // Let the SDK receive CoreBluetooth callbacks
  peripheral.delegate = self.viatomUtils;

  self.viatomUtils.peripheral = peripheral;
  self.viatomUtils.delegate = self;       // generic responses come here
  self.viatomUtils.deviceDelegate = self; // deploy callbacks come here

  self.isDeployed = NO;
  self.pendingStart = NO;

  [self sendEventWithName:@"onDeviceConnected"
                     body:@{@"name": peripheral.name ?: @"Unknown",
                            @"id": peripheral.identifier.UUIDString}];
}

- (void)centralManager:(CBCentralManager *)central
didFailToConnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
  [self sendEventWithName:@"onDeviceError"
                     body:@{@"error": @"Failed to connect",
                            @"deviceId": peripheral.identifier.UUIDString,
                            @"message": error.localizedDescription ?: @"Unknown error"}];
}

- (void)centralManager:(CBCentralManager *)central
 didDisconnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error {
  [self sendEventWithName:@"onDeviceDisconnected"
                     body:@{@"name": peripheral.name ?: @"Unknown",
                            @"id": peripheral.identifier.UUIDString,
                            @"error": error ? error.localizedDescription : @"Normal disconnection"}];
  self.connectedPeripheral = nil;
  self.isBPModeActive = NO;
  self.isWaitingForBPResult = NO;
  [self.measurementTimeoutTimer invalidate];
  self.measurementTimeoutTimer = nil;
  self.isDeployed = NO;
  self.pendingStart = NO;
}

#pragma mark - VTMURATDeviceDelegate (deploy)

- (void)utilDeployCompletion:(VTMURATUtils * _Nonnull)util {
  NSLog(@"[SDK] Deploy completed ✅");
  self.isDeployed = YES;

  // Optional: ask basic info/config after deploy
  [self.viatomUtils requestDeviceInfo];
  [self.viatomUtils requestBPConfig];

  if (self.pendingStart) {
    self.pendingStart = NO;
    [self _startBPAfterReady];
  }
}

- (void)utilDeployFailed:(VTMURATUtils * _Nonnull)util {
  NSLog(@"[SDK] Deploy failed ❌");
  self.isDeployed = NO;
  [self sendEventWithName:@"onDeviceError"
                     body:@{@"error": @"Device setup failed"}];
}

#pragma mark - VTMURATUtilsDelegate (generic parser path)

// Unified handler for all command completions.
// (Includes your 21/20/2-byte heuristic as a fallback.)
- (void)util:(VTMURATUtils *)util
commandCompletion:(u_char)cmdType
 deviceType:(VTMDeviceType)deviceType
    response:(NSData *)response
{
  RCTLogInfo(@"[Viatom] commandCompletion cmd:0x%02X devType:%d respLen:%lu",
             cmdType, deviceType, (unsigned long)response.length);

  BOOL handled = NO;

  // 1) SDK-based parsing
  if (cmdType == VTMBPCmdGetRealData) {
    VTMBPRealTimeData realTimeData = [VTMBLEParser parseBPRealTimeData:response];

    if (realTimeData.run_status.status == VTMBPStatusBPMeasuring) {
      VTMBPMeasuringData measuringData = [VTMBLEParser parseBPMeasuringData:response];

      RCTLogInfo(@"[BP] Real-time Data - Pressure:%d Deflating:%d Pulse:%d GotPulse:%d",
                 measuringData.pressure, measuringData.is_deflating,
                 measuringData.pulse_rate, measuringData.is_get_pulse);

      [self sendEventWithName:@"onRealTimeData" body:@{
        @"type": @"BP_REALTIME_DATA",
        @"pressure": @(measuringData.pressure),
        @"isDeflating": @(measuringData.is_deflating),
        @"pulseRate": @(measuringData.pulse_rate),
        @"hasPulse": @(measuringData.is_get_pulse),
        @"timestamp": [NSDate date].description
      }];
      handled = YES;
    }
    else if (realTimeData.run_status.status == VTMBPStatusBPMeasureEnd) {
      VTMBPEndMeasureData endData = [VTMBLEParser parseBPEndMeasureData:response];

      RCTLogInfo(@"[BP] Measurement Complete - SYS:%d DIA:%d Pulse:%d",
                 endData.systolic_pressure, endData.diastolic_pressure, endData.pulse_rate);

      [self sendEventWithName:@"onMeasurementResult" body:@{
        @"type": @"BP_RESULT",
        @"systolic": @(endData.systolic_pressure),
        @"diastolic": @(endData.diastolic_pressure),
        @"pulse": @(endData.pulse_rate),
        @"meanPressure": @(endData.mean_pressure),
        @"stateCode": @(endData.state_code),
        @"medicalResult": @(endData.medical_result),
        @"timestamp": [NSDate date].description
      }];

      self.isWaitingForBPResult = NO;
      [self.measurementTimeoutTimer invalidate];
      self.measurementTimeoutTimer = nil;
      [self exitBPMode];
      handled = YES;
    }
  } else if (cmdType == VTMBPCmdGetRealStatus) {
    VTMBPRunStatus runStatus = [VTMBLEParser parseBPRealTimeStatus:response];

    RCTLogInfo(@"[BP] Run Status: %d Battery:%d%%",
               runStatus.status, runStatus.battery.percent);

    [self sendEventWithName:@"onRealTimeData" body:@{
      @"type": @"BP_STATUS_UPDATE",
      @"status": @(runStatus.status),
      @"batteryLevel": @(runStatus.battery.percent),
      @"isCharging": @(runStatus.battery.state > 0)
    }];
    handled = YES;
  }

  // 2) Original heuristic (21/20/2) — used only if not handled above.
  if (!handled) {
    const uint8_t *p = (const uint8_t *)response.bytes;
    const NSUInteger n = response.length;

    // VTMBPMeasuringData = 21 bytes
    if (n == 21) {
      u_char  is_deflating   = p[0];
      short   pressure_raw   = vt_s16le(p+1);
      u_char  is_get_pulse   = p[3];
      u_short pulse_rate     = vt_u16le(p+4);
      u_char  is_deflating_2 = p[6];

      const double mmHg = vt_normalize_pressure(pressure_raw);
      NSLog(@"[BP_PROGRESS] raw=%d -> %.2f mmHg defl=%d/%d pulseFlag=%d rate=%u",
            pressure_raw, mmHg, is_deflating, is_deflating_2, is_get_pulse, pulse_rate);

      [self sendEventWithName:@"onRealTimeData"
                         body:@{
                           @"type": @"BP_PROGRESS",
                           @"pressure": @(mmHg),
                           @"isDeflating": @((BOOL)(is_deflating || is_deflating_2)),
                           @"hasPulse": @((BOOL)is_get_pulse),
                           @"pulseRate": @(pulse_rate),
                           @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
                         }];

      if ((is_deflating || is_deflating_2) && is_get_pulse) {
        [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_ending"}];
      }
      return;
    }

    // VTMBPEndMeasureData = 20 bytes
    if (n == 20) {
      // u_char is_deflating = p[0]; // unused
      short   pressure_raw   = vt_s16le(p+1);
      u_short sys            = vt_u16le(p+3);
      u_short dia            = vt_u16le(p+5);
      u_short mean           = vt_u16le(p+7);
      u_short pulse          = vt_u16le(p+9);
      u_char  state_code     = p[11];
      u_char  medical_result = p[12];

      const double endRealtimeMmHg = vt_normalize_pressure(pressure_raw);
      NSLog(@"[BP_RESULT] sys=%u dia=%u mean=%u pulse=%u endRealtime=%.2f state=%u med=%u",
            sys, dia, mean, pulse, endRealtimeMmHg, state_code, medical_result);

      [self sendEventWithName:@"onRealTimeData"
                         body:@{
                           @"type": @"BP",
                           @"systolic": @(sys),
                           @"diastolic": @(dia),
                           @"mean": @(mean),
                           @"pulse": @(pulse),
                           @"stateCode": @(state_code),
                           @"medicalResult": @(medical_result),
                           @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
                         }];

      self.isWaitingForBPResult = NO;
      [self.measurementTimeoutTimer invalidate];
      self.measurementTimeoutTimer = nil;
      [self exitBPMode];
      return;
    }

    // VTMRealTimePressure = 2 bytes (short *100)
    if (n == 2) {
      short pressure_raw = vt_s16le(p);
      const double mmHg = vt_normalize_pressure(pressure_raw);
      NSLog(@"[BP_PROGRESS:VTMRealTimePressure] raw=%d -> %.2f mmHg", pressure_raw, mmHg);

      [self sendEventWithName:@"onRealTimeData"
                         body:@{
                           @"type": @"BP_PROGRESS",
                           @"pressure": @(mmHg),
                           @"isDeflating": @NO,
                           @"hasPulse": @NO,
                           @"pulseRate": @0,
                           @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
                         }];
      return;
    }
  }
}

#if 0
// PRESERVED (disabled) — previous duplicate method to avoid selector redefinition.
/*
- (void)util:(VTMURATUtils *)util
commandCompletion:(u_char)cmdType
 deviceType:(VTMDeviceType)deviceType
    response:(NSData *)response
{
    if (cmdType == VTMBPCmdGetRealStatus) {
        VTMBPRunStatus runStatus = [VTMBLEParser parseBPRealTimeStatus:response];

        RCTLogInfo(@"[BP] Run Status: %d Battery:%d%%",
                   runStatus.status, runStatus.battery.percent);

        [self sendEventWithName:@"onRealTimeData" body:@{
            @"type": @"BP_STATUS_UPDATE",
            @"status": @(runStatus.status),
            @"batteryLevel": @(runStatus.battery.percent),
            @"isCharging": @(runStatus.battery.state > 0)
        }];
    }
}
*/
#endif

#if 0
// PRESERVED (disabled) — original free-floating heuristic block that caused compile errors.
// It is now integrated (unchanged) inside the unified commandCompletion method above.
/*
  // Heuristic by payload length (SDK doc says use VTMBLEParser; length works well too)
  //  - VTMBPMeasuringData = 21 bytes
  //  - VTMBPEndMeasureData = 20 bytes
  //  - VTMRealTimePressure  = 2 bytes (short *100)
  if (n == 21) { ... }
  if (n == 20) { ... }
  if (n == 2)  { ... }
*/
#endif

#pragma mark - (optional) Device info helper (kept as-is if your SDK emits it)
- (void)deviceInfo:(VTMDeviceInfo)info {
  NSLog(@"Device Info: type=0x%04x fw=%u", info.device_type, info.fw_version);
  if (self.connectedPeripheral) {
    [self sendEventWithName:@"onDeviceConnected"
                       body:@{ @"name": self.connectedPeripheral.name ?: @"Unknown",
                               @"id": self.connectedPeripheral.identifier.UUIDString,
                               @"deviceType": @(info.device_type),
                               @"fwVersion": @(info.fw_version) }];
  }
}

#pragma mark - Helpers

- (NSArray *)arrayFromWave:(VTMRealTimeWF)waveform {
  NSMutableArray *arr = [NSMutableArray array];
  for (int i = 0; i < waveform.sampling_num; i++) {
    [arr addObject:@(waveform.wave_data[i])];
  }
  return arr;
}

- (void)exitBPMode {
  if (self.isBPModeActive) {
    [self.viatomUtils requestChangeBPState:1]; // back to ECG/idle as per SDK doc
    self.isBPModeActive = NO;
    [self sendEventWithName:@"onBPModeChanged" body:@{@"active": @NO}];
  }
}

- (void)measurementTimeout {
  [self sendEventWithName:@"onDeviceError"
                     body:@{@"error": @"Measurement timeout",
                            @"message": @"The measurement took too long. Please try again."}];
  self.isWaitingForBPResult = NO;
  [self exitBPMode];
}

#pragma mark - Start only after deploy

- (void)_startBPAfterReady {
  // Enter BP measurement mode; SDK auto-handles inflation on enter
  [self.viatomUtils requestChangeBPState:0];
  self.isBPModeActive = YES;
  self.isWaitingForBPResult = YES;

  // Ask for realtime stream
  [self.viatomUtils requestBPRealData];

  [self sendEventWithName:@"onRealTimeData"
                     body:@{@"type": @"BP_REALDATA_REQUESTED",
                            @"message": @"Request real data."}];

  [self.measurementTimeoutTimer invalidate];
  self.measurementTimeoutTimer = [NSTimer scheduledTimerWithTimeInterval:180.0
                                                                  target:self
                                                                selector:@selector(measurementTimeout)
                                                                userInfo:nil
                                                                 repeats:NO];

  [self sendEventWithName:@"onBPModeChanged" body:@{@"active": @YES}];
  [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_started"}];
}

#pragma mark - Exposed Methods (React Native)

RCT_EXPORT_METHOD(startScan) {
  if (self.centralManager.state == CBManagerStatePoweredOn) {
    [self.discoveredPeripherals removeAllObjects];
    NSDictionary *options = @{CBCentralManagerScanOptionAllowDuplicatesKey: @NO};
    [self.centralManager scanForPeripheralsWithServices:nil options:options];
  }
}

RCT_EXPORT_METHOD(stopScan) { [self.centralManager stopScan]; }

RCT_EXPORT_METHOD(connectToDevice:(NSString *)deviceId) {
  NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:deviceId];
  CBPeripheral *peripheralToConnect = nil;
  for (CBPeripheral *peripheral in self.discoveredPeripherals) {
    if ([peripheral.identifier isEqual:uuid]) { peripheralToConnect = peripheral; break; }
  }
  if (peripheralToConnect) {
    [self.centralManager connectPeripheral:peripheralToConnect options:nil];
  } else {
    [self sendEventWithName:@"onDeviceError"
                       body:@{@"error": @"Device not found", @"deviceId": deviceId}];
  }
}

RCT_EXPORT_METHOD(disconnectDevice) {
  if (self.connectedPeripheral) {
    [self exitBPMode];
    [self.measurementTimeoutTimer invalidate];
    self.measurementTimeoutTimer = nil;
    [self.centralManager cancelPeripheralConnection:self.connectedPeripheral];
  }
}

RCT_EXPORT_METHOD(startBPMeasurement) {
  if (!self.connectedPeripheral) {
    [self sendEventWithName:@"onDeviceError" body:@{@"error": @"No device connected"}];
    return;
  }
  if (!self.isDeployed) {
    // queue until deploy is finished
    self.pendingStart = YES;
    [self sendEventWithName:@"onDeviceError" body:@{@"error": @"Waiting for device to finish setup…"}];
    return;
  }
  [self _startBPAfterReady];
}

RCT_EXPORT_METHOD(stopBPMeasurement) {
  [self.measurementTimeoutTimer invalidate];
  self.measurementTimeoutTimer = nil;
  self.isWaitingForBPResult = NO;
  [self exitBPMode];
}

RCT_EXPORT_METHOD(requestBPConfig) {
  if (self.connectedPeripheral) { [self.viatomUtils requestBPConfig]; }
}

RCT_EXPORT_METHOD(requestBPRunStatus) {
  if (self.viatomUtils && self.connectedPeripheral) {
    [self.viatomUtils bp_requestRealStatus];
  }
}

RCT_EXPORT_METHOD(syncBPConfig:(NSDictionary *)config) {
  if (self.connectedPeripheral) {
    VTMBPConfig bpConfig;
    bpConfig.prev_calib_zero = [config[@"prevCalibZero"] unsignedIntValue];
    bpConfig.last_calib_zero = [config[@"lastCalibZero"] unsignedIntValue];
    bpConfig.calib_slope = [config[@"calibSlope"] unsignedIntValue];
    bpConfig.slope_pressure = [config[@"slopePressure"] unsignedShortValue];
    bpConfig.calib_ticks = [config[@"calibTicks"] unsignedIntValue];
    bpConfig.sleep_ticks = [config[@"sleepTicks"] unsignedIntValue];
    bpConfig.bp_test_target_pressure = [config[@"bpTestTargetPressure"] unsignedShortValue];
    bpConfig.device_switch = [config[@"deviceSwitch"] unsignedCharValue];
    bpConfig.avg_measure_mode = [config[@"avgMeasureMode"] unsignedCharValue];
    bpConfig.volume = [config[@"volume"] unsignedCharValue];
    bpConfig.time_utc = [config[@"timeUTC"] unsignedCharValue];
    bpConfig.wifi_4g_switch = [config[@"wifi4gSwitch"] unsignedCharValue];
    bpConfig.unit = [config[@"unit"] unsignedCharValue];
    bpConfig.language = [config[@"language"] unsignedCharValue];
    [self.viatomUtils syncBPConfig:bpConfig];
  }
}

RCT_EXPORT_METHOD(requestDeviceInfo) {
  if (self.connectedPeripheral) { [self.viatomUtils requestDeviceInfo]; }
}

RCT_EXPORT_METHOD(requestBatteryInfo) {
  if (self.connectedPeripheral) { [self.viatomUtils requestBatteryInfo]; }
}

RCT_EXPORT_METHOD(enterECGMode) {
  if (self.connectedPeripheral) {
    [self.viatomUtils requestChangeBPState:1];
    self.isBPModeActive = NO;
  }
}

RCT_EXPORT_METHOD(enterHistoryMode) {
  if (self.connectedPeripheral) {
    [self.viatomUtils requestChangeBPState:2];
    self.isBPModeActive = NO;
  }
}

@end
