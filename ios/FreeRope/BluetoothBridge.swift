import CoreBluetooth
import UIKit
import WebKit

/// The native side of bridge.js: the subset of Web Bluetooth that app/handle.js uses
/// (requestDevice, connect, startNotifications, write, disconnect), done with CoreBluetooth.
/// Messages come in as {id, cmd, ...}; replies go out through __ble.reply(id, ok, value).
final class BluetoothBridge: NSObject, WKScriptMessageHandler, CBCentralManagerDelegate, CBPeripheralDelegate {
    weak var webView: WKWebView?
    weak var presenter: UIViewController?

    private var central: CBCentralManager?
    private var whenReady: [(CBManagerState) -> Void] = []
    private var peripherals: [String: CBPeripheral] = [:]

    // requestDevice in progress
    private var scanId: Int?
    private var scanFilter: (prefixes: [String], services: [CBUUID]) = ([], [])
    private var scanAlert: UIAlertController?
    private var scanTimeout: DispatchWorkItem?

    // Outstanding replies, keyed by peripheral id (connect) or peripheral id + characteristic (notify, write).
    private var connecting: [String: (id: Int, timeout: DispatchWorkItem)] = [:]
    private var notifying: [String: Int] = [:]
    private var writing: [String: [Int]] = [:]

    // MARK: - Messages from JavaScript

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        let id = body["id"] as? Int ?? 0
        let device = body["device"] as? String ?? ""
        let char = body["char"] as? String ?? ""

