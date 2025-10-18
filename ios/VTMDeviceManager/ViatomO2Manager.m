// ViatomO2Manager.m
// React Native bridge for Viatom O2 SDK (VTO2Lib)
// Uses the legacy realtime APIs per VTO2Lib README.
// Auto-enables VTParamTypeOxiSwitch=1, starts realtime, and retries if needed.

#import "ViatomO2Manager.h"

#import <React/RCTLog.h>
#import <React/RCTBridge.h>
#import <React/RCTUtils.h>
#import <CoreBluetooth/CoreBluetooth.h>

#import <VTO2Lib/VTO2Communicate.h>
#import <VTO2Lib/VTO2Parser.h>
#import <VTO2Lib/VTO2Def.h>
#import <VTO2Lib/VTRealObject.h>
#import <VTO2Lib/VTO2Info.h>

@interface ViatomO2Manager () <CBCentralManagerDelegate, VTO2CommunicateDelegate>

// BLE
@property (nonatomic, strong) CBCentralManager *central;
@property (nonatomic, strong) NSMutableArray<CBPeripheral *> *found;
@property (nonatomic, strong) CBPeripheral *connected;

// State
@property (nonatomic, assign) BOOL hasListeners;
@property (nonatomic, assign) BOOL servicesReady;
@property (nonatomic, assign) BOOL streaming;
@property (nonatomic, assign) NSInteger warmValidFrames;

// Retry
@property (nonatomic, strong) NSTimer *kickTimer;
@property (nonatomic, assign) NSTimeInterval lastFrameTS;

// Filters
@property (nonatomic, strong) NSArray<NSString *> *namePrefixes;

@end

@implementation ViatomO2Manager

RCT_EXPORT_MODULE(ViatomO2Manager);
+ (BOOL)requiresMainQueueSetup { return YES; }

- (instancetype)init {
  if ((self = [super init])) {
    _central = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue()
                                                 options:@{ CBCentralManagerOptionShowPowerAlertKey:@YES }];
    _found = [NSMutableArray array];
    _servicesReady = NO;
    _streaming = NO;
    _warmValidFrames = 0;
    _lastFrameTS = 0;
    _namePrefixes = @[@"outfit-wps", @"oxyfit-wps", @"Oxyfit", @"O2", @"O2M", @"O2Ring",
                      @"Checkme", @"Viatom", @"PC-60", @"PC-68"];
    RCTLogInfo(@"[O2] init manager");
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents {
  return @[
    @"onO2DeviceDiscovered",
    @"onO2DeviceConnected",
    @"onO2DeviceDisconnected",
    @"onO2Ready",
    @"onO2Info",
    @"onO2RealTime",
    @"onO2PPG",
    @"onO2Error"
  ];
}

- (void)startObserving { self.hasListeners = YES; }
- (void)stopObserving  { self.hasListeners = NO; }
- (void)emit:(NSString *)name body:(NSDictionary *)body {
  if (!self.hasListeners) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    [self sendEventWithName:name body:body ?: @{}];
  });
}

#pragma mark - Scan

RCT_EXPORT_METHOD(startO2Scan) {
  RCTLogInfo(@"[O2] startO2Scan (CB state=%ld)", (long)self.central.state);
  if (self.central.state != CBManagerStatePoweredOn) {
    [self emit:@"onO2Error" body:@{@"error": @"Bluetooth not available", @"state": @(self.central.state)}];
    return;
  }
  [self.found removeAllObjects];
  [self.central scanForPeripheralsWithServices:nil
                                       options:@{ CBCentralManagerScanOptionAllowDuplicatesKey:@NO }];
}

RCT_EXPORT_METHOD(stopO2Scan) {
  RCTLogInfo(@"[O2] stopO2Scan");
  [self.central stopScan];
}

#pragma mark - Connect / Disconnect

RCT_EXPORT_METHOD(connectO2:(NSString *)deviceId) {
  RCTLogInfo(@"[O2] connectO2: %@", deviceId);
  if (self.central.state != CBManagerStatePoweredOn) {
    [self emit:@"onO2Error" body:@{@"error": @"Bluetooth off"}];
    return;
  }
  NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:deviceId ?: @""];
  CBPeripheral *target = nil;
  for (CBPeripheral *p in self.found) {
    if ([p.identifier isEqual:uuid]) { target = p; break; }
  }
  if (!target) {
    [self emit:@"onO2Error" body:@{@"error": @"Device not found", @"deviceId": deviceId ?: @""}];
    return;
  }

  [self.central stopScan];
  self.connected = target;
  self.servicesReady = NO;
  self.streaming = NO;
  self.warmValidFrames = 0;
  self.lastFrameTS = 0;

  [self.central connectPeripheral:target options:@{
    CBConnectPeripheralOptionNotifyOnConnectionKey:@YES,
    CBConnectPeripheralOptionNotifyOnDisconnectionKey:@YES
  }];
}

