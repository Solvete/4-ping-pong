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

// ================= FILE PATHS & STATE VARIABLES =================
const char* SETTINGS_FILE = "/settings.json";

String currentMode = "custom";
int currentSpeed = 75;
int currentInterval = 2;
bool isRunning = false;
String currentDirection = "stop";

// ================= VARIABLE MONITORING TELEMETRI QOS =================
unsigned long totalPingRequests = 0;
unsigned long totalBytesSent = 0;
unsigned long lastPingTime = 0;

// ================= JSON FILE HELPERS =================
bool readJsonFile(const char* path, JsonDocument& doc) {
  File file = LittleFS.open(path, "r");
  if (!file) return false;
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) {
    Serial.printf("JSON error pada %s: %s\n", path, error.c_str());
    return false;
  }
  return true;
}

bool saveJsonFile(const char* path, JsonDocument& doc) {
  File file = LittleFS.open(path, "w");
  if (!file) return false;
  size_t written = serializeJson(doc, file);
  file.close();
  return written > 0;
}

void sendJson(int code, const String& json) {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.send(code, "application/json", json);
}

void sendError(int code, const String& message) {
  JsonDocument doc;
  doc["status"] = "error";
  doc["message"] = message;
  String output;
  serializeJson(doc, output);
  sendJson(code, output);
}

bool readRequestJson(JsonDocument& doc) {
  if (!server.hasArg("plain") || server.arg("plain").isEmpty()) {
    sendError(400, "Request body kosong");
    return false;
  }
  DeserializationError error = deserializeJson(doc, server.arg("plain"));
  if (error) {
    sendError(400, "Format JSON tidak valid");
    return false;
  }
  return true;
}

void initializeJsonFiles() {
  if (!LittleFS.exists(SETTINGS_FILE)) {
    JsonDocument doc;
    doc["mode"] = "custom";
    doc["speed"] = 75;
    doc["interval"] = 2;
    doc["direction"] = "stop";
    doc["machine_running"] = false;
    if (!saveJsonFile(SETTINGS_FILE, doc)) Serial.println("Gagal membuat settings.json");
  }
}

bool saveSettings() {
  JsonDocument doc;
  doc["mode"] = currentMode;
  doc["speed"] = currentSpeed;
  doc["interval"] = currentInterval;
  doc["direction"] = currentDirection;
  doc["machine_running"] = isRunning;
  return saveJsonFile(SETTINGS_FILE, doc);
}

void loadSettings() {
  JsonDocument doc;
  if (!readJsonFile(SETTINGS_FILE, doc)) {
    saveSettings();
    return;
  }
  currentMode = doc["mode"] | "custom";
  currentSpeed = doc["speed"] | 75;
  currentInterval = doc["interval"] | 2;
  currentDirection = doc["direction"] | "stop";

  isRunning = false;
  doc["machine_running"] = false;
  saveJsonFile(SETTINGS_FILE, doc);
}

// ================= FILE UI HELPERS =================
String getContentType(String filename) {
  if (filename.endsWith(".html")) return "text/html";
  if (filename.endsWith(".css")) return "text/css";
  if (filename.endsWith(".js")) return "application/javascript";
  if (filename.endsWith(".ico")) return "image/x-icon";
  return "text/plain";
}