        switch cmd {
        case "requestDevice":
            requestDevice(id, prefixes: body["namePrefixes"] as? [String] ?? [],
                          services: (body["services"] as? [String] ?? []).map { CBUUID(string: $0) })
        case "connect":
            connect(id, device: device)
        case "disconnect":
            if let p = peripherals[device] { central?.cancelPeripheralConnection(p) }
            reply(id, true)
        case "startNotifications":
            guard let found = characteristic(device, char) else { return reply(id, false, error: "NotFoundError") }
            notifying[device + char.lowercased()] = id
            found.peripheral.setNotifyValue(true, for: found.char)
        case "write":
            guard let found = characteristic(device, char),
                  let data = Data(base64Encoded: body["data"] as? String ?? "") else { return reply(id, false, error: "NotFoundError") }
            let (p, c) = (found.peripheral, found.char)
            let withResponse = (body["withResponse"] as? Bool ?? false) || !c.properties.contains(.writeWithoutResponse)
            if withResponse {
                writing[device + char.lowercased(), default: []].append(id)
                p.writeValue(data, for: c, type: .withResponse)
            } else {
                p.writeValue(data, for: c, type: .withoutResponse)
                reply(id, true)
            }
        case "keepAwake":
            UIApplication.shared.isIdleTimerDisabled = body["on"] as? Bool ?? false
        default:
            reply(id, false, error: "NotSupportedError")
        }
    }

    // MARK: - requestDevice: scan and take the first matching handle

    private func requestDevice(_ id: Int, prefixes: [String], services: [CBUUID]) {
        if let old = scanId { finishScan(); reply(old, false, error: "AbortError") }
        withCentral { [weak self] state in
            guard let self else { return }
            switch state {
            case .poweredOn:
                self.scanId = id
                self.scanFilter = (prefixes.map { $0.lowercased() }, services)
                self.central?.scanForPeripherals(withServices: nil, options: nil)
                self.showScanning()
                let timeout = DispatchWorkItem { [weak self] in
                    guard let self, let id = self.scanId else { return }
                    self.finishScan()
                    self.reply(id, false, error: "NetworkError", message: "No handle found")
                }
                self.scanTimeout = timeout
                DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
            case .unauthorized:
                self.alert("Bluetooth is off for FreeRope", "Allow Bluetooth in Settings so FreeRope can find your handles.", settings: true)
                self.reply(id, false, error: "NotFoundError")
            default:
                self.alert("Turn on Bluetooth", "FreeRope needs Bluetooth to connect to your handles. Turn it on in Control Center or Settings.", settings: false)
                self.reply(id, false, error: "NotFoundError")
            }
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        guard let id = scanId else { return }
        let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
        let advertised = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        let byName = scanFilter.prefixes.contains { name.lowercased().hasPrefix($0) }
        let byService = advertised.contains { scanFilter.services.contains($0) }
        guard byName || byService else { return }

        finishScan()
        let key = peripheral.identifier.uuidString
        peripherals[key] = peripheral
        peripheral.delegate = self
        reply(id, true, value: ["id": key, "name": name.isEmpty ? "Crossrope AMP" : name])
    }

    private func finishScan() {
        central?.stopScan()
        scanId = nil
        scanTimeout?.cancel()
        scanTimeout = nil
        scanAlert?.dismiss(animated: true)
        scanAlert = nil
    }

    private func showScanning() {
        let alert = UIAlertController(title: "Looking for your handles…", message: "Shake a handle to wake it up.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            guard let self, let id = self.scanId else { return }
            self.scanAlert = nil
            self.finishScan()
            self.reply(id, false, error: "NotFoundError")
        })
        scanAlert = alert
        presenter?.present(alert, animated: true)
    }

    // MARK: - Connect and discover the AMP service

    private func connect(_ id: Int, device: String) {
        guard let p = peripherals[device] else { return reply(id, false, error: "NotFoundError") }
        withCentral { [weak self] state in
            guard let self else { return }
            guard state == .poweredOn else { return self.reply(id, false, error: "NetworkError", message: "Bluetooth is off") }
            if let old = self.connecting.removeValue(forKey: device) {
                old.timeout.cancel()
                self.reply(old.id, false, error: "AbortError")
            }
            let timeout = DispatchWorkItem { [weak self] in
                guard let self, let pending = self.connecting.removeValue(forKey: device) else { return }
                self.central?.cancelPeripheralConnection(p)
                self.reply(pending.id, false, error: "NetworkError", message: "Connection timed out")
            }
            self.connecting[device] = (id, timeout)
            DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: timeout)
            if p.state == .connected { p.discoverServices(nil) } else { self.central?.connect(p) }
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        failConnect(peripheral, error?.localizedDescription ?? "Failed to connect")
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        let services = peripheral.services ?? []
        if services.isEmpty { return failConnect(peripheral, error?.localizedDescription ?? "No services") }
        services.forEach { peripheral.discoverCharacteristics(nil, for: $0) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        let services = peripheral.services ?? []
        guard services.allSatisfy({ $0.characteristics != nil }) else { return } // wait for the rest
        let key = peripheral.identifier.uuidString
        guard let pending = connecting.removeValue(forKey: key) else { return }
        pending.timeout.cancel()
        var map: [String: [String]] = [:]
        for s in services { map[uuid(s.uuid)] = (s.characteristics ?? []).map { uuid($0.uuid) } }
        reply(pending.id, true, value: ["services": map])
    }

    private func failConnect(_ peripheral: CBPeripheral, _ message: String) {
        guard let pending = connecting.removeValue(forKey: peripheral.identifier.uuidString) else { return }
        pending.timeout.cancel()
        reply(pending.id, false, error: "NetworkError", message: message)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        let key = peripheral.identifier.uuidString
        failConnect(peripheral, "Disconnected")
        for (k, id) in notifying where k.hasPrefix(key) { reply(id, false, error: "NetworkError") ; notifying[k] = nil }
        for (k, ids) in writing where k.hasPrefix(key) { ids.forEach { reply($0, false, error: "NetworkError") }; writing[k] = nil }
        event("disconnected", ["device": key])
    }

    // MARK: - Notifications and writes

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor c: CBCharacteristic, error: Error?) {
        guard let id = notifying.removeValue(forKey: peripheral.identifier.uuidString + uuid(c.uuid)) else { return }
        if let error { reply(id, false, error: "NetworkError", message: error.localizedDescription) } else { reply(id, true) }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard error == nil, let data = c.value else { return }
        event("value", ["device": peripheral.identifier.uuidString, "char": uuid(c.uuid), "data": data.base64EncodedString()])
    }

    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor c: CBCharacteristic, error: Error?) {
        let key = peripheral.identifier.uuidString + uuid(c.uuid)
        guard var ids = writing[key], !ids.isEmpty else { return }
        let id = ids.removeFirst()
        writing[key] = ids
        if let error { reply(id, false, error: "NetworkError", message: error.localizedDescription) } else { reply(id, true) }
    }

    // MARK: - Central state

    private func withCentral(_ run: @escaping (CBManagerState) -> Void) {
        if let central, central.state != .unknown, central.state != .resetting { return run(central.state) }
        whenReady.append(run)
        if central == nil { central = CBCentralManager(delegate: self, queue: .main) } // asks for permission the first time
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state != .unknown, central.state != .resetting else { return }
        let waiting = whenReady
        whenReady = []
        waiting.forEach { $0(central.state) }
    }

    // MARK: - Helpers

    private func characteristic(_ device: String, _ char: String) -> (peripheral: CBPeripheral, char: CBCharacteristic)? {
        guard let p = peripherals[device] else { return nil }
        for s in p.services ?? [] {
            if let c = s.characteristics?.first(where: { uuid($0.uuid) == char.lowercased() }) { return (p, c) }
        }
        return nil
    }

    /// Web Bluetooth uses full lowercase UUIDs; CoreBluetooth shortens the standard 16-bit ones.
    private func uuid(_ u: CBUUID) -> String {
        let s = u.uuidString.lowercased()
        return s.count == 4 ? "0000\(s)-0000-1000-8000-00805f9b34fb" : s
    }

    private func alert(_ title: String, _ message: String, settings: Bool) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        if settings {
            alert.addAction(UIAlertAction(title: "Settings", style: .default) { _ in
                UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!)
            })
        }
        alert.addAction(UIAlertAction(title: "OK", style: .cancel))
        presenter?.present(alert, animated: true)
    }

    private func reply(_ id: Int, _ ok: Bool, value: Any? = nil, error: String? = nil, message: String? = nil) {
        guard id > 0 else { return }
        let payload: Any = ok ? (value ?? NSNull()) : ["name": error ?? "NetworkError", "message": message ?? error ?? "Bluetooth error"]
        call("__ble.reply(\(id), \(ok), \(json(payload)))")
    }

    private func event(_ type: String, _ data: [String: Any]) {
        call("__ble.event(\(json(type)), \(json(data)))")
    }

    private func call(_ js: String) {
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func json(_ value: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return "null" }
        return String(data: data, encoding: .utf8) ?? "null"
    }
}
