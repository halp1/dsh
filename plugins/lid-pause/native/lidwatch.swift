// lidwatch: report MacBook lid, system power, and network reachability
// changes as JSON lines on stdout.
//
// Events:
//   {"type":"snapshot","lidClosed":false,"networkUp":true,"interfaces":["wifi"]}
//   {"type":"lid","closed":true}
//   {"type":"power","state":"will-sleep"}   (sleep is delayed by --sleep-delay-ms)
//   {"type":"power","state":"did-wake"}
//   {"type":"network","up":true,"interfaces":["wifi"]}
//
// The process exits when stdin reaches EOF, so it never outlives its parent.

import Foundation
import IOKit
import IOKit.pwr_mgt
import Network

// IOKit message constants. The C macros are not importable into Swift.
let kMsgCanSystemSleep: UInt32 = 0xE000_0270
let kMsgSystemWillSleep: UInt32 = 0xE000_0280
let kMsgSystemWillNotSleep: UInt32 = 0xE000_0290
let kMsgSystemHasPoweredOn: UInt32 = 0xE000_0300
let kMsgClamshellStateChange: UInt32 = 0xE003_4100

var sleepDelayMs = 1000
var args = CommandLine.arguments.dropFirst()
while let arg = args.popFirst() {
    if arg == "--sleep-delay-ms", let value = args.popFirst(), let ms = Int(value) {
        sleepDelayMs = max(0, min(ms, 25_000))
    }
}

let out = FileHandle.standardOutput
func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    out.write(data)
    out.write("\n".data(using: .utf8)!)
}

// MARK: Lid

let rootDomain = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPMrootDomain"))

func readLidClosed() -> Bool? {
    guard rootDomain != 0 else { return nil }
    guard let value = IORegistryEntryCreateCFProperty(rootDomain, "AppleClamshellState" as CFString, kCFAllocatorDefault, 0)?
        .takeRetainedValue() else { return nil }
    return (value as? Bool) ?? ((value as? NSNumber)?.boolValue)
}

var lastLid: Bool? = readLidClosed()

func checkLid() {
    let now = readLidClosed()
    guard let now, now != lastLid else { return }
    lastLid = now
    emit(["type": "lid", "closed": now])
}

let notifyPort = IONotificationPortCreate(kIOMainPortDefault)
IONotificationPortSetDispatchQueue(notifyPort, DispatchQueue.main)

var interestNotifier: io_object_t = 0
if rootDomain != 0 {
    IOServiceAddInterestNotification(notifyPort, rootDomain, kIOGeneralInterest, { _, _, messageType, _ in
        if messageType == kMsgClamshellStateChange { checkLid() }
    }, nil, &interestNotifier)
}

// Backstop: the interest notification is not delivered on every model, so the
// property is also polled. Reading it is a cheap registry lookup.
let lidTimer = DispatchSource.makeTimerSource(queue: .main)
lidTimer.schedule(deadline: .now() + 1, repeating: 1.0)
lidTimer.setEventHandler { checkLid() }
lidTimer.resume()

// MARK: Power

var powerPort: IONotificationPortRef?
var powerNotifier: io_object_t = 0
var rootPort: io_connect_t = 0

rootPort = IORegisterForSystemPower(nil, &powerPort, { _, _, messageType, argument in
    let token = Int(bitPattern: argument)
    switch messageType {
    case kMsgCanSystemSleep:
        IOAllowPowerChange(rootPort, token)
    case kMsgSystemWillSleep:
        emit(["type": "power", "state": "will-sleep"])
        // Give the parent a moment to abort in-flight work before the freeze.
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(sleepDelayMs)) {
            IOAllowPowerChange(rootPort, token)
        }
    case kMsgSystemWillNotSleep:
        emit(["type": "power", "state": "did-wake"])
    case kMsgSystemHasPoweredOn:
        emit(["type": "power", "state": "did-wake"])
        checkLid()
    default:
        break
    }
}, &powerNotifier)

if let powerPort {
    IONotificationPortSetDispatchQueue(powerPort, DispatchQueue.main)
}

// MARK: Network

func interfaceNames(_ path: NWPath) -> [String] {
    var names: [String] = []
    if path.usesInterfaceType(.wifi) { names.append("wifi") }
    if path.usesInterfaceType(.wiredEthernet) { names.append("wired") }
    if path.usesInterfaceType(.cellular) { names.append("cellular") }
    if names.isEmpty && path.status == .satisfied { names.append("other") }
    return names
}

let monitor = NWPathMonitor()
var firstPath = true
var lastNetwork: (Bool, [String])?

monitor.pathUpdateHandler = { path in
    let up = path.status == .satisfied
    let names = interfaceNames(path)
    if firstPath {
        firstPath = false
        lastNetwork = (up, names)
        emit([
            "type": "snapshot",
            "lidClosed": lastLid ?? false,
            "lidKnown": lastLid != nil,
            "networkUp": up,
            "interfaces": names,
        ])
        return
    }
    if let last = lastNetwork, last.0 == up, last.1 == names { return }
    lastNetwork = (up, names)
    emit(["type": "network", "up": up, "interfaces": names])
}
monitor.start(queue: .main)

// MARK: Parent lifetime

DispatchQueue.global().async {
    while FileHandle.standardInput.availableData.count > 0 {}
    exit(0)
}

signal(SIGPIPE, SIG_IGN)
dispatchMain()
