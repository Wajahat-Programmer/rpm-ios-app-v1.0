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

// Added to align with deploy-first flow
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
  if (absval > 1000) {
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

  peripheral.delegate = self.viatomUtils;
  self.viatomUtils.peripheral = peripheral;
  self.viatomUtils.delegate = self;
  self.viatomUtils.deviceDelegate = self;

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

- (void)util:(VTMURATUtils *)util
commandCompletion:(u_char)cmdType
 deviceType:(VTMDeviceType)deviceType
    response:(NSData *)response
{
  RCTLogInfo(@"[Viatom] commandCompletion cmd:0x%02X devType:%d respLen:%lu",
             cmdType, deviceType, (unsigned long)response.length);

  BOOL handled = NO;

  // Extended 32-byte BP real data (newer firmwares)
if (cmdType == VTMBPCmdGetRealData && response.length == 32) {

    const uint8_t *p = (const uint8_t *)response.bytes;
    short rawPressure = (short)(p[1] | (p[2] << 8));
    double pressure = rawPressure / 100.0;
    int deflating = p[0];
    int hasPulse = p[3];
    int pulseRate = (p[4] | (p[5] << 8));

    NSLog(@"[BP] Real-time Data (Extended) - Pressure:%.2f Deflating:%u Pulse:%u GotPulse:%u",
          pressure, (unsigned)deflating, (unsigned)pulseRate, (unsigned)hasPulse);

    [self sendEventWithName:@"onRealTimeData" body:@{
        @"type": @"BP_PROGRESS",
        @"pressure": @(pressure),
        @"isDeflating": @(deflating > 0),
        @"hasPulse": @(hasPulse > 0),
        @"pulseRate": @(pulseRate),
        @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
    }];

    // ✅ Auto-stop when device stops sending or pressure drops to baseline
    static double lastPressure = 0;
    static NSDate *lastDataTime = nil;
    NSDate *now = [NSDate date];

    if (!lastDataTime) {
        lastDataTime = now;
    }

    // Detect stagnation (no change) or pressure below 10 mmHg for >3 seconds
    if (fabs(pressure - lastPressure) < 1.0) {
        if ([now timeIntervalSinceDate:lastDataTime] > 3.0 && self.isBPModeActive) {
            NSLog(@"[BP] Auto-stop triggered (no pressure change, assuming measurement complete)");
            self.isWaitingForBPResult = NO;
            [self.measurementTimeoutTimer invalidate];
            self.measurementTimeoutTimer = nil;
            [self exitBPMode];
            [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
        }
    } else {
        lastPressure = pressure;
        lastDataTime = now;
    }

    return;
}

// Detect end of measurement
if (cmdType == VTMBPCmdGetRealData && response.length == 32) {
    const uint8_t *p = (const uint8_t *)response.bytes;
    short rawPressure = (short)(p[1] | (p[2] << 8));
    double pressure = rawPressure / 100.0;
    int deflating = p[0];

    // ✅ If pressure is near zero and deflating stopped → send complete signal
    if (pressure < 5.0 && deflating == 0 && self.isBPModeActive && self.isWaitingForBPResult) {
        NSLog(@"[BP] Measurement ended automatically (pressure dropped).");
        [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
        self.isWaitingForBPResult = NO;
        [self.measurementTimeoutTimer invalidate];
        self.measurementTimeoutTimer = nil;
        [self exitBPMode];
        return;
    }
}
// Track previous pressure to detect completion
static double lastPressure = 0;
static int stableCount = 0;

if (cmdType == VTMBPCmdGetRealData && response.length == 32) {
    const uint8_t *p = (const uint8_t *)response.bytes;
    short rawPressure = (short)(p[1] | (p[2] << 8));
    double pressure = rawPressure / 100.0;
    int deflating = p[0];

    if (self.isBPModeActive && self.isWaitingForBPResult) {
        // If pressure < 10 for several updates → measurement done
        if (pressure < 10.0) {
            stableCount++;
            if (stableCount >= 3) { // three consecutive low readings
                NSLog(@"[BP] Auto-stop detected: pressure stable near 0.");
                [self sendEventWithName:@"onBPStatusChanged"
                                   body:@{@"status": @"measurement_completed"}];
                [self exitBPMode];
                self.isWaitingForBPResult = NO;
                [self.measurementTimeoutTimer invalidate];
                self.measurementTimeoutTimer = nil;
                stableCount = 0;
                lastPressure = 0;
                return;
            }
        } else {
            stableCount = 0;
        }
        lastPressure = pressure;
    }
}

  // 1) SDK-based parsing (preferred)
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
        @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
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
        @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
      }];

      self.isWaitingForBPResult = NO;
      [self.measurementTimeoutTimer invalidate];
      self.measurementTimeoutTimer = nil;
      [self exitBPMode];
      handled = YES;
    }
  }

  // 2) Status (battery / run status)
  if (cmdType == VTMBPCmdGetRealStatus) {
    VTMBPRunStatus runStatus = [VTMBLEParser parseBPRealTimeStatus:response];

    RCTLogInfo(@"[BP] Run Status: %d Battery:%d%%",
               runStatus.status, runStatus.battery.percent);

    [self sendEventWithName:@"onRealTimeData" body:@{
      @"type": @"BP_STATUS_UPDATE",
      @"status": @(runStatus.status),
      @"batteryLevel": @(runStatus.battery.percent),
      @"isCharging": @(runStatus.battery.state > 0),
      @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
    }];

    // Also dispatch a dedicated BP status changed so UI can update battery quickly
    [self sendEventWithName:@"onBPStatusChanged" body:@{
      @"status": @"battery_update",
      @"batteryLevel": @(runStatus.battery.percent),
      @"isCharging": @(runStatus.battery.state > 0)
    }];

    handled = YES;
  }

  // 3) Fallback heuristic by payload length (if SDK parser didn't handle)
  if (!handled) {
    const uint8_t *p = (const uint8_t *)response.bytes;
    const NSUInteger n = response.length;

    // VTMBPMeasuringData = 21 bytes
    if (n == 21) {
      u_char is_deflating = p[0];
      short pressure_raw = vt_s16le(p+1);
      u_char is_get_pulse = p[3];
      u_short pulse_rate = vt_u16le(p+4);
      u_char is_deflating_2 = p[6];
      const double mmHg = vt_normalize_pressure(pressure_raw);

      [self sendEventWithName:@"onRealTimeData" body:@{
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
      short pressure_raw = vt_s16le(p+1);
      u_short sys = vt_u16le(p+3);
      u_short dia = vt_u16le(p+5);
      u_short mean = vt_u16le(p+7);
      u_short pulse = vt_u16le(p+9);
      u_char state_code = p[11];
      u_char medical_result = p[12];

      const double endRealtimeMmHg = vt_normalize_pressure(pressure_raw);
      NSLog(@"[BP_RESULT] sys=%u dia=%u mean=%u pulse=%u endRealtime=%.2f state=%u med=%u",
            sys, dia, mean, pulse, endRealtimeMmHg, state_code, medical_result);

      [self sendEventWithName:@"onRealTimeData" body:@{
        @"type": @"BP",
        @"systolic": @(sys),
        @"diastolic": @(dia),
        @"mean": @(mean),
        @"pulse": @(pulse),
        @"stateCode": @(state_code),
        @"medicalResult": @(medical_result),
        @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
      }];

      [self sendEventWithName:@"onMeasurementResult" body:@{
        @"type": @"BP_RESULT",
        @"systolic": @(sys),
        @"diastolic": @(dia),
        @"pulse": @(pulse),
        @"meanPressure": @(mean),
        @"stateCode": @(state_code),
        @"medicalResult": @(medical_result),
        @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
      }];

      // End measurement housekeeping
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
      [self sendEventWithName:@"onRealTimeData" body:@{
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

#pragma mark - Device info callback

- (void)deviceInfo:(VTMDeviceInfo)info {
  NSLog(@"Device Info: type=0x%04x fw=%u", info.device_type, info.fw_version);
  if (self.connectedPeripheral) {
    [self sendEventWithName:@"onDeviceConnected"
                       body:@{
                         @"name": self.connectedPeripheral.name ?: @"Unknown",
                         @"id": self.connectedPeripheral.identifier.UUIDString,
                         @"deviceType": @(info.device_type),
                         @"fwVersion": @(info.fw_version)
                       }];
  }
}

#pragma mark - Helpers

- (void)exitBPMode {
  if (self.isBPModeActive) {
    [self.viatomUtils requestChangeBPState:1];
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

  // Add a short delay to allow the device to flip into BP mode, then request real data
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self.viatomUtils requestBPRealData];
  });

  [self sendEventWithName:@"onRealTimeData"
                     body:@{@"type": @"BP_REALDATA_REQUESTED",
                            @"message": @"Request real data."}];

  [self.measurementTimeoutTimer invalidate];
  self.measurementTimeoutTimer =
    [NSTimer scheduledTimerWithTimeInterval:180.0
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
  CBPeripheral *target = nil;
  for (CBPeripheral *p in self.discoveredPeripherals) {
    if ([p.identifier isEqual:uuid]) { target = p; break; }
  }
  if (target) {
    [self.centralManager connectPeripheral:target options:nil];
  } else {
    [self sendEventWithName:@"onDeviceError" body:@{@"error": @"Device not found", @"deviceId": deviceId}];
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
    // Request run status / battery but DO NOT exit BP mode here.
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
