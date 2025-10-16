// ViatomDeviceManager.m
#import "ViatomDeviceManager.h"
#import <VTMProductLib/VTMProductLib.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLog.h>

@interface ViatomURATUtilsSingleton : VTMURATUtils <CBPeripheralDelegate>
+ (instancetype)sharedInstance;
@end

@implementation ViatomURATUtilsSingleton
+ (instancetype)sharedInstance {
  static ViatomURATUtilsSingleton *sharedInstance = nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{ sharedInstance = [[self alloc] init]; });
  return sharedInstance;
}
@end

@interface ViatomDeviceManager()
<CBCentralManagerDelegate, VTMURATUtilsDelegate, VTMURATDeviceDelegate>

// BLE
@property (nonatomic, strong) CBCentralManager *centralManager;
@property (nonatomic, strong) ViatomURATUtilsSingleton *viatomUtils;
@property (nonatomic, strong) NSMutableArray<CBPeripheral *> *discoveredPeripherals;
@property (nonatomic, strong) CBPeripheral *connectedPeripheral;

// BP session state
@property (nonatomic, assign) BOOL isBPModeActive;
@property (nonatomic, assign) BOOL isWaitingForBPResult;
@property (nonatomic, assign) NSInteger lowPressureStreak;

// Timers
@property (nonatomic, strong) NSTimer *measurementTimeoutTimer;
@property (nonatomic, strong) NSTimer *statusPollTimer;     // 1 Hz status/battery
@property (nonatomic, strong) NSTimer *realDataPullTimer;   // ~8 Hz realtime frames
@property (nonatomic, strong) NSTimer *lastResultWaitTimer; // 0.8 s grace period to fetch result

// Deploy-first flow
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
  if ((self = [super init])) {
    _centralManager = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue()];
    _discoveredPeripherals = [NSMutableArray array];
    _viatomUtils = [ViatomURATUtilsSingleton sharedInstance];
    _viatomUtils.delegate = self;
    _viatomUtils.deviceDelegate = self;
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup { return YES; }

- (void)dealloc {
  [self.measurementTimeoutTimer invalidate];
  [self.statusPollTimer invalidate];
  [self.realDataPullTimer invalidate];
  [self.lastResultWaitTimer invalidate];
}

#pragma mark - Byte helpers

