// ================= CLIENT MAC ADDRESS =================
server.on("/api/get-client-mac", HTTP_GET, []() {
  wifi_sta_list_t wifi_sta_list;
  esp_wifi_ap_get_sta_list(&wifi_sta_list);

  JsonDocument doc;
  String clientMac = "";

  if (wifi_sta_list.num > 0) {
    int targetIndex = wifi_sta_list.num - 1;

    char macStr[18];
    snprintf(macStr, sizeof(macStr),
             "%02X:%02X:%02X:%02X:%02X:%02X",
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