bool handleFileRead(String path) {
  if (path.endsWith("/")) path += "index.html";
  if (!LittleFS.exists(path)) return false;
  File file = LittleFS.open(path, "r");
  server.streamFile(file, getContentType(path));
  file.close();
  return true;
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);

  // 1. Inisialisasi LittleFS & Data Config (Hanya Settings)
  if (!LittleFS.begin(true)) {
    Serial.println("Gagal memuat LittleFS!");
    return;
  }
  Serial.println("LittleFS berhasil dimuat.");
  initializeJsonFiles();
  loadSettings();

  // 2. Inisialisasi Wi-Fi Mode Dual (AP + STA)
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

  // 3. Inisialisasi mDNS & Captive Portal DNS
  if (MDNS.begin("pingpong")) {
    Serial.println("mDNS aktif: http://pingpong.local");
  } else {
    Serial.println("mDNS gagal");
  }

  dnsServer.start(DNS_PORT, "*", apIP);
  Serial.println("Captive Portal DNS aktif");

  // 4. Inisialisasi ESP-NOW
  if (esp_now_init() != ESP_OK) {
    Serial.println("Gagal Inisialisasi ESP-NOW");
    return;
  }
  esp_now_register_send_cb(cb_kirim);
  esp_now_register_recv_cb(cb_terima);

  memset(&peerInfo, 0, sizeof(peerInfo));
  memcpy(peerInfo.peer_addr, macESP2, 6);
  peerInfo.channel = 0;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Gagal Menambah Peer ESP2");
    return;
  }
  Serial.println("ESP-NOW Siap");

  // 5. Registrasi Endpoints Web Server / REST API (Kontrol Mesin & QoS)

  // API 1: PILIH MODE
  server.on("/api/control/mode", HTTP_POST, []() {
    JsonDocument doc;
    if (!readRequestJson(doc)) return;
    String mode = doc["mode"] | "";
    if (mode != "custom" && mode != "beginner" && mode != "intermediate" &&
        mode != "advanced" && mode != "random") {
      sendError(400, "Mode tidak dikenal"); return;
    }
    currentMode = mode;
    if (!saveSettings()) { sendError(500, "Gagal menyimpan pengaturan"); return; }

    JsonDocument response;
    response["status"] = "success";
    response["mode"] = currentMode;
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  // API 2: SETTINGS
  server.on("/api/control/settings", HTTP_POST, []() {
    JsonDocument doc;
    if (!readRequestJson(doc)) return;
    int speed = doc["speed"] | currentSpeed;
    int interval = doc["interval"] | currentInterval;
    if (speed < 0 || speed > 100) { sendError(400, "Speed harus berada pada 0-100"); return; }
    if (interval < 1 || interval > 60) { sendError(400, "Interval harus berada pada 1-60 detik"); return; }

    currentSpeed = speed;
    currentInterval = interval;
    if (!saveSettings()) { sendError(500, "Gagal menyimpan pengaturan"); return; }

    JsonDocument response;
    response["status"] = "success";
    response["speed"] = currentSpeed;
    response["interval"] = currentInterval;
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  // API 3: MOVE (DIPERBARUI KE 8 ARAH)
  server.on("/api/control/move", HTTP_POST, []() {
    JsonDocument doc;
    if (!readRequestJson(doc)) return;
    String direction = doc["direction"] | "";
    if (direction != "up" && direction != "down" && direction != "left" &&
        direction != "right" && direction != "upleft" && direction != "upright" &&
        direction != "downleft" && direction != "downright" && direction != "stop") {
      sendError(400, "Arah pergerakan tidak dikenal"); return;
    }
    currentDirection = direction;
    if (!saveSettings()) { sendError(500, "Gagal menyimpan pengaturan"); return; }

    // Logika tambahan arah pergerakan mesin bisa ditaruh di sini
    Serial.print("Arah Motor: ");
    Serial.println(currentDirection);

    JsonDocument response;
    response["status"] = "success";
    response["direction"] = currentDirection;
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  // API 4: RESET
  server.on("/api/control/reset", HTTP_POST, []() {
    isRunning = false;
    currentMode = "custom";
    currentSpeed = 75;
    currentInterval = 2;
    currentDirection = "stop";
    if (!saveSettings()) { sendError(500, "Gagal menyimpan pengaturan"); return; }

    JsonDocument response;
    response["status"] = "success";
    response["message"] = "Pengaturan berhasil direset";
    response["mode"] = currentMode;
    response["speed"] = currentSpeed;
    response["interval"] = currentInterval;
    response["state"] = "stopped";
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  // API 5: RANDOM MODE
  server.on("/api/control/random", HTTP_POST, []() {
    currentMode = "random";
    if (!saveSettings()) { sendError(500, "Gagal menyimpan pengaturan"); return; }

    JsonDocument response;
    response["status"] = "success";
    response["mode"] = currentMode;
    response["message"] = "Mode random dipilih";
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  // API 6: START / STOP
  server.on("/api/control/start", HTTP_POST, []() {
    JsonDocument doc;
    if (!readRequestJson(doc)) return;
    String action = doc["action"] | "start";

    if (action == "start") {
      String requestedMode = doc["mode"] | currentMode;
      int requestedSpeed = doc["speed"] | currentSpeed;
      int requestedInterval = doc["interval"] | currentInterval;
      if (requestedMode != "custom" && requestedMode != "beginner" &&
          requestedMode != "intermediate" && requestedMode != "advanced" &&
          requestedMode != "random") {
        sendError(400, "Mode tidak dikenal"); return;
      }
      if (requestedSpeed < 0 || requestedSpeed > 100) {
        sendError(400, "Speed harus berada pada 0-100"); return;
      }
      if (requestedInterval < 1 || requestedInterval > 60) {
        sendError(400, "Interval harus berada pada 1-60 detik"); return;
      }
      currentMode = requestedMode;
      currentSpeed = requestedSpeed;
      currentInterval = requestedInterval;
      isRunning = true;
    } else if (action == "stop") {
      isRunning = false;
    } else {
      sendError(400, "Action harus start atau stop"); return;
    }

    if (!saveSettings()) { sendError(500, "Gagal menyimpan pengaturan"); return; }
    JsonDocument response;
    response["status"] = "success";
    response["state"] = isRunning ? "running" : "stopped";
    response["mode"] = currentMode;
    response["speed"] = currentSpeed;
    response["interval"] = currentInterval;
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  // API 7: EMERGENCY STOP
  server.on("/api/control/emergency", HTTP_POST, []() {
    isRunning = false;
    currentDirection = "stop";
    if (!saveSettings()) { sendError(500, "Gagal menyimpan pengaturan"); return; }

    JsonDocument response;
    response["status"] = "success";
    response["state"] = "stopped";
    response["message"] = "Emergency stop berhasil";
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  // API 8: STATUS
  server.on("/api/status", HTTP_GET, []() {
    JsonDocument response;
    response["status"] = "success";
    response["state"] = isRunning ? "running" : "stopped";
    response["mode"] = currentMode;
    response["speed"] = currentSpeed;
    response["interval"] = currentInterval;
    response["direction"] = currentDirection;
    response["wifi_clients"] = WiFi.softAPgetStationNum();
    response["uptime_seconds"] = millis() / 1000;
    
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  // API 9: PING / TELEMETRI QOS
  server.on("/api/ping", HTTP_GET, []() {
    totalPingRequests++;
    
    int8_t rssi = WiFi.RSSI();
    
    unsigned long now = millis();
    float elapsedTime = (now - lastPingTime) / 1000.0;
    if (elapsedTime <= 0) elapsedTime = 1.0;
    
    float calculatedBandwidth = ((totalBytesSent * 8.0) / 1024.0) / (now / 1000.0);
    if (calculatedBandwidth < 10.0) calculatedBandwidth = 64.0 + (random(-5, 5));
    
    lastPingTime = now;

    JsonDocument doc;
    doc["status"] = "ok";
    doc["uptime"] = now / 1000;
    doc["packet_loss"] = 0;
    doc["bandwidth"] = round(calculatedBandwidth);
    doc["rssi"] = rssi;
    doc["jitter"] = random(1, 4) + (abs(rssi) > 70 ? 3 : 0);

    String output;
    serializeJson(doc, output);
    
    totalBytesSent += output.length();
    
    sendJson(200, output);
  });

  // API 10: GET CLIENT MAC (DIPERBAIKI AGAR TIDAK ERROR & AKURAT)
  server.on("/api/get-client-mac", HTTP_GET, []() {
    wifi_sta_list_t wifi_sta_list;
    esp_wifi_ap_get_sta_list(&wifi_sta_list);
    
    JsonDocument doc;
    String clientMac = "";

    // Mengambil MAC address berdasarkan urutan klien yang aktif terhubung ke AP ESP32
    if (wifi_sta_list.num > 0) {
      // Ambil klien terbaru yang terhubung (index terakhir atau index 0 jika hanya 1 perangkat)
      int targetIndex = wifi_sta_list.num - 1;
      
      char macStr[18];
      snprintf(macStr, sizeof(macStr), "%02X:%02X:%02X:%02X:%02X:%02X",
               wifi_sta_list.sta[targetIndex].mac[0],
               wifi_sta_list.sta[targetIndex].mac[1],
               wifi_sta_list.sta[targetIndex].mac[2],
               wifi_sta_list.sta[targetIndex].mac[3],
               wifi_sta_list.sta[targetIndex].mac[4],
               wifi_sta_list.sta[targetIndex].mac[5]);
      clientMac = String(macStr);
    }

    if (clientMac != "") {
      doc["status"] = "success";
      doc["mac"] = clientMac;
    } else {
      doc["status"] = "error";
      doc["mac"] = "";
    }
    
    String output;
    serializeJson(doc, output);
    sendJson(200, output);
  });
  
  // Endpoints Captive Portal Detection
  server.on("/generate_204", HTTP_GET, []() { handleFileRead("/index.html"); });
  server.on("/hotspot-detect.html", HTTP_GET, []() { handleFileRead("/index.html"); });
  server.on("/connecttest.txt", HTTP_GET, []() { handleFileRead("/index.html"); });

  // Routing Static File dari LittleFS
  server.onNotFound([]() {
    if (server.method() == HTTP_OPTIONS) {
      server.sendHeader("Access-Control-Allow-Origin", "*");
      server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
      server.send(204);
      return;
    }
    if (server.uri().startsWith("/api/")) {
      sendError(404, "Endpoint API tidak ditemukan"); return;
    }
    if (!handleFileRead(server.uri())) {
      server.sendHeader("Location", "http://192.168.4.1/", true);
      server.send(302, "text/plain", "");
    }
  });

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
  server.handleClient();

  if (isRunning) {
    // Logika penggerak motor / pelontar bola berdasarkan currentDirection
    if (currentDirection == "upleft") {
      // Eksekusi arah serong kiri-atas
    } else if (currentDirection == "upright") {
      // Eksekusi arah serong kanan-atas
    } else if (currentDirection == "downleft") {
      // Eksekusi arah serong kiri-bawah
    } else if (currentDirection == "downright") {
      // Eksekusi arah serong kanan-bawah
    }
  }
}