RCT_EXPORT_METHOD(disconnectO2) {
  RCTLogInfo(@"[O2] disconnectO2");
  if (self.connected) {
    [self stopStreamsIfNeeded];
    VTO2Communicate *comm = [VTO2Communicate sharedInstance];
    comm.delegate = nil;
    [self.central cancelPeripheralConnection:self.connected];
    self.connected = nil;
    self.servicesReady = NO;
  }
}

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  RCTLogInfo(@"[O2] centralManagerDidUpdateState: %ld", (long)central.state);
  if (central.state != CBManagerStatePoweredOn) {
    [self emit:@"onO2Error" body:@{@"error": @"Bluetooth not available", @"state": @(central.state)}];
  }
}

- (void)centralManager:(CBCentralManager *)central
   didDiscoverPeripheral:(CBPeripheral *)peripheral
       advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                    RSSI:(NSNumber *)RSSI
{
  NSString *name = peripheral.name ?: advertisementData[CBAdvertisementDataLocalNameKey] ?: @"Unknown";
  if (RSSI.integerValue < -90) return;

  BOOL match = NO;
  for (NSString *pre in self.namePrefixes) {
    if (name && [[name lowercaseString] hasPrefix:[pre lowercaseString]]) { match = YES; break; }
  }
  if (!match) return;

  for (CBPeripheral *p in self.found) {
    if ([p.identifier isEqual:peripheral.identifier]) return;
  }

  [self.found addObject:peripheral];
  RCTLogInfo(@"[O2] discovered: %@  rssi=%@", name, RSSI);
  [self emit:@"onO2DeviceDiscovered"
        body:@{@"name": name, @"id": peripheral.identifier.UUIDString ?: @"", @"rssi": RSSI ?: @0}];
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
  RCTLogInfo(@"[O2] didConnectPeripheral: %@", peripheral.name);
  self.connected = peripheral;

  // Hand BLE to SDK (required by README)
  VTO2Communicate *comm = [VTO2Communicate sharedInstance];
  peripheral.delegate = comm;
  comm.peripheral = peripheral;
  comm.delegate = self;

  // Trigger discovery; SDK will call serviceDeployed:
  [peripheral discoverServices:nil];

  [self emit:@"onO2DeviceConnected"
        body:@{@"name": peripheral.name ?: @"Unknown",
               @"id": peripheral.identifier.UUIDString ?: @""}];
}

- (void)centralManager:(CBCentralManager *)central
 didFailToConnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error
{
  RCTLogInfo(@"[O2] didFailToConnect: %@  error=%@", peripheral.name, error.localizedDescription);
  [self emit:@"onO2Error"
        body:@{@"error": @"Failed to connect",
               @"deviceId": peripheral.identifier.UUIDString ?: @"",
               @"message": error.localizedDescription ?: @"Unknown"}];
}

- (void)centralManager:(CBCentralManager *)central
 didDisconnectPeripheral:(CBPeripheral *)peripheral
                 error:(NSError *)error
{
  RCTLogInfo(@"[O2] didDisconnect: %@  error=%@", peripheral.name, error.localizedDescription);
  [self emit:@"onO2DeviceDisconnected"
        body:@{@"name": peripheral.name ?: @"Unknown",
               @"id": peripheral.identifier.UUIDString ?: @"",
               @"error": error ? error.localizedDescription : @"Normal disconnection"}];

  if (self.connected == peripheral) self.connected = nil;
  self.streaming = NO;
  self.servicesReady = NO;
  self.warmValidFrames = 0;
  [self stopKickTimer];

  [VTO2Communicate sharedInstance].delegate = nil;
}

#pragma mark - Auto start realtime once services are ready