static inline double vt_normalize_pressure(short raw) {
  int absval = (raw >= 0 ? raw : -raw);
  return (absval > 1000) ? ((double)raw) / 100.0 : (double)raw;
}
static inline uint16_t vt_u16le(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static inline int16_t  vt_s16le(const uint8_t *p) { return (int16_t)(p[0] | (p[1] << 8)); }

static BOOL vt_plausible_result_values(uint16_t sys, uint16_t dia, uint16_t mean, uint16_t pulse) {
  if (sys < 60 || sys > 260) return NO;
  if (dia < 30 || dia > 200) return NO;
  if (mean < 30 || mean > 240) return NO;
  if (!(dia <= mean && mean <= sys)) return NO;
  if (pulse < 30 || pulse > 220) return NO;
  return YES;
}

// Try to decode a 32-byte composite real-time frame (FW-dependent offsets).
static BOOL vt_decode_v2_rt32(const uint8_t *p, NSUInteger n,
                              double *outPressure, BOOL *outDefl,
                              BOOL *outHasPulse, int *outPulseRate) {
  if (n < 8) return NO;
  int offsets[] = {0, 8, 12, 16};
  for (int i = 0; i < (int)(sizeof(offsets)/sizeof(offsets[0])); i++) {
    int off = offsets[i];
    if (off + 6 > (int)n) continue;
    int def = p[off + 0];
    short rawP = vt_s16le(p + off + 1);
    double mmHg = vt_normalize_pressure(rawP);
    int gotPulse = p[off + 3];
    int pr = vt_u16le(p + off + 4);
    if (pr > 300 && pr < 30000) pr = pr / 100; // some FW scale PR*100
    BOOL plausibleP  = (mmHg >= 0.0 && mmHg <= 300.0);
    BOOL plausiblePR = (pr >= 30 && pr <= 220);
    if (plausibleP && plausiblePR) {
      *outPressure  = mmHg;
      *outDefl      = (def != 0);
      *outHasPulse  = (gotPulse != 0);
      *outPulseRate = pr;
      return YES;
    }
  }
  return NO;
}

// Try to extract a BP result from any blob (34/36/38/40/44...)
// 1) Use SDK parser: parseBPResult:
// 2) Sliding-window heuristic for (sys, dia, mean, pulse) 4*uint16_t groups.
static BOOL vt_try_extract_result(NSData *blob,
                                  uint16_t *oSys, uint16_t *oDia,
                                  uint16_t *oMean, uint16_t *oPulse) {
  if (!blob.length) return NO;

  // 1) SDK parser (BP2/BP2A-style VTMBPBPResult)
  if ([VTMBLEParser respondsToSelector:@selector(parseBPResult:)]) {
    @try {
      VTMBPBPResult r = [VTMBLEParser parseBPResult:blob];
      if (vt_plausible_result_values(r.systolic_pressure, r.diastolic_pressure, r.mean_pressure, r.pulse_rate)) {
        *oSys = r.systolic_pressure; *oDia = r.diastolic_pressure;
        *oMean = r.mean_pressure; *oPulse = r.pulse_rate;
        return YES;
      }
    } @catch (__unused NSException *e) {}
  }

  // 2) Try windows inside the buffer for a plausible 4*uint16_t pattern
  const uint8_t *p = (const uint8_t *)blob.bytes;
  const NSUInteger n = blob.length;
  for (NSUInteger i = 0; i + 8 <= n; i++) {
    uint16_t sys = vt_u16le(p + i);
    uint16_t dia = (i + 2 <= n) ? vt_u16le(p + i + 2) : 0;
    uint16_t mean = (i + 4 <= n) ? vt_u16le(p + i + 4) : 0;
    uint16_t pulse = (i + 6 <= n) ? vt_u16le(p + i + 6) : 0;
    if (vt_plausible_result_values(sys, dia, mean, pulse)) {
      *oSys = sys; *oDia = dia; *oMean = mean; *oPulse = pulse;
      return YES;
    }
  }

  return NO;
}

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  if (central.state == CBManagerStatePoweredOn) {
    [self.centralManager scanForPeripheralsWithServices:nil
                                                options:@{CBCentralManagerScanOptionAllowDuplicatesKey:@NO}];
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
  NSString *deviceName = peripheral.name ?: advertisementData[CBAdvertisementDataLocalNameKey] ?: @"Unknown";
  NSArray *supportedPrefixes = @[@"Viatom", @"ER1", @"ER2", @"BP2A", @"BP2", @"BP2W", @"Checkme"];
  BOOL ok = NO; for (NSString *pre in supportedPrefixes) { if ([deviceName hasPrefix:pre]) { ok = YES; break; } }
  if (ok && RSSI.integerValue > -80) {
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

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
  [self sendEventWithName:@"onDeviceError"
                     body:@{@"error": @"Failed to connect",
                            @"deviceId": peripheral.identifier.UUIDString,
                            @"message": error.localizedDescription ?: @"Unknown error"}];
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
  [self sendEventWithName:@"onDeviceDisconnected"
                     body:@{@"name": peripheral.name ?: @"Unknown",
                            @"id": peripheral.identifier.UUIDString,
                            @"error": error ? error.localizedDescription : @"Normal disconnection"}];
  self.connectedPeripheral = nil;
  self.isBPModeActive = NO;
  self.isWaitingForBPResult = NO;
  [self.measurementTimeoutTimer invalidate];
  [self.statusPollTimer invalidate];
  [self.realDataPullTimer invalidate];
  [self.lastResultWaitTimer invalidate];
  self.measurementTimeoutTimer = nil;
  self.statusPollTimer = nil;
  self.realDataPullTimer = nil;
  self.lastResultWaitTimer = nil;
  self.isDeployed = NO;
  self.pendingStart = NO;
}

#pragma mark - VTMURATDeviceDelegate (deploy)

- (void)utilDeployCompletion:(VTMURATUtils * _Nonnull)util {
  NSLog(@"[SDK] Deploy completed ✅");
  self.isDeployed = YES;
  [self.viatomUtils requestDeviceInfo];
  [self.viatomUtils requestBPConfig];
  if (self.pendingStart) { self.pendingStart = NO; [self _startBPAfterReady]; }
}

- (void)utilDeployFailed:(VTMURATUtils * _Nonnull)util {
  NSLog(@"[SDK] Deploy failed ❌");
  self.isDeployed = NO;
  [self sendEventWithName:@"onDeviceError" body:@{@"error": @"Device setup failed"}];
}

#pragma mark - Pollers

- (void)startStatusPoller {
  [self.statusPollTimer invalidate];
  self.statusPollTimer = [NSTimer scheduledTimerWithTimeInterval:1.0
                                                          target:self
                                                        selector:@selector(pollRunStatus)
                                                        userInfo:nil
                                                         repeats:YES];
}

- (void)stopStatusPoller {
  [self.statusPollTimer invalidate];
  self.statusPollTimer = nil;
}

- (void)pollRunStatus {
  if (self.viatomUtils && self.connectedPeripheral) {
    [self.viatomUtils bp_requestRealStatus];
  }
}

- (void)startRealDataPuller {
  [self.realDataPullTimer invalidate];
  self.realDataPullTimer = [NSTimer scheduledTimerWithTimeInterval:0.12
                                                            target:self
                                                          selector:@selector(pullRealData)
                                                          userInfo:nil
                                                           repeats:YES];
}

- (void)stopRealDataPuller {
  [self.realDataPullTimer invalidate];
  self.realDataPullTimer = nil;
}

- (void)pullRealData {
  if (self.isBPModeActive && self.connectedPeripheral) {
    [self.viatomUtils requestBPRealData];
  }
}

#pragma mark - VTMURATUtilsDelegate (generic parser path)

- (void)util:(VTMURATUtils *)util
commandCompletion:(u_char)cmdType
 deviceType:(VTMDeviceType)deviceType
    response:(NSData *)response
{
  RCTLogInfo(@"[Viatom] commandCompletion cmd:0x%02X devType:%d respLen:%lu",
             cmdType, deviceType, (unsigned long)response.length);

  // ---- BP realtime / result stream ----
  if (cmdType == VTMBPCmdGetRealData) {
    const uint8_t *p = (const uint8_t *)response.bytes;
    const NSUInteger n = response.length;

    // (A) classic 2-byte pressure only
    if (n == 2) {
      const double mmHg = vt_normalize_pressure(vt_s16le(p));
      [self sendEventWithName:@"onRealTimeData" body:@{
        @"type": @"BP_PROGRESS", @"pressure": @(mmHg),
        @"isDeflating": @NO, @"isInflating": @YES,
        @"hasPulse": @NO, @"pulseRate": @0,
        @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
      }];
      return;
    }

    // (B) 21-byte measuring snapshot (older FW)
    if (n == 21) {
      u_char is_deflating = p[0];
      short pressure_raw = vt_s16le(p+1);
      u_char is_get_pulse = p[3];
      u_short pulse_rate = vt_u16le(p+4);
      u_char is_deflating_2 = p[6];
      const double mmHg = vt_normalize_pressure(pressure_raw);

      const BOOL defl = (is_deflating || is_deflating_2);
      [self sendEventWithName:@"onRealTimeData" body:@{
        @"type": @"BP_PROGRESS",
        @"pressure": @(mmHg),
        @"isDeflating": @(defl),
        @"isInflating": @(!defl),
        @"hasPulse": @((BOOL)is_get_pulse),
        @"pulseRate": @(pulse_rate),
        @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
      }];

      // low-pressure fallback end
      if (defl && mmHg < 10.0 && self.isWaitingForBPResult) {
        self.lowPressureStreak++;
        if (self.lowPressureStreak >= 3) {
          [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
          self.isWaitingForBPResult = NO;
          [self.measurementTimeoutTimer invalidate];
          self.measurementTimeoutTimer = nil;
          [self exitBPMode];
        }
      } else { self.lowPressureStreak = 0; }
      return;
    }

    // (C) 20-byte classic end-of-measurement result (older FW)
    if (n == 20) {
      // Layout: [0:flag][1..2:pressure_raw][3..10: sys,dia,mean,pulse][11:state][12:medical]...
      uint16_t sys = vt_u16le(p + 3);
      uint16_t dia = vt_u16le(p + 5);
      uint16_t mean = vt_u16le(p + 7);
      uint16_t pulse = vt_u16le(p + 9);
      if (vt_plausible_result_values(sys, dia, mean, pulse)) {
        [self sendEventWithName:@"onMeasurementResult" body:@{
          @"type": @"BP_RESULT",
          @"systolic": @(sys), @"diastolic": @(dia),
          @"meanPressure": @(mean), @"pulse": @(pulse),
          @"stateCode": @((u_char)p[11]),
          @"medicalResult": @((u_char)p[12]),
          @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
        }];
        self.isWaitingForBPResult = NO;
        [self.measurementTimeoutTimer invalidate];
        self.measurementTimeoutTimer = nil;
        [self exitBPMode];
        return;
      }
      // fall through to generic parsing
    }

    // (D) 32-byte composite measuring frame (newer FW)
    if (n == 32) {
      double mmHg = 0.0; BOOL defl = NO; BOOL hasPulse = NO; int pr = 0;
      if (vt_decode_v2_rt32(p, n, &mmHg, &defl, &hasPulse, &pr)) {
        RCTLogInfo(@"[BP] Measuring(32) - P=%.2f, PR=%d, defl=%d, gotPulse=%d", mmHg, pr, defl, hasPulse);
        [self sendEventWithName:@"onRealTimeData" body:@{
          @"type": @"BP_PROGRESS",
          @"pressure": @(mmHg),
          @"isDeflating": @(defl), @"isInflating": @(!defl),
          @"hasPulse": @(hasPulse), @"pulseRate": @(pr),
          @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
        }];
        // low-pressure fallback
        if (defl && mmHg < 10.0 && self.isWaitingForBPResult) {
          self.lowPressureStreak++;
          if (self.lowPressureStreak >= 3) {
            [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
            self.isWaitingForBPResult = NO;
            [self.measurementTimeoutTimer invalidate];
            self.measurementTimeoutTimer = nil;
            [self exitBPMode];
          }
        } else { self.lowPressureStreak = 0; }
        return;
      }
    }

    // (E) 34/36/38/40/44-byte (BP2A FW packs BPResult in these)
    if (n == 34 || n == 36 || n == 38 || n == 40 || n == 44) {
      uint16_t sys=0,dia=0,mean=0,pulse=0;
      if (vt_try_extract_result(response, &sys, &dia, &mean, &pulse)) {
        RCTLogInfo(@"[BP] Complete(%lu) - SYS:%u DIA:%u MEAN:%u PR:%u",
                   (unsigned long)n, sys, dia, mean, pulse);
        [self sendEventWithName:@"onMeasurementResult" body:@{
          @"type": @"BP_RESULT",
          @"systolic": @(sys), @"diastolic": @(dia),
          @"meanPressure": @(mean), @"pulse": @(pulse),
          @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
        }];
        self.isWaitingForBPResult = NO;
        [self.measurementTimeoutTimer invalidate];
        self.measurementTimeoutTimer = nil;
        [self exitBPMode];
        return;
      }
      // If not a result, ignore and continue pulling.
    }

    // (F) Fallback: try SDK run-status probe for "end" inside arbitrary buffers
    @try {
      VTMBPRealTimeData rt = [VTMBLEParser parseBPRealTimeData:response];
      if (rt.run_status.status == VTMBPStatusBPMeasureEnd) {
        [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
        // Give the device a short grace window to emit result frames
        [self.lastResultWaitTimer invalidate];
        self.lastResultWaitTimer = [NSTimer scheduledTimerWithTimeInterval:0.8
                                                                    target:self
                                                                  selector:@selector(forceExitAfterNoResult)
                                                                  userInfo:nil
                                                                   repeats:NO];
        return;
      }
    } @catch (__unused NSException *e) {}
    return;
  }

  // ---- 1Hz Run status / battery ----
  if (cmdType == VTMBPCmdGetRealStatus) {
    VTMBPRunStatus s = [VTMBLEParser parseBPRealTimeStatus:response];
    RCTLogInfo(@"[BP] Run Status: %d Battery:%d%%", s.status, s.battery.percent);

    [self sendEventWithName:@"onRealTimeData" body:@{
      @"type": @"BP_STATUS_UPDATE",
      @"status": @(s.status),
      @"batteryLevel": @(s.battery.percent),
      @"isCharging": @(s.battery.state > 0),
      @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
    }];
    [self sendEventWithName:@"onBPStatusChanged" body:@{
      @"status": @"battery_update",
      @"batteryLevel": @(s.battery.percent),
      @"isCharging": @(s.battery.state > 0)
    }];

    if (self.isBPModeActive && s.status == VTMBPStatusBPMeasureEnd) {
      [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
      // Keep pulling a bit longer to catch 34/36/38/40/44 result frames
      [self.lastResultWaitTimer invalidate];
      self.lastResultWaitTimer = [NSTimer scheduledTimerWithTimeInterval:0.8
                                                                  target:self
                                                                selector:@selector(forceExitAfterNoResult)
                                                                userInfo:nil
                                                                 repeats:NO];
    }
    return;
  }
}

- (void)forceExitAfterNoResult {
  self.lastResultWaitTimer = nil;
  if (self.isBPModeActive) {
    self.isWaitingForBPResult = NO;
    [self.measurementTimeoutTimer invalidate];
    self.measurementTimeoutTimer = nil;
    [self exitBPMode];
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
    [self.viatomUtils requestChangeBPState:2]; // to History; exits BP mode safely
    self.isBPModeActive = NO;
    [self stopStatusPoller];
    [self stopRealDataPuller];
    [self.lastResultWaitTimer invalidate];
    self.lastResultWaitTimer = nil;
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
  [self.viatomUtils requestChangeBPState:0]; // enter BP
  self.isBPModeActive = YES;
  self.isWaitingForBPResult = YES;
  self.lowPressureStreak = 0;

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self.viatomUtils requestBPRealData];
    [self startRealDataPuller]; // keep pulling
  });
  [self startStatusPoller];

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

#pragma mark - RN Exports

RCT_EXPORT_METHOD(startScan) {
  if (self.centralManager.state == CBManagerStatePoweredOn) {
    [self.discoveredPeripherals removeAllObjects];
    [self.centralManager scanForPeripheralsWithServices:nil
                                                options:@{CBCentralManagerScanOptionAllowDuplicatesKey:@NO}];
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
    [self.statusPollTimer invalidate];
    [self.realDataPullTimer invalidate];
    [self.lastResultWaitTimer invalidate];
    self.measurementTimeoutTimer = nil;
    self.statusPollTimer = nil;
    self.realDataPullTimer = nil;
    self.lastResultWaitTimer = nil;
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
  if (self.viatomUtils && self.connectedPeripheral) { [self.viatomUtils bp_requestRealStatus]; }
}

RCT_EXPORT_METHOD(syncBPConfig:(NSDictionary *)config) {
  if (!self.connectedPeripheral) return;
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
