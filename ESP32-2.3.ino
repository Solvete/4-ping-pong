#include <ESP32Servo.h>
#include <WiFi.h>
#include <esp_now.h>
#include "esp_wifi.h"
#include <string.h>
#include <MyLD2410.h>

//KAYLA_VARIABLES_START

// -------------------- LD2410C --------------------
HardwareSerial radarSerial(1);
MyLD2410 radar(radarSerial);

const int HUMAN_MIN_DISTANCE = 250;
const int HUMAN_MAX_DISTANCE = 400;

bool humanPresent = false;
bool humanPause = false;
unsigned long humanStateChangeAt = 0;

const unsigned long HUMAN_LOST_TIMEOUT = 5000;
// -------------------- Servo objects --------------------
Servo stopperServo;
Servo xServo;
Servo yServo;

// -------------------- Pin assignments --------------------
const int GBOX = 18;
const int ESTOP = 19;
const int STOPPER_PIN = 21;
const int X_PIN = 22;
const int Y_PIN = 23;
const int MOTOR_PWM_PIN = 17;
const int LD_RX = 25;
const int LD_TX = 26;


// -------------------- Motor PWM configuration --------------------
const int PWM_FREQ = 20000; //20khz
const int PWM_RESOLUTION = 8;

// PWM targets for each difficulty
const int EASY_PWM   = 110;
const int MEDIUM_PWM = 160;
const int HARD_PWM   = 220;

// Motor ramp configuration
const int RAMP_STEP = 5;
const unsigned long RAMP_INTERVAL_MS = 50;

int currentPWM = 0;
int targetPWM = 0;
int savedMotorTarget = 0;
unsigned long lastRampTime = 0;

// -------------------- Default servo positions --------------------
const int STOPPER_CLOSED = 0;
const int STOPPER_OPEN = 90;
const int CENTER_X = 90;
const int CENTER_Y = 90;

const unsigned long STOPPER_OPEN_TIME = 300;

// -------------------- Difficulty modes --------------------
enum Difficulty {
  MODE_STOP,
  MODE_EASY,
  MODE_MEDIUM,
  MODE_HARD,
  MODE_CUSTOM
};

Difficulty currentMode = MODE_STOP;

// -------------------- System states --------------------
bool estopActive = true;
bool stopperIsOpen = false;

// -------------------- Timing intervals --------------------
unsigned long ballInterval = 3000;
unsigned long servoInterval = 2000;

unsigned long lastBallTime = 0;
unsigned long stopperOpenedAt = 0;
unsigned long lastServoMove = 0;

// -------------------- Custom mode settings --------------------
bool customRandomX = false;
bool customRandomY = false;

// -------------------- ESP-NOW configuration --------------------
uint8_t macESP1[] = {
  0x54, 0x5A, 0xA6, 0x6D, 0x6E, 0x70
};

typedef struct struct_message {
  unsigned long waktu;
} struct_message;

struct_message data_ku;
esp_now_peer_info_t peerInfo = {};

//KAYLA_VARIABLES_END

//KAYLA_SENSOR_START
void updateHumanPresence() {
  radar.check();

  bool detected = false;

  if (radar.movingTargetDetected()) {
    uint16_t distance = radar.movingTargetDistance();

    if (distance >= HUMAN_MIN_DISTANCE &&
        distance <= HUMAN_MAX_DISTANCE) {
      detected = true;
    }
  }

  if (radar.stationaryTargetDetected()) {
    uint16_t distance = radar.stationaryTargetDistance();

    if (distance >= HUMAN_MIN_DISTANCE &&
        distance <= HUMAN_MAX_DISTANCE) {
      detected = true;
    }
  }

  humanPresent = detected;
}

void updateHumanSafety() {

  if (estopActive) {
    return;
  }

  if (!humanPresent && !humanPause) {
    savedMotorTarget = targetPWM;
    humanPause = true;

    setMotorTarget(0);

    stopperServo.write(STOPPER_CLOSED);
    stopperIsOpen = false;
    digitalWrite(GBOX, LOW);

    Serial.println("MACHINE PAUSED.");
  }

  else if (humanPresent && humanPause) {
    humanPause = false;

    setMotorTarget(savedMotorTarget);
    stopperServo.write(STOPPER_CLOSED);
    stopperIsOpen = false;

    lastBallTime = millis();
    lastServoMove = millis();
    digitalWrite(GBOX, HIGH);

    Serial.println("MACHINE RESUMING.");
  }
}

