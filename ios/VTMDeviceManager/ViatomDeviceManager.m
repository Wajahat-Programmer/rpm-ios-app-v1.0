// ViatomDeviceManager.m
#import "ViatomDeviceManager.h"
#import <VTMProductLib/VTMProductLib.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <React/RCTEventEmitter.h>
#import <React/RCTLog.h>

static NSString * const kViatomCentralRestoreId = @"com.rpmapp.viatom.central.restore";
static const NSTimeInterval kScanRestartDelay = 0.35;

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

@interface ViatomDeviceManager () <CBCentralManagerDelegate, VTMURATUtilsDelegate, VTMURATDeviceDelegate>

// BLE
@property (nonatomic, strong) CBCentralManager *centralManager;
@property (nonatomic, strong) ViatomURATUtilsSingleton *viatomUtils;
@property (nonatomic, strong) NSMutableDictionary<NSUUID*, CBPeripheral*> *peripheralsById; // UUID -> peripheral
@property (nonatomic, strong) NSMutableSet<NSUUID*> *seenPeripheralIds; // for duplicate filtering
@property (nonatomic, strong) CBPeripheral *connectedPeripheral;
@property (nonatomic, strong) NSUUID *lastConnectedId;

// Back-compat for JS that expects this list
@property (nonatomic, strong) NSMutableArray<CBPeripheral *> *discoveredPeripherals;

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

// scan options toggle to be a bit more aggressive right after disconnect
@property (nonatomic, assign) BOOL inRecoveryRescan;

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

+ (BOOL)requiresMainQueueSetup { return YES; }

- (instancetype)init {
  if ((self = [super init])) {
    NSDictionary *opts = @{
      CBCentralManagerOptionShowPowerAlertKey: @YES,
      CBCentralManagerOptionRestoreIdentifierKey: kViatomCentralRestoreId
    };
    _centralManager = [[CBCentralManager alloc] initWithDelegate:self
                                                           queue:dispatch_get_main_queue()
                                                         options:opts];
    _peripheralsById = [NSMutableDictionary dictionary];
    _seenPeripheralIds = [NSMutableSet set];
    _discoveredPeripherals = [NSMutableArray array]; // back-compat with JS

    _viatomUtils = [ViatomURATUtilsSingleton sharedInstance];
    _viatomUtils.delegate = self;
    _viatomUtils.deviceDelegate = self;

    _inRecoveryRescan = NO;
  }
  return self;
}

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

static BOOL vt_try_extract_result(NSData *blob,
                                  uint16_t *oSys, uint16_t *oDia,
                                  uint16_t *oMean, uint16_t *oPulse) {
  if (!blob.length) return NO;

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

  const uint8_t *p = (const uint8_t *)blob.bytes;
  const NSUInteger n = blob.length;
  for (NSUInteger i = 0; i + 8 <= n; i++) {
    uint16_t sys = vt_u16le(p + i);
    uint16_t dia = vt_u16le(p + i + 2);
    uint16_t mean = vt_u16le(p + i + 4);
    uint16_t pulse = vt_u16le(p + i + 6);
    if (vt_plausible_result_values(sys, dia, mean, pulse)) {
      *oSys = sys; *oDia = dia; *oMean = mean; *oPulse = pulse;
      return YES;
    }
  }
  return NO;
}

#pragma mark - Central creation & restoration

- (void)centralManager:(CBCentralManager *)central willRestoreState:(NSDictionary<NSString *,id> *)dict {
  NSArray *restored = dict[CBCentralManagerRestoredStatePeripheralsKey];
  for (CBPeripheral *p in restored) {
    self.peripheralsById[p.identifier] = p;
    [self.seenPeripheralIds addObject:p.identifier];
    if (p.state == CBPeripheralStateConnected || p.state == CBPeripheralStateConnecting) {
      self.connectedPeripheral = p;
      self.lastConnectedId = p.identifier;

      p.delegate = self.viatomUtils;
      self.viatomUtils.peripheral = p;
      self.viatomUtils.delegate = self;
      self.viatomUtils.deviceDelegate = self;

      [self sendEventWithName:@"onDeviceConnected"
                         body:@{@"name": p.name ?: @"Unknown",
                                @"id": p.identifier.UUIDString}];
    }
  }
}

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  if (central.state == CBManagerStatePoweredOn) {
    [self beginScanNormal];
  } else {
    [self sendEventWithName:@"onDeviceError"
                       body:@{@"error": @"Bluetooth not available",
                              @"state": @(central.state)}];
  }
}

- (void)beginScanNormal {
  [self.centralManager stopScan];
  [self.discoveredPeripherals removeAllObjects];
  [self.peripheralsById removeAllObjects];
  [self.seenPeripheralIds removeAllObjects];

  NSDictionary *opts = @{ CBCentralManagerScanOptionAllowDuplicatesKey: @NO };
  [self.centralManager scanForPeripheralsWithServices:nil options:opts];

  if (self.lastConnectedId) {
    NSArray<CBPeripheral*> *retrieved = [self.centralManager retrievePeripheralsWithIdentifiers:@[self.lastConnectedId]];
    for (CBPeripheral *p in retrieved) {
      self.peripheralsById[p.identifier] = p;
      if (![self.seenPeripheralIds containsObject:p.identifier]) {
        [self.seenPeripheralIds addObject:p.identifier];
        [self.discoveredPeripherals addObject:p];
        [self sendEventWithName:@"onDeviceDiscovered"
                           body:@{@"name": p.name ?: @"Unknown",
                                  @"id": p.identifier.UUIDString,
                                  @"rssi": @0}];
      }
    }
  }
}

