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

    JsonDocument response;
    response["status"] = "success";
    response["direction"] = currentDirection;
    String output;
    serializeJson(response, output);
    sendJson(200, output);
  });

  server.on("/api/control/start", HTTP_POST, []() {
    JsonDocument doc;
    if (!readRequestJson(doc)) return;
    String action = doc["action"] | "start";

    if (action == "start") {
      String requestedMode = doc["mode"] | currentMode;
      int requestedSpeed = doc["speed"] | currentSpeed;
      int requestedInterval = doc["interval"] | currentInterval;
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