- (void)startStreamsIfPossible {
  if (!self.connected || !self.servicesReady || self.streaming) return;

  RCTLogInfo(@"[O2] >>> START realtime: OxiSwitch=1 + beginGetRealData/Wave/PPG");
  self.streaming = YES;
  self.warmValidFrames = 0;
  self.lastFrameTS = [NSDate date].timeIntervalSince1970;

  VTO2Communicate *comm = [VTO2Communicate sharedInstance];

  // 1) Enable measurement (critical for WPS/Outfit firmwares)
  //    VTParamTypeOxiSwitch: 0-off, 1-on (per README)
  @try {
    [comm beginToParamType:VTParamTypeOxiSwitch content:@"1"]; // turn on measuring
    RCTLogInfo(@"[O2] set param: VTParamTypeOxiSwitch=1");
  } @catch (__unused NSException *e) {
    RCTLogInfo(@"[O2] set param: OxiSwitch write threw (ignored)");
  }

  // 2) Start legacy realtime streams (per README)
  if ([comm respondsToSelector:@selector(beginGetRealData)]) { RCTLogInfo(@"[O2] LEGACY beginGetRealData"); [comm beginGetRealData]; }
  if ([comm respondsToSelector:@selector(beginGetRealPPG)])  { RCTLogInfo(@"[O2] LEGACY beginGetRealPPG");  [comm beginGetRealPPG]; }
  if ([comm respondsToSelector:@selector(beginGetRealWave)]) { RCTLogInfo(@"[O2] LEGACY beginGetRealWave"); [comm beginGetRealWave]; }

  [self startKickTimer];
}

- (void)stopStreamsIfNeeded {
  if (!self.streaming) return;
  RCTLogInfo(@"[O2] <<< STOP realtime");
  self.streaming = NO;

  VTO2Communicate *comm = [VTO2Communicate sharedInstance];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
  if ([comm respondsToSelector:@selector(endGetRealData)]) [comm performSelector:@selector(endGetRealData)];
  if ([comm respondsToSelector:@selector(endGetRealPPG)])  [comm performSelector:@selector(endGetRealPPG)];
  if ([comm respondsToSelector:@selector(endGetRealWave)]) [comm performSelector:@selector(endGetRealWave)];
#pragma clang diagnostic pop

  [self stopKickTimer];
}

- (void)startKickTimer {
  [self stopKickTimer];
  self.kickTimer = [NSTimer scheduledTimerWithTimeInterval:3.0
                                                    target:self
                                                  selector:@selector(kickIfNoFrames)
                                                  userInfo:nil
                                                   repeats:YES];
}
- (void)stopKickTimer {
  [self.kickTimer invalidate];
  self.kickTimer = nil;
}
- (void)kickIfNoFrames {
  if (!self.streaming) return;
  NSTimeInterval now = [NSDate date].timeIntervalSince1970;
  NSTimeInterval delta = now - self.lastFrameTS;
  if (delta < 3.0) return;

  RCTLogInfo(@"[O2] kick: no frames for %.0f ms -> nudge OxiSwitch=1 + re-begin realtime",
             delta*1000.0);

  VTO2Communicate *comm = [VTO2Communicate sharedInstance];
  // Re-assert OxiSwitch and restart legacy streams
  @try { [comm beginToParamType:VTParamTypeOxiSwitch content:@"1"]; } @catch (__unused NSException *e) {}
  if ([comm respondsToSelector:@selector(beginGetRealData)]) [comm beginGetRealData];
  if ([comm respondsToSelector:@selector(beginGetRealPPG)])  [comm beginGetRealPPG];
  if ([comm respondsToSelector:@selector(beginGetRealWave)]) [comm beginGetRealWave];

  // Refresh battery/info too
  [comm beginGetInfo];

  self.lastFrameTS = now;
}

#pragma mark - VTO2CommunicateDelegate

- (void)serviceDeployed:(BOOL)completed {
  RCTLogInfo(@"[O2] serviceDeployed=%d", completed);
  self.servicesReady = completed;

  if (!completed) {
    [self emit:@"onO2Error" body:@{@"error": @"Service deploy failed"}];
    return;
  }

  [self emit:@"onO2Ready" body:@{@"ready": @YES}];

  // Read info (battery/model) right away (per README)
  [[VTO2Communicate sharedInstance] beginGetInfo];

  // Short delay helps some WPS firmwares settle before realtime
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.35 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    [self startStreamsIfPossible];
  });
}