//KAYLA_SENSOR_END

//KAYLA_SERVO_START

// Control the ball stopper based on the selected interval
void updateStopper() {
  if (currentMode == MODE_STOP || estopActive || humanPause) {
    return;
  }

  unsigned long now = millis();

  // Open the stopper when it is time to release a ball
  if (!stopperIsOpen && now - lastBallTime >= ballInterval) {
    stopperServo.write(STOPPER_OPEN);
    stopperIsOpen = true;
    stopperOpenedAt = now;
    lastBallTime = now;
  }

  // Close the stopper after the configured opening duration
  if (stopperIsOpen && now - stopperOpenedAt >= STOPPER_OPEN_TIME) {
    stopperServo.write(STOPPER_CLOSED);
    stopperIsOpen = false;
  }
}

// Control X/Y servo orientation based on difficulty
void updateOrientation() {
  if (currentMode == MODE_STOP || estopActive || humanPause) {
    return;
  }

  unsigned long now = millis();

  if (now - lastServoMove < servoInterval) {
    return;
  }

  lastServoMove = now;

  if (currentMode == MODE_EASY) {
    // Easy: keep both axes centered
    xServo.write(CENTER_X);
    yServo.write(CENTER_Y);
  }

  else if (currentMode == MODE_MEDIUM) {
    // Medium: alternate horizontal direction only
    int x = random(45, 136);

    xServo.write(x);
    yServo.write(CENTER_Y);
  }

  else if (currentMode == MODE_HARD) {
    // Hard: randomize both horizontal and vertical positions
    int x = random(45, 136);
    int y = random(45, 90);

    xServo.write(x);
    yServo.write(y);
  }

  else if (currentMode == MODE_CUSTOM) {
    // Custom: randomize only the enabled axes
    if (customRandomX) {
      xServo.write(random(45, 136));
    }

    if (customRandomY) {
      yServo.write(random(45, 90));
    }
  }
}

//KAYLA_SERVO_END

//KAYLA_MOTOR_START
// Set the PWM target without changing current PWM immediately
void setMotorTarget(int pwm) {
  targetPWM = constrain(pwm, 0, 255);
}

void stopMotorImmediate() {
  currentPWM = 0;
  targetPWM = 0;

  analogWrite(MOTOR_PWM_PIN, 0);
}

// Gradually adjust the actual PWM toward its target
void updateMotorPWM() {
  // E-STOP must override normal motor control
  if (estopActive) {
    stopMotorImmediate();
    return;
  }

  unsigned long now = millis();

  if (now - lastRampTime >= RAMP_INTERVAL_MS) {
    lastRampTime = now;

    if (currentPWM < targetPWM) {
      currentPWM = min(currentPWM + RAMP_STEP, targetPWM);
    }
    else if (currentPWM > targetPWM) {
      currentPWM = max(currentPWM - RAMP_STEP, targetPWM);
    }

    analogWrite(MOTOR_PWM_PIN, currentPWM);
  }
}

//KAYLA_MOTOR_END

//KAYLA_MODE_START

// Stop normal operation and return the mechanism to its default positions
void stopSystem() {
  currentMode = MODE_STOP;

  // Motor ramps down to zero through updateMotorPWM()
  setMotorTarget(0);

  digitalWrite(GBOX, LOW);

  stopperServo.write(STOPPER_CLOSED);
  stopperIsOpen = false;

  xServo.write(CENTER_X);
  yServo.write(CENTER_Y);

  Serial.println("Mode STOP. Motor ramping down.");
}

// Configure the machine according to the selected difficulty
void setMode(Difficulty mode) {
  if (estopActive) {
    Serial.println("E-STOP active. Enter RESET first.");
    return;
  }

  if (mode == MODE_STOP) {
    stopSystem();
    return;
  }

  currentMode = mode;

  switch (mode) {
    case MODE_EASY:
      ballInterval = 3000;
      servoInterval = 2000;
      setMotorTarget(EASY_PWM);
      break;

    case MODE_MEDIUM:
      ballInterval = 2000;
      servoInterval = 1500;
      setMotorTarget(MEDIUM_PWM);
      break;

    case MODE_HARD:
      ballInterval = 1200;
      servoInterval = 1000;
      setMotorTarget(HARD_PWM);
      break;

    case MODE_CUSTOM:
      // Custom motor target has not been configured yet
      setMotorTarget(0);
      break;

    case MODE_STOP:
    default:
      setMotorTarget(0);
      break;
  }

  // Reset the stopper and servo positions when changing modes
  stopperServo.write(STOPPER_CLOSED);
  stopperIsOpen = false;

  xServo.write(CENTER_X);
  yServo.write(CENTER_Y);

  // Restart the timing intervals for the selected mode
  unsigned long now = millis();
  lastBallTime = now;
  lastServoMove = now;

  digitalWrite(GBOX, HIGH);

  Serial.println("Difficulty mode updated.");
}

