// ViatomO2Manager.h
// React Native bridge for Viatom SpO₂ SDK (VTO2Lib_Pods)

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>
#import <CoreBluetooth/CoreBluetooth.h>
#import <VTO2Lib/VTO2Communicate.h>

@interface ViatomO2Manager : RCTEventEmitter
<RCTBridgeModule, CBCentralManagerDelegate, VTO2CommunicateDelegate, VTO2A5RespDelegate>
@end
