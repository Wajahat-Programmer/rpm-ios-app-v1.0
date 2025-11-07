// ViatomO2Manager.m
// React Native bridge for Viatom O2 SDK (VTO2Lib) with Auto-Reconnect + optional Voice Prompts

#import "ViatomO2Manager.h"

#import <React/RCTLog.h>
#import <React/RCTBridge.h>
#import <React/RCTUtils.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <AVFoundation/AVFoundation.h>

#import <VTO2Lib/VTO2Communicate.h>
#import <VTO2Lib/VTO2Parser.h>
#import <VTO2Lib/VTO2Def.h>
#import <VTO2Lib/VTRealObject.h>
#import <VTO2Lib/VTO2Info.h>

// ---- NEW: persistence keys & scan timing
static NSString * const kO2CentralRestoreId       = @"com.rpmapp.viatom.o2.central.restore";
static NSString * const kO2SavedPeripheralUUIDKey = @"rpm.viatom.o2.savedPeripheralUUID";
static NSString * const kO2AutoReconnectEnabledKey= @"rpm.viatom.o2.autoReconnectEnabled";
static NSString * const kO2VoiceEnabledKey        = @"rpm.viatom.o2.voiceEnabled";
static const NSTimeInterval kO2ScanRestartDelay   = 0.35;

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

// ---- NEW: Auto-reconnect & Voice
@property (nonatomic, strong) NSUUID *lastConnectedId;
@property (nonatomic, assign) BOOL autoReconnectEnabled;
@property (nonatomic, assign) BOOL voiceEnabled;
@property (nonatomic, strong) AVSpeechSynthesizer *tts;
@property (nonatomic, assign) BOOL inRecoveryRescan;

@end

@implementation ViatomO2Manager

RCT_EXPORT_MODULE(ViatomO2Manager);
+ (BOOL)requiresMainQueueSetup { return YES; }

- (instancetype)init {
  if ((self = [super init])) {
    NSDictionary *opts = @{
      CBCentralManagerOptionShowPowerAlertKey: @YES,
      CBCentralManagerOptionRestoreIdentifierKey: kO2CentralRestoreId
    };
    _central = [[CBCentralManager alloc] initWithDelegate:self
                                                    queue:dispatch_get_main_queue()
                                                  options:opts];
    _found = [NSMutableArray array];
    _servicesReady = NO;
    _streaming = NO;
    _warmValidFrames = 0;
    _lastFrameTS = 0;
    _namePrefixes = @[@"outfit-wps", @"oxyfit-wps", @"Oxyfit", @"O2", @"O2M", @"O2Ring",
                      @"Checkme", @"Viatom", @"PC-60", @"PC-68", @"KS-60FWB"];
    _inRecoveryRescan = NO;

    // ---- NEW: load persisted settings
    NSUserDefaults *ud = NSUserDefaults.standardUserDefaults;
    _autoReconnectEnabled = [ud objectForKey:kO2AutoReconnectEnabledKey] ? [ud boolForKey:kO2AutoReconnectEnabledKey] : YES;
    _voiceEnabled         = [ud objectForKey:kO2VoiceEnabledKey]         ? [ud boolForKey:kO2VoiceEnabledKey]         : YES;
    NSString *saved = [ud stringForKey:kO2SavedPeripheralUUIDKey];
    if (saved.length) _lastConnectedId = [[NSUUID alloc] initWithUUIDString:saved];

    _tts = [[AVSpeechSynthesizer alloc] init];
    [self configureAudioSessionIfNeeded];

    RCTLogInfo(@"[O2] init manager (autoReconnect=%d voice=%d)", (int)_autoReconnectEnabled, (int)_voiceEnabled);
  }
  return self;
}

#pragma mark - Events

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

#pragma mark - NEW: persistence + voice

- (void)persistLastConnectedId:(NSUUID *)uuid {
  if (!uuid) return;
  self.lastConnectedId = uuid;
  [[NSUserDefaults standardUserDefaults] setObject:uuid.UUIDString forKey:kO2SavedPeripheralUUIDKey];
  [[NSUserDefaults standardUserDefaults] synchronize];
}

- (void)persistAutoReconnect:(BOOL)enabled {
  self.autoReconnectEnabled = enabled;
  [[NSUserDefaults standardUserDefaults] setBool:enabled forKey:kO2AutoReconnectEnabledKey];
  [[NSUserDefaults standardUserDefaults] synchronize];
}