- (void)getInfoWithResultData:(NSData * _Nullable)infoData {
  RCTLogInfo(@"[O2] getInfoWithResultData len=%lu", (unsigned long)infoData.length);
  if (!infoData) return;
  VTO2Info *info = [VTO2Parser parseO2InfoWithData:infoData];
  NSInteger bat = info.curBattery.length ? info.curBattery.integerValue : -1;
  NSDictionary *payload = @{
    @"battery": bat >= 0 ? @(bat) : [NSNull null],
    @"batteryState": info.curBatState ?: @"",
    @"model": info.model ?: @"",
    @"protocol": info.spcpVer ?: @"",
  };
  [self emit:@"onO2Info" body:payload];
}

- (void)realDataCallBackWithData:(NSData * _Nullable)realData {
  if (!self.streaming || !realData) return;

  VTRealObject *obj = [VTO2Parser parseO2RealObjectWithData:realData];
  self.lastFrameTS = [NSDate date].timeIntervalSince1970;

  NSInteger spo2 = [[obj valueForKey:@"spo2"] integerValue];
  NSInteger pr   = [[obj valueForKey:@"hr"] integerValue];
  NSInteger pi10 = [[obj valueForKey:@"pi"] integerValue];
  NSInteger bat  = [[obj valueForKey:@"battery"] integerValue];

  BOOL spo2Valid = (spo2 > 50 && spo2 <= 100 && spo2 != 255);
  BOOL prValid   = (pr   > 25 && pr   < 255   && pr   != 65535);

  if (!(spo2Valid || prValid)) {
    self.warmValidFrames = 0;
    [self emit:@"onO2RealTime" body:@{@"type": @"O2_SEARCHING"}];
    RCTLogInfo(@"[O2] realtime (searching) spo2=%ld pr=%ld", (long)spo2, (long)pr);
    return;
  }

  if (++self.warmValidFrames < 2) {
    RCTLogInfo(@"[O2] realtime (warming) frames=%ld", (long)self.warmValidFrames);
    return;
  }

  NSMutableDictionary *payload = [@{
    @"type": @"O2_REALTIME",
    @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000))
  } mutableCopy];

  if (spo2Valid) payload[@"spo2"] = @(spo2);
  if (prValid)   payload[@"pulseRate"] = @(pr);
  payload[@"pi"] = @(pi10);
  if (bat >= 0)  payload[@"battery"] = @(bat);

  RCTLogInfo(@"[O2] realtime %@", payload);
  [self emit:@"onO2RealTime" body:payload];
}

- (void)realWaveCallBackWithData:(NSData * _Nullable)realWave {
  if (!self.streaming || !realWave) return;

  self.lastFrameTS = [NSDate date].timeIntervalSince1970;

  // Some firmware send only wave; parse and forward as PPG samples (ints)
  id waveObj = [VTO2Parser parseO2RealWaveWithData:realWave];
  NSArray *points = [waveObj respondsToSelector:@selector(points)] ? [waveObj valueForKey:@"points"] : @[];
  if (points.count) {
    RCTLogInfo(@"[O2] realWave points=%lu", (unsigned long)points.count);
    [self emit:@"onO2PPG" body:@{
      @"type": @"O2_PPG",
      @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000)),
      @"samples": points
    }];
  }
}

- (void)realPPGCallBackWithData:(NSData * _Nullable)realPPG {
  if (!self.streaming || !realPPG) return;

  self.lastFrameTS = [NSDate date].timeIntervalSince1970;

  NSArray *ppgObjs = [VTO2Parser parseO2RealPPGWithData:realPPG];
  if (ppgObjs.count == 0) return;

  NSMutableArray *series = [NSMutableArray arrayWithCapacity:ppgObjs.count];
  for (id sample in ppgObjs) {
    NSNumber *v = nil;
    if ([sample respondsToSelector:@selector(ir)])        v = [sample valueForKey:@"ir"];
    else if ([sample respondsToSelector:@selector(value)]) v = [sample valueForKey:@"value"];
    if (v) [series addObject:v];
  }

  if (series.count) {
    RCTLogInfo(@"[O2] PPG samples=%lu", (unsigned long)series.count);
    [self emit:@"onO2PPG"
          body:@{@"type": @"O2_PPG",
                 @"timestamp": @((long long)([NSDate date].timeIntervalSince1970 * 1000)),
                 @"samples": series}];
  }
}

- (void)updatePeripheralRSSI:(NSNumber *)RSSI {
  RCTLogInfo(@"[O2] RSSI update: %@", RSSI);
}

@end
