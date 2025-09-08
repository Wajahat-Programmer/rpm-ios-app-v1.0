#import "ViatomDeviceManager.h"
#import <VTMProductLib/VTMProductLib.h>


@interface ViatomDeviceManager() <CBCentralManagerDelegate, VTMURATUtilsDelegate>
@property (nonatomic, strong) CBCentralManager *centralManager;
@property (nonatomic, strong) VTMURATUtils *viatomUtils;
@property (nonatomic, strong) NSMutableArray *discoveredPeripherals;
@property (nonatomic, strong) CBPeripheral *connectedPeripheral;
@end

@implementation ViatomDeviceManager

RCT_EXPORT_MODULE();

- (NSArray<NSString *> *)supportedEvents {
  return @[@"onDeviceDiscovered", @"onDeviceConnected", @"onDeviceDisconnected", @"onRealTimeData"];
}

- (instancetype)init {
  self = [super init];
  if (self) {
    self.centralManager = [[CBCentralManager alloc] initWithDelegate:self queue:dispatch_get_main_queue()];
    self.discoveredPeripherals = [NSMutableArray array];
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup {
  return YES;
}

#pragma mark - CBCentralManagerDelegate

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
  if (central.state == CBManagerStatePoweredOn) {
    [self.centralManager scanForPeripheralsWithServices:nil options:nil];
  }
}

- (void)centralManager:(CBCentralManager *)central didDiscoverPeripheral:(CBPeripheral *)peripheral
       advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                    RSSI:(NSNumber *)RSSI {

  if ([peripheral.name hasPrefix:@"Viatom"] || [peripheral.name hasPrefix:@"ER1"] || [peripheral.name hasPrefix:@"ER2"]) {
    if (![self.discoveredPeripherals containsObject:peripheral]) {
      [self.discoveredPeripherals addObject:peripheral];
      [self sendEventWithName:@"onDeviceDiscovered"
                         body:@{@"name": peripheral.name ?: @"Unknown",
                                @"id": peripheral.identifier.UUIDString}];
    }
  }
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
  self.connectedPeripheral = peripheral;
  self.viatomUtils = [[VTMURATUtils alloc] init];
  self.viatomUtils.peripheral = peripheral;
  self.viatomUtils.delegate = self;

  [self sendEventWithName:@"onDeviceConnected"
                     body:@{@"name": peripheral.name ?: @"Unknown",
                            @"id": peripheral.identifier.UUIDString}];
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
  [self sendEventWithName:@"onDeviceDisconnected"
                     body:@{@"name": peripheral.name ?: @"Unknown",
                            @"id": peripheral.identifier.UUIDString}];
  self.connectedPeripheral = nil;
  self.viatomUtils = nil;
}

#pragma mark - VTMURATUtilsDelegate Methods

- (void)utilDeployCompletion:(BOOL)success {
  if (success) {
    NSLog(@"Device setup completed successfully");
    [self.viatomUtils requestDeviceInfo];
  }
}

// ✅ Fixed: use device_type instead of deviceName
- (void)deviceInfo:(VTMDeviceInfo)info {
  NSLog(@"Device Info: type=%d fw=%u", info.device_type, info.fw_version);

  if (info.device_type == 0x8611) { // Example BP2
    [self.viatomUtils requestBPRealData];
  } else {
    [self.viatomUtils requestECGRealData];
  }
}

// ✅ Fixed: use run_para.hr + waveform array
- (void)realTimeECGData:(VTMRealTimeData)data {
  [self sendEventWithName:@"onRealTimeData" body:@{
    @"type": @"ECG",
    @"heartRate": @(data.run_para.hr),
    @"waveform": [self arrayFromWave:data.waveform]
  }];
}

// ✅ Fixed: use systolic_pressure, diastolic_pressure, pulse_rate
- (void)realTimeBPData:(VTMBPEndMeasureData)data {
  [self sendEventWithName:@"onRealTimeData" body:@{
    @"type": @"BP",
    @"systolic": @(data.systolic_pressure),
    @"diastolic": @(data.diastolic_pressure),
    @"pulse": @(data.pulse_rate)
  }];
}

#pragma mark - Helpers

- (NSArray *)arrayFromWave:(VTMRealTimeWF)waveform {
  NSMutableArray *arr = [NSMutableArray array];
  for (int i = 0; i < waveform.sampling_num; i++) {
    [arr addObject:@(waveform.wave_data[i])];
  }
  return arr;
}

#pragma mark - Exposed Methods

RCT_EXPORT_METHOD(startScan) {
  if (self.centralManager.state == CBManagerStatePoweredOn) {
    [self.discoveredPeripherals removeAllObjects];
    [self.centralManager scanForPeripheralsWithServices:nil options:nil];
  }
}

RCT_EXPORT_METHOD(stopScan) {
  [self.centralManager stopScan];
}

RCT_EXPORT_METHOD(connectToDevice:(NSString *)deviceId) {
  NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:deviceId];
  CBPeripheral *peripheralToConnect = nil;

  for (CBPeripheral *peripheral in self.discoveredPeripherals) {
    if ([peripheral.identifier isEqual:uuid]) {
      peripheralToConnect = peripheral;
      break;
    }
  }

  if (peripheralToConnect) {
    [self.centralManager connectPeripheral:peripheralToConnect options:nil];
  }
}

RCT_EXPORT_METHOD(disconnectDevice) {
  if (self.connectedPeripheral) {
    [self.centralManager cancelPeripheralConnection:self.connectedPeripheral];
  }
}

@end
