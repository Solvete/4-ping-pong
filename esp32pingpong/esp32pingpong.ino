#include <esp_wifi.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <DNSServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <esp_now.h>

// ================= AP & NETWORK CONFIG =================
const char* ssid = "PingPong-Machine";
const char* password = "12345678";
const int channel = 6;

IPAddress apIP(192, 168, 4, 1);
IPAddress gateway(192, 168, 4, 1);
IPAddress subnet(255, 255, 255, 0);

const byte DNS_PORT = 53;
DNSServer dnsServer;
WebServer server(80);

// ================= ESP-NOW CONFIG =================
uint8_t macESP2[] = { 0xB0, 0x3F, 0xD3, 0x6F, 0x28, 0x48 };

typedef struct struct_message {
  unsigned long waktu;
} struct_message;

struct_message data_ku;
esp_now_peer_info_t peerInfo = {};

// Callback saat data ESP-NOW terkirim
void cb_kirim(const wifi_tx_info_t *info, esp_now_send_status_t status) {
  Serial.print("ESP1 - Status Pengiriman: ");
  if (status == ESP_NOW_SEND_SUCCESS) {
    Serial.println("Sukses");
  } else {
    Serial.println("Gagal");
  }
}

// Callback saat data ESP-NOW diterima
void cb_terima(const esp_now_recv_info_t *info, const uint8_t *dataDiterima, int panjang) {
  memcpy(&data_ku, dataDiterima, sizeof(data_ku));
  Serial.print("ESP1 - Bytes diterima: ");
  Serial.println(panjang);
  Serial.print("Waktu: ");
  Serial.println(data_ku.waktu);
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  //Inisialisasi Wi-Fi Mode Dual (AP + STA)
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAPConfig(apIP, gateway, subnet);
  WiFi.softAP(ssid, password, channel);

  Serial.println();
  Serial.println("=== NETWORK INITIALIZATION ===");
  Serial.print("SSID      : "); Serial.println(ssid);
  Serial.print("IP AP     : "); Serial.println(WiFi.softAPIP());
  Serial.print("AP MAC    : "); Serial.println(WiFi.softAPmacAddress());
  Serial.print("STA MAC   : "); Serial.println(WiFi.macAddress());
  Serial.print("Channel   : "); Serial.println(channel);

  //Inisialisasi mDNS & Captive Portal DNS
  if (MDNS.begin("pingpong")) {
    Serial.println("mDNS aktif: http://pingpong.local");
  } else {
    Serial.println("mDNS gagal");
  }

  dnsServer.start(DNS_PORT, "*", apIP);
  Serial.println("Captive Portal DNS aktif");

  //Inisialisasi ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("Gagal Inisialisasi ESP-NOW");
    return;
  }
  esp_now_register_send_cb(cb_kirim);
  esp_now_register_recv_cb(cb_terima);

  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, macESP2, 6);
  peerInfo.channel = 6;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Gagal Menambah Peer ESP2");
    return;
  }
  Serial.println("ESP-NOW Siap");

  server.begin();
  Serial.println("==================================");
  Serial.println("PING PONG MACHINE SERVER READY");
  Serial.print("SSID : "); Serial.println(ssid);
  Serial.print("IP   : "); Serial.println(WiFi.softAPIP());
  Serial.println("==================================");
}

// ================= MAIN LOOP =================
void loop() {
  dnsServer.processNextRequest();
}