//KAYLA_MODE_END

//KAYLA_EMERGENCY_START

// Control the relay used by the E-STOP circuit
void setRelay(bool enabled) {
  digitalWrite(ESTOP, enabled ? HIGH : LOW);
}


// Emergency stop: cut relay power and immediately set PWM to zero
void emergencyStop() {
  estopActive = true;

  setRelay(false);
  stopSystem();
  stopMotorImmediate();

  Serial.println("EMERGENCY STOP ACTIVATED.");
}


// Reset the E-STOP state without automatically restarting the machine
void resetEStop() {
  setRelay(true);
  estopActive = false;

  stopSystem();

  Serial.println("E-STOP reset.");
  Serial.println("Select EASY, MEDIUM, or HARD to start.");
}

//KAYLA_EMERGENCY_END

//KAYLA_COMMAND_START
// Read and process commands from the Serial Monitor
void handleCommands() {
  if (!Serial.available()) {
    return;
  }

  String command = Serial.readStringUntil('\n');
  command.trim();
  command.toUpperCase();

  // Emergency commands are processed before the E-STOP state check
  if (command == "ESTOP") {
    emergencyStop();
    return;
  }

  if (command == "RESET") {
    resetEStop();
    return;
  }

  if (estopActive) {
    Serial.println("E-STOP active. Enter RESET first.");
    return;
  }

  // -------------------- Difficulty commands --------------------
  if (command == "EASY") {
    setMode(MODE_EASY);
  }
  else if (command == "MEDIUM") {
    setMode(MODE_MEDIUM);
  }
  else if (command == "HARD") {
    setMode(MODE_HARD);
  }
  else if (command == "STOP") {
    stopSystem();
  }

  // -------------------- Custom mode command --------------------
  // Format:
  // CUSTOM <ball interval ms> <servo interval ms> <random X 0/1> <random Y 0/1>
  // Example: CUSTOM 2500 1500 1 0
  else if (command.startsWith("CUSTOM ")) {
    unsigned long newBallInterval;
    unsigned long newServoInterval;
    int randomX;
    int randomY;

    int parsed = sscanf(
      command.c_str(),
      "CUSTOM %lu %lu %d %d",
      &newBallInterval,
      &newServoInterval,
      &randomX,
      &randomY
    );

    if (parsed == 4 &&
        newBallInterval >= 500 &&
        newBallInterval <= 10000 &&
        newServoInterval >= 300 &&
        newServoInterval <= 10000 &&
        (randomX == 0 || randomX == 1) &&
        (randomY == 0 || randomY == 1)) {

      ballInterval = newBallInterval;
      servoInterval = newServoInterval;

      customRandomX = (randomX == 1);
      customRandomY = (randomY == 1);

      setMode(MODE_CUSTOM);

      Serial.print("Ball interval: ");
      Serial.print(ballInterval);
      Serial.println(" ms");

      Serial.print("Servo interval: ");
      Serial.print(servoInterval);
      Serial.println(" ms");

      Serial.print("Random X: ");
      Serial.println(customRandomX ? "ON" : "OFF");

      Serial.print("Random Y: ");
      Serial.println(customRandomY ? "ON" : "OFF");
    }
    else {
      Serial.println(
        "Format: CUSTOM <ball_ms> <servo_ms> <randomX 0/1> <randomY 0/1>"
      );
      Serial.println("Ball interval: 500-10000 ms");
      Serial.println("Servo interval: 300-10000 ms");
    }
  }

  // -------------------- Manual servo testing --------------------
  else if (command.startsWith("S ")) {
    int angle = command.substring(2).toInt();
    stopperServo.write(constrain(angle, 0, 180));
  }
  else if (command.startsWith("X ")) {
    int angle = command.substring(2).toInt();
    xServo.write(constrain(angle, 0, 180));
  }
  else if (command.startsWith("Y ")) {
    int angle = command.substring(2).toInt();
    yServo.write(constrain(angle, 0, 180));
  }

  else {
    Serial.println(
      "Commands: EASY, MEDIUM, HARD, CUSTOM, STOP, ESTOP, RESET"
    );
  }
}
//KAYLA_COMMAND_END