- (void)beginScanRecovery {
  self.inRecoveryRescan = YES;
  [self.centralManager stopScan];
  [self.discoveredPeripherals removeAllObjects];
  [self.peripheralsById removeAllObjects];
  [self.seenPeripheralIds removeAllObjects];

  NSDictionary *opts = @{ CBCentralManagerScanOptionAllowDuplicatesKey: @YES };
  [self.centralManager scanForPeripheralsWithServices:nil options:opts];

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.8 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    self.inRecoveryRescan = NO;
    [self beginScanNormal];
  });
}

- (void)centralManager:(CBCentralManager *)central
   didDiscoverPeripheral:(CBPeripheral *)peripheral
       advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                    RSSI:(NSNumber *)RSSI
{
  NSString *deviceName = peripheral.name ?: advertisementData[CBAdvertisementDataLocalNameKey] ?: @"Unknown";
  NSArray *supportedPrefixes = @[@"Viatom", @"ER1", @"ER2", @"BP2A", @"BP2", @"BP2W", @"Checkme"];
  BOOL prefixOK = NO; for (NSString *pre in supportedPrefixes) { if ([deviceName hasPrefix:pre]) { prefixOK = YES; break; } }
  if (!prefixOK) return;

  if (![self.seenPeripheralIds containsObject:peripheral.identifier]) {
    [self.seenPeripheralIds addObject:peripheral.identifier];
    self.peripheralsById[peripheral.identifier] = peripheral;
    [self.discoveredPeripherals addObject:peripheral];

    [self sendEventWithName:@"onDeviceDiscovered"
                       body:@{@"name": deviceName,
                              @"id": peripheral.identifier.UUIDString,
                              @"rssi": RSSI ?: @0}];
  } else {
    self.peripheralsById[peripheral.identifier] = peripheral;
  }
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
  [self.centralManager stopScan];
  self.connectedPeripheral = peripheral;
  self.lastConnectedId = peripheral.identifier;

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

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kScanRestartDelay * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self beginScanNormal];
  });
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
  [self sendEventWithName:@"onDeviceDisconnected"
                     body:@{@"name": peripheral.name ?: @"Unknown",
                            @"id": peripheral.identifier.UUIDString,
                            @"error": error ? error.localizedDescription : @"Normal disconnection"}];

  [self exitBPMode];
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

  self.viatomUtils.delegate = self;
  self.viatomUtils.deviceDelegate = self;
  self.viatomUtils.peripheral = nil;
  peripheral.delegate = nil;

  self.connectedPeripheral = nil;

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kScanRestartDelay * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self beginScanRecovery];
  });
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

  if (cmdType == VTMBPCmdGetRealData) {
    const uint8_t *p = (const uint8_t *)response.bytes;
    const NSUInteger n = response.length;

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

    if (n == 20) {
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
    }

    if (n == 32) {
      double mmHg = 0.0; BOOL defl = NO; BOOL hasPulse = NO; int pr = 0;
      if (vt_decode_v2_rt32(p, n, &mmHg, &defl, &hasPulse, &pr)) {
        [self sendEventWithName:@"onRealTimeData" body:@{
          @"type": @"BP_PROGRESS",
          @"pressure": @(mmHg),
          @"isDeflating": @(defl), @"isInflating": @(!defl),
          @"hasPulse": @(hasPulse), @"pulseRate": @(pr),
          @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
        }];
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

    if (n == 34 || n == 36 || n == 38 || n == 40 || n == 44) {
      uint16_t sys=0,dia=0,mean=0,pulse=0;
      if (vt_try_extract_result(response, &sys, &dia, &mean, &pulse)) {
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
    }

    @try {
      VTMBPRealTimeData rt = [VTMBLEParser parseBPRealTimeData:response];
      if (rt.run_status.status == VTMBPStatusBPMeasureEnd) {
        [self sendEventWithName:@"onBPStatusChanged" body:@{@"status": @"measurement_completed"}];
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

  if (cmdType == VTMBPCmdGetRealStatus) {
    VTMBPRunStatus s = [VTMBLEParser parseBPRealTimeStatus:response];
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
    [self beginScanNormal];
  }
}

RCT_EXPORT_METHOD(stopScan) {
  [self.centralManager stopScan];
}

RCT_EXPORT_METHOD(connectToDevice:(NSString *)deviceId) {
  NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:deviceId];
  CBPeripheral *target = self.peripheralsById[uuid];
  if (!target) {
    NSArray<CBPeripheral*> *retrieved = [self.centralManager retrievePeripheralsWithIdentifiers:@[uuid]];
    target = retrieved.firstObject;
    if (target) {
      self.peripheralsById[uuid] = target;
    }
  }
  if (target) {
    self.lastConnectedId = uuid;
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
    self.viatomUtils.peripheral = nil;
    self.connectedPeripheral.delegate = nil;

    [self.centralManager cancelPeripheralConnection:self.connectedPeripheral];
    self.connectedPeripheral = nil;

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kScanRestartDelay * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
      [self beginScanNormal];
    });
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