- (void)persistVoiceEnabled:(BOOL)enabled {
  self.voiceEnabled = enabled;
  [[NSUserDefaults standardUserDefaults] setBool:enabled forKey:kO2VoiceEnabledKey];
  [[NSUserDefaults standardUserDefaults] synchronize];
}

- (void)forgetSavedPeripheral {
  self.lastConnectedId = nil;
  [[NSUserDefaults standardUserDefaults] removeObjectForKey:kO2SavedPeripheralUUIDKey];
  [[NSUserDefaults standardUserDefaults] synchronize];
}

- (void)configureAudioSessionIfNeeded {
  AVAudioSession *session = [AVAudioSession sharedInstance];
  NSError *err = nil;
  [session setCategory:AVAudioSessionCategoryAmbient
           withOptions:AVAudioSessionCategoryOptionDuckOthers
                 error:&err];
  [session setActive:YES error:&err];
}

- (void)speak:(NSString *)phrase {
  if (!self.voiceEnabled || phrase.length == 0) return;
  AVSpeechUtterance *utt = [AVSpeechUtterance speechUtteranceWithString:phrase];
  utt.rate = AVSpeechUtteranceDefaultSpeechRate;
  utt.pitchMultiplier = 1.0;
  utt.volume = 1.0;
  [self.tts speakUtterance:utt];
}

#pragma mark - Scan helpers (normal vs recovery)

- (void)beginScanNormal {
  [self.central stopScan];
  [self.found removeAllObjects];

  NSDictionary *opts = @{ CBCentralManagerScanOptionAllowDuplicatesKey: @NO };
  [self.central scanForPeripheralsWithServices:nil options:opts];

  // If we have a saved device, surface it & optionally connect
  if (self.lastConnectedId) {
    NSArray<CBPeripheral*> *retrieved = [self.central retrievePeripheralsWithIdentifiers:@[self.lastConnectedId]];
    for (CBPeripheral *p in retrieved) {
      if (p) {
        // emit as discovered
        NSString *name = p.name ?: @"Unknown";
        [self emit:@"onO2DeviceDiscovered"
              body:@{@"name": name, @"id": p.identifier.UUIDString ?: @"", @"rssi": @0}];

        if (self.autoReconnectEnabled && p.state == CBPeripheralStateDisconnected) {
          RCTLogInfo(@"[O2] auto-connect (retrieved) to %@", name);
          [self.central connectPeripheral:p options:@{
            CBConnectPeripheralOptionNotifyOnConnectionKey:@YES,
            CBConnectPeripheralOptionNotifyOnDisconnectionKey:@YES
          }];
        }
      }
    }
  }
}

- (void)beginScanRecovery {
  self.inRecoveryRescan = YES;
  [self.central stopScan];
  [self.found removeAllObjects];

  NSDictionary *opts = @{ CBCentralManagerScanOptionAllowDuplicatesKey: @YES };
  [self.central scanForPeripheralsWithServices:nil options:opts];

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.8 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    self.inRecoveryRescan = NO;
    [self beginScanNormal];
  });
}

#pragma mark - RN API (Scan)

RCT_EXPORT_METHOD(startO2Scan) {
  RCTLogInfo(@"[O2] startO2Scan (CB state=%ld)", (long)self.central.state);
  if (self.central.state != CBManagerStatePoweredOn) {
    [self emit:@"onO2Error" body:@{@"error": @"Bluetooth not available", @"state": @(self.central.state)}];
    return;
  }
  [self beginScanNormal];
}

RCT_EXPORT_METHOD(stopO2Scan) {
  RCTLogInfo(@"[O2] stopO2Scan");
  [self.central stopScan];
}

#pragma mark - RN API (Connect / Disconnect)

RCT_EXPORT_METHOD(connectO2:(NSString *)deviceId) {
  RCTLogInfo(@"[O2] connectO2: %@", deviceId);
  if (self.central.state != CBManagerStatePoweredOn) {
    [self emit:@"onO2Error" body:@{@"error": @"Bluetooth off"}];
    return;
  }
  NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:deviceId ?: @""];
  CBPeripheral *target = nil;

  // 1) try already discovered
  for (CBPeripheral *p in self.found) { if ([p.identifier isEqual:uuid]) { target = p; break; } }

  // 2) try retrieved
  if (!target) {
    NSArray<CBPeripheral*> *retrieved = [self.central retrievePeripheralsWithIdentifiers:@[uuid]];
    target = retrieved.firstObject;
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

  // Remember device & enable auto-reconnect from now on
  [self persistLastConnectedId:uuid];
  [self persistAutoReconnect:YES];

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

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kO2ScanRestartDelay * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
      [self beginScanNormal];
    });
  }
}

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  RCTLogInfo(@"[O2] centralManagerDidUpdateState: %ld", (long)central.state);
  if (central.state == CBManagerStatePoweredOn) {
    // optional: auto resume scanning
    [self beginScanNormal];
  } else {
    [self emit:@"onO2Error" body:@{@"error": @"Bluetooth not available", @"state": @(central.state)}];
  }
}

