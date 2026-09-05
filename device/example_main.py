# Example main.py — what CodeLab-generated MicroPython looks like.
import time

from machine import ADC, Pin

import kokoon

# First boot with no stored WiFi: the board opens the "Kokoon-XXXX" setup AP.
# (Or skip that in the classroom: kokoon.begin(server=..., ssid=..., password=...))
kokoon.begin(server="192.168.1.50")

sensor = ADC(Pin(4))
led = Pin(2, Pin.OUT)

while True:
    # "Send to server" block → the sensor1 gauge/chart on the dashboard
    kokoon.send("sensor1", sensor.read_u16() // 655)

    # "Listen from server" block → the led1 toggle on the dashboard.
    # Reads the local dict — never blocks, even with no network.
    led.value(1 if kokoon.get("led1") else 0)

    kokoon.update()
    time.sleep_ms(50)