//KAYLA_ESPNOW_START

// Callback for ESP-NOW send status
void cb_kirim(
  const wifi_tx_info_t *info,
  esp_now_send_status_t status
) {
  Serial.print("ESP2 - Status Pengiriman: ");

  if (status == ESP_NOW_SEND_SUCCESS) {
    Serial.println("Sukses");
  }
  else {
    Serial.println("Gagal");
  }
}


// Callback for messages received from ESP1
void cb_terima(
  const esp_now_recv_info_t *info,
  const uint8_t *dataDiterima,
  int panjang
) {
  // Validate the incoming message size before copying
  if (panjang != sizeof(data_ku)) {
    Serial.println("ESP-NOW: Ukuran data tidak sesuai.");
    return;
  }

  memcpy(
    &data_ku,
    dataDiterima,
    sizeof(data_ku)
  );

  Serial.print("ESP2 - Bytes diterima: ");
  Serial.println(panjang);

  Serial.print("Waktu: ");
  Serial.println(data_ku.waktu);

  // Send the received data back to ESP1
  esp_now_send(
    macESP1,
    (uint8_t *)&data_ku,
    sizeof(data_ku)
  );
}

//KAYLA_ESPNOW_END

//KAYLA_SETUP_START

void setup() {
  Serial.begin(115200);

  // -------------------- LD2410C initialization --------------------

  radarSerial.begin(256000, SERIAL_8N1, LD_RX, LD_TX);

  delay(500);

  if (!radar.begin()) {
    Serial.println("LD2410C communication failed!");
  }
  else {
    Serial.println("LD2410C READY.");
  }

  // -------------------- Wi-Fi / ESP-NOW initialization --------------------
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();

  // Set ESP2 to Wi-Fi channel 6
  esp_wifi_set_channel(
    6,
    WIFI_SECOND_CHAN_NONE
  );

  Serial.print("ESP2 MAC: ");
  Serial.println(WiFi.macAddress());

  if (esp_now_init() != ESP_OK) {
    Serial.println("Gagal Inisialisasi ESP-NOW");
    return;
  }

  esp_now_register_send_cb(cb_kirim);
  esp_now_register_recv_cb(cb_terima);

  // Configure ESP1 as the ESP-NOW peer
  memset(&peerInfo, 0, sizeof(peerInfo));

  memcpy(
    peerInfo.peer_addr,
    macESP1,
    6
  );

  peerInfo.channel = 6;
  peerInfo.encrypt = false;

  if (esp_now_add_peer(&peerInfo) != ESP_OK) {
    Serial.println("Gagal Menambah Peer ESP1");
    return;
  }

  Serial.println("ESP-NOW ESP2 READY");

  // -------------------- Pin configuration --------------------
  pinMode(GBOX, OUTPUT);
  pinMode(ESTOP, OUTPUT);
  pinMode(MOTOR_PWM_PIN, OUTPUT);

  // Safe startup: relay disconnected and machine stopped
  setRelay(false);
  digitalWrite(GBOX, LOW);

  // -------------------- Servo initialization --------------------
  stopperServo.attach(STOPPER_PIN);
  xServo.attach(X_PIN);
  yServo.attach(Y_PIN);

  stopperServo.write(STOPPER_CLOSED);
  xServo.write(CENTER_X);
  yServo.write(CENTER_Y);

  // -------------------- PWM initialization --------------------
  analogWriteFrequency(MOTOR_PWM_PIN, PWM_FREQ);
  analogWriteResolution(MOTOR_PWM_PIN, PWM_RESOLUTION);
  analogWrite(MOTOR_PWM_PIN, 0);

  randomSeed(esp_random());

  Serial.println("Ping Pong Launcher - ESP32-2");
  Serial.println("Startup in E-STOP state.");
  Serial.println("Send RESET, then select EASY / MEDIUM / HARD / CUSTOM.");
}

//KAYLA_SETUP_END

//KAYLA_LOOP_START

void loop() {
  handleCommands();
  updateHumanPresence();
  updateHumanSafety();
  updateMotorPWM();
  updateStopper();
  updateOrientation();
}

//KAYLA_LOOP_END