- (void)centralManager:(CBCentralManager *)central
   willRestoreState:(NSDictionary<NSString *,id> *)dict {
  NSArray *restored = dict[CBCentralManagerRestoredStatePeripheralsKey];
  for (CBPeripheral *p in restored) {
    if (p.state == CBPeripheralStateConnected || p.state == CBPeripheralStateConnecting) {
      self.connected = p;

      // Hand BLE to SDK
      VTO2Communicate *comm = [VTO2Communicate sharedInstance];
      p.delegate = comm;
      comm.peripheral = p;
      comm.delegate = self;

      // Ensure service discovery continues
      [p discoverServices:nil];

      // Emit + speak
      [self emit:@"onO2DeviceConnected" body:@{@"name": p.name ?: @"Unknown", @"id": p.identifier.UUIDString ?: @""}];
      [self speak:@"Device connected"];
    }
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

  // prevent duplicates
  for (CBPeripheral *p in self.found) { if ([p.identifier isEqual:peripheral.identifier]) return; }

  [self.found addObject:peripheral];
  RCTLogInfo(@"[O2] discovered: %@  rssi=%@", name, RSSI);
  [self emit:@"onO2DeviceDiscovered"
        body:@{@"name": name, @"id": peripheral.identifier.UUIDString ?: @"", @"rssi": RSSI ?: @0}];

  // ---- NEW: auto-connect on sight if matches saved UUID
  if (self.autoReconnectEnabled &&
      self.lastConnectedId &&
      [peripheral.identifier isEqual:self.lastConnectedId] &&
      peripheral.state == CBPeripheralStateDisconnected) {
    RCTLogInfo(@"[O2] auto-connect (discovered) to %@", name);
    [self.central stopScan];
    [self.central connectPeripheral:peripheral options:@{
      CBConnectPeripheralOptionNotifyOnConnectionKey:@YES,
      CBConnectPeripheralOptionNotifyOnDisconnectionKey:@YES
    }];
  }
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
  RCTLogInfo(@"[O2] didConnectPeripheral: %@", peripheral.name);
  self.connected = peripheral;

  // Remember device for future auto-connect
  [self persistLastConnectedId:peripheral.identifier];

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

  // NEW: voice
  [self speak:@"Device connected"];
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

  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kO2ScanRestartDelay * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self beginScanNormal];
  });
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

  [self speak:@"Device disconnected"];

  if (self.connected == peripheral) self.connected = nil;
  self.streaming = NO;
  self.servicesReady = NO;
  self.warmValidFrames = 0;
  [self stopKickTimer];

  [VTO2Communicate sharedInstance].delegate = nil;

  // Aggressive rescan → normal scan
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kO2ScanRestartDelay * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
    [self beginScanRecovery];
  });
}

#pragma mark - Auto start realtime once services are ready (unchanged)

- (void)startStreamsIfPossible {
  if (!self.connected || !self.servicesReady || self.streaming) return;

  RCTLogInfo(@"[O2] >>> START realtime: OxiSwitch=1 + beginGetRealData/Wave/PPG");
  self.streaming = YES;
  self.warmValidFrames = 0;
  self.lastFrameTS = [NSDate date].timeIntervalSince1970;

  VTO2Communicate *comm = [VTO2Communicate sharedInstance];

  // 1) Enable measurement (critical for WPS/Outfit firmwares)
  @try {
    [comm beginToParamType:VTParamTypeOxiSwitch content:@"1"];
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

#pragma mark - VTO2CommunicateDelegate (unchanged)

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

#pragma mark - RN Exports: toggles (match BP manager API style)

RCT_EXPORT_METHOD(enableO2AutoReconnect:(BOOL)enabled) {
  [self persistAutoReconnect:enabled];
}

RCT_EXPORT_METHOD(forgetO2SavedDevice) {
  [self forgetSavedPeripheral];
}

RCT_EXPORT_METHOD(setO2VoiceEnabled:(BOOL)enabled) {
  [self persistVoiceEnabled:enabled];
}

@end
