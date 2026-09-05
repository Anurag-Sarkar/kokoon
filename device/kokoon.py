# kokoon.py — MicroPython client for the Kokoon Brain Board (ESP32-S3).
#
# Student-facing API (used by CodeLab-generated code):
#
#     import kokoon
#     kokoon.begin(server="dashboard.kokoonlabs.com")
#     kokoon.send("sensor1", 100)   # Send-to-server block
#     kokoon.get("led1")            # Listen-from-server block — NEVER blocks
#     kokoon.update()               # call every loop tick
#
# No MQTT concepts are exposed. send() batches channel updates into a single
# JSON publish on kokoon/{id}/pub; get() reads a local dict kept up to date by
# a non-blocking check of kokoon/{id}/sub (which carries retained full-state
# snapshots, so the board catches up automatically after being offline).
#
# Device identity: derived from the chip's own factory-programmed silicon ID
# (machine.unique_id()) — every board ships with identical firmware, nothing
# is burned in per-unit before shipping. The server creates a device row on
# this board's first successful /provision call, not before.

import json
import time

import machine
import network
import ubinascii
from umqtt.simple import MQTTClient

try:
    from esp32 import NVS
except ImportError:  # non-ESP32 port (tests) — RAM fallback
    NVS = None

_NAMESPACE = "kokoon"
_FLUSH_MS = 250          # batch window for send()
_RECONNECT_MS = 5000
_PING_MS = 30000


class _Storage:
    """String key/value storage in NVS (survives reboots)."""

    def __init__(self):
        self._nvs = NVS(_NAMESPACE) if NVS else None
        self._ram = {}

    def get(self, key):
        if not self._nvs:
            return self._ram.get(key)
        buf = bytearray(128)
        try:
            n = self._nvs.get_blob(key, buf)
            return buf[:n].decode()
        except OSError:
            return None

    def set(self, key, value):
        if not self._nvs:
            self._ram[key] = value
            return
        self._nvs.set_blob(key, value.encode())
        self._nvs.commit()


def _http_post_json(host, port, path, obj):
    """Minimal HTTP POST (used once, for provisioning). Returns parsed JSON."""
    import socket

    body = json.dumps(obj)
    addr = socket.getaddrinfo(host, port)[0][-1]
    s = socket.socket()
    s.settimeout(10)
    try:
        s.connect(addr)
        s.send(
            b"POST %s HTTP/1.0\r\nHost: %s\r\nContent-Type: application/json\r\n"
            b"Content-Length: %d\r\n\r\n%s" % (path.encode(), host.encode(), len(body), body.encode())
        )
        raw = b""
        while True:
            chunk = s.recv(512)
            if not chunk:
                break
            raw += chunk
    finally:
        s.close()
    header, _, payload = raw.partition(b"\r\n\r\n")
    status = int(header.split(b" ")[1])
    if status != 200:
        raise OSError("provisioning failed (HTTP %d): %s" % (status, payload[:120]))
    return json.loads(payload)


