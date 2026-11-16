const char* SETTINGS_FILE = "/settings.json";

bool readJsonFile(const char* path, JsonDocument& doc) {
  File file = LittleFS.open(path, "r");
  if (!file) return false;
  DeserializationError error = deserializeJson(doc, file);
  file.close();
  if (error) return false;
  return true;
}

bool saveJsonFile(const char* path, JsonDocument& doc) {
  File file = LittleFS.open(path, "w");
  if (!file) return false;
  size_t written = serializeJson(doc, file);
  file.close();
  return written > 0;
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

// =========================================================================
// BACK-END API ENDPOINTS (ESP32 Web Server)
// =========================================================================
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

  server.on("/api/control/settings", HTTP_POST, []() {
    JsonDocument doc;
    if (!readRequestJson(doc)) return;
    int speed = doc["speed"] | currentSpeed;
    int interval = doc["interval"] | currentInterval;
    if (speed < 0 || speed > 100) { sendError(400, "Speed harus 0-100"); return; }
    if (interval < 1 || interval > 60) { sendError(400, "Interval harus 1-60 detik"); return; }

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

  server.on("/api/control/move", HTTP_POST, []() {
    JsonDocument doc;
    if (!readRequestJson(doc)) return;
    String direction = doc["direction"] | "";
    if (direction != "up" && direction != "down" && direction != "left" &&
        direction != "right" && direction != "upleft" && direction != "upright" &&
        direction != "downleft" && direction != "downright" && direction != "stop") {
      sendError(400, "Arah tidak dikenal"); return;
    }
    currentDirection = direction;
    if (!saveSettings()) { sendError(500, "Gagal menyimpan pengaturan"); return; }

    JsonDocument response;
    response["status"] = "success";
    response["direction"] = currentDirection;
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  server.on("/api/control/reset", HTTP_POST, []() {
    isRunning = false;
    currentMode = "custom";
    currentSpeed = 75;
    currentInterval = 2;
    currentDirection = "stop";
    saveSettings();

    JsonDocument response;
    response["status"] = "success";
    response["message"] = "Reset berhasil";
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  server.on("/api/control/random", HTTP_POST, []() {
    currentMode = "random";
    saveSettings();

    JsonDocument response;
    response["status"] = "success";
    response["mode"] = currentMode;
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  server.on("/api/control/start", HTTP_POST, []() {
    JsonDocument doc;
    if (!readRequestJson(doc)) return;
    String action = doc["action"] | "start";

    if (action == "start") {
      currentMode = doc["mode"] | currentMode;
      currentSpeed = doc["speed"] | currentSpeed;
      currentInterval = doc["interval"] | currentInterval;
      isRunning = true;
    } else if (action == "stop") {
      isRunning = false;
    }

    saveSettings();
    JsonDocument response;
    response["status"] = "success";
    response["state"] = isRunning ? "running" : "stopped";
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  server.on("/api/control/emergency", HTTP_POST, []() {
    isRunning = false;
    currentDirection = "stop";
    saveSettings();

    JsonDocument response;
    response["status"] = "success";
    response["state"] = "stopped";
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

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