class KokoonClient:
    def __init__(self, server, api_port=8080, mqtt_port=8883, tls=True):
        self.server = server
        self.api_port = api_port
        self.mqtt_port = mqtt_port
        self.tls = tls

        self._store = _Storage()
        # Same on every reboot, no storage needed — this is read-only silicon
        # data, not something we generate or persist ourselves.
        self.device_id = "kokoon-" + ubinascii.hexlify(machine.unique_id()).decode()

        self._state = {}        # last full snapshot from the server
        self._pending = {}      # batched outgoing channel updates
        self._mqtt = None
        self._connected = False
        self._last_flush = 0
        self._last_ping = 0
        self._last_attempt = 0

    # ---- lifecycle -------------------------------------------------------

    def begin(self, ssid=None, password=None):
        if ssid:  # classroom shortcut — skip SoftAP provisioning
            self._store.set("wifi_ssid", ssid)
            self._store.set("wifi_pass", password or "")
        if not self._store.get("wifi_ssid"):
            self._provision_wifi_softap()  # blocks until creds received, then resets
        self._connect_wifi()
        if not self._store.get("mqtt_pass"):
            self._provision_mqtt()
        self._connect_mqtt()
        return self

    # ---- student-facing --------------------------------------------------

    def send(self, name, value):
        """Queue a channel update; batched into one publish per flush window."""
        self._pending[name] = value
        if time.ticks_diff(time.ticks_ms(), self._last_flush) > _FLUSH_MS:
            self._flush()

    def get(self, name, default=None):
        """Return the last value the server sent for this channel. Never blocks."""
        return self._state.get(name, default)

    def update(self):
        """Call once per main-loop tick. Non-blocking network upkeep."""
        now = time.ticks_ms()
        if not self._connected:
            if time.ticks_diff(now, self._last_attempt) > _RECONNECT_MS:
                self._last_attempt = now
                try:
                    self._connect_wifi()
                    self._connect_mqtt()
                except Exception as e:
                    print("kokoon: reconnect failed:", e)
            return
        try:
            self._mqtt.check_msg()  # non-blocking; fires _on_message if data waits
            if self._pending:
                self._flush()
            if time.ticks_diff(now, self._last_ping) > _PING_MS:
                self._mqtt.ping()
                self._last_ping = now
        except Exception as e:
            print("kokoon: connection lost:", e)
            self._connected = False

    # ---- internals -------------------------------------------------------

    def _flush(self):
        if not self._pending or not self._connected:
            return
        try:
            self._mqtt.publish(
                b"kokoon/%s/pub" % self.device_id.encode(),
                json.dumps(self._pending).encode(),
            )
            self._pending = {}
            self._last_flush = time.ticks_ms()
        except Exception as e:
            print("kokoon: send failed (will retry):", e)
            self._connected = False

    def _on_message(self, topic, msg):
        # Retained full-state snapshot of every listen channel — replace, not merge.
        try:
            data = json.loads(msg)
            if isinstance(data, dict):
                self._state = data
        except ValueError:
            pass

    def _connect_wifi(self):
        wlan = network.WLAN(network.STA_IF)
        wlan.active(True)
        if wlan.isconnected():
            return
        wlan.connect(self._store.get("wifi_ssid"), self._store.get("wifi_pass"))
        for _ in range(100):
            if wlan.isconnected():
                print("kokoon: WiFi connected", wlan.ifconfig()[0])
                return
            time.sleep_ms(200)
        raise OSError("WiFi connect timeout")

    def _provision_mqtt(self):
        # Self-registers on first contact — the server creates the device row
        # right here if this device_id has never been seen before.
        creds = _http_post_json(
            self.server,
            self.api_port,
            "/provision",
            {"device_id": self.device_id},
        )
        self._store.set("mqtt_user", creds["mqtt_username"])
        self._store.set("mqtt_pass", creds["mqtt_password"])
        print("kokoon: provisioned MQTT credentials")

    def _connect_mqtt(self):
        if self._connected:
            return
        ssl_arg = None
        if self.tls:
            try:
                import ssl

                ssl_arg = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
                # Phase 1 broker uses a self-signed cert; pin the Kokoon CA
                # here (ssl_arg.load_verify_locations) when one ships.
                ssl_arg.verify_mode = ssl.CERT_NONE
            except (ImportError, AttributeError):
                ssl_arg = True  # older umqtt/ssl API
        self._mqtt = MQTTClient(
            self.device_id,
            self.server,
            port=self.mqtt_port if self.tls else 1883,
            user=self._store.get("mqtt_user"),
            password=self._store.get("mqtt_pass"),
            keepalive=60,
            ssl=ssl_arg,
        )
        self._mqtt.set_callback(self._on_message)
        self._mqtt.connect()
        self._mqtt.subscribe(b"kokoon/%s/sub" % self.device_id.encode())
        self._connected = True
        self._last_ping = time.ticks_ms()
        print("kokoon: connected as", self.device_id)

    def _provision_wifi_softap(self):
        """First boot: open a SoftAP + tiny HTTP server; the CodeLab app (or a
        phone browser) sends WiFi credentials, then the board reboots.

        The page also displays this board's self-generated device_id — since
        nothing is pre-printed on a sticker at manufacture time, this page is
        how a student actually learns the ID they need to claim it with."""
        import socket

        ap = network.WLAN(network.AP_IF)
        ap.active(True)
        ap.config(essid="Kokoon-%s" % self.device_id[-4:])
        print("kokoon: provisioning mode — join AP 'Kokoon-%s', open http://192.168.4.1"
              % self.device_id[-4:])

        page = (
            "HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n\r\n"
            "<html><body style='font-family:sans-serif;max-width:22em;margin:3em auto'>"
            "<h2>Kokoon setup</h2>"
            "<p>Your device ID (enter this on the dashboard to claim it):<br>"
            "<code style='font-size:1.2em'>%s</code></p>"
            "<form method='POST' action='/provision'>"
            "WiFi name<br><input name='ssid'><br>Password<br>"
            "<input name='password' type='password'><br><br>"
            "<button>Connect</button></form></body></html>"
        ) % self.device_id
        page = page.encode()

        srv = socket.socket()
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("0.0.0.0", 80))
        srv.listen(1)
        while True:
            conn, _ = srv.accept()
            try:
                req = conn.recv(1024)
                if b"POST /provision" in req:
                    body = req.split(b"\r\n\r\n", 1)[-1].decode()
                    creds = self._parse_form_or_json(body)
                    if creds.get("ssid"):
                        self._store.set("wifi_ssid", creds["ssid"])
                        self._store.set("wifi_pass", creds.get("password", ""))
                        conn.send(b"HTTP/1.0 200 OK\r\n\r\nok - rebooting")
                        conn.close()
                        time.sleep(1)
                        machine.reset()
                conn.send(page)
            except Exception as e:
                print("kokoon: provisioning request error:", e)
            finally:
                conn.close()

    @staticmethod
    def _parse_form_or_json(body):
        body = body.strip()
        if body.startswith("{"):
            try:
                return json.loads(body)
            except ValueError:
                return {}
        out = {}
        for pair in body.split("&"):
            if "=" in pair:
                k, v = pair.split("=", 1)
                out[k] = v.replace("+", " ").replace("%40", "@").replace("%23", "#")
        return out


# ---- module-level singleton (what CodeLab blocks call) ----------------------

_client = None


def begin(server, ssid=None, password=None, **kwargs):
    global _client
    _client = KokoonClient(server, **kwargs)
    _client.begin(ssid=ssid, password=password)
    return _client


def send(name, value):
    _client.send(name, value)


def get(name, default=None):
    return _client.get(name, default)


def update():
    _client.update()
