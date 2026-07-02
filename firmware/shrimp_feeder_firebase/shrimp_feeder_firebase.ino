/*
 * ============================================================================
 *  SMART SHRIMP FEEDER  v3  —  ESP32 + Firebase (REST API, tanpa Mobizt)
 *  ======================  DUAL-CORE EDITION  ===============================
 *
 *  Pemisahan beban ke dua core ESP32:
 *    CORE 0 (PRO_CPU) -> netTask  : SEMUA urusan IoT/jaringan
 *        WiFi + reconnect, NTP, Firebase auth/refresh token,
 *        GET /command, PUT /state, GET /activeSchedule, POST /feedEvents.
 *    CORE 1 (APP_CPU) -> sysTask  : SEMUA urusan sistem/hardware real-time
 *        HX711, motor BTS7960 + encoder (+ safety timeout), servo non-blocking,
 *        SSR blower, LCD I2C, 3 push button, state-machine feeding, scheduler.
 *
 *  Kenapa dipisah: request HTTP (timeout s/d 6 dtk) TIDAK BOLEH menahan
 *  penghentian motor / emergency stop / pembacaan tombol. Dengan dua core,
 *  jaringan yang lambat tidak pernah membekukan kontrol hardware.
 *
 *  Aturan emas (jangan dilanggar saat menambah fitur):
 *    - Objek WiFiClientSecure/HTTPClient HANYA disentuh netTask (Core 0).
 *    - HX711/Servo/LCD/motor/SSR HANYA disentuh sysTask (Core 1).
 *    - Data lintas-core HANYA lewat: cmdQueue, feedEvtQueue, stateMutex,
 *      schedMutex, dan flag atomik (g_fbReady/g_wifiOnline/g_stopRequested).
 *
 *  Butuh Arduino-ESP32 core 3.x (analogWrite tersedia). Lib: ArduinoJson v7,
 *  HX711, LiquidCrystal_I2C, ESP32Servo.
 *
 *  CATATAN KEAMANAN: isi kredensial di bawah, JANGAN commit nilai asli ke repo
 *  publik.
 * ============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <HX711.h>
#include <LiquidCrystal_I2C.h>
#include <ESP32Servo.h>
#include <time.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>

// ============================ KONFIGURASI ===================================
const char* WIFI_SSID     = "udang";
const char* WIFI_PASSWORD = "12345678";

// Firebase (gunakan akun DEVICE khusus yang dibuat manual di Firebase Auth)
#define FB_API_KEY      "AIzaSyCHz1qENBKAxSgXhsXjQrsCnQLlRTbipKc"
#define FB_DB_URL       "https://udangdatabase-default-rtdb.firebaseio.com"
#define FB_DEVICE_EMAIL "admin@gmail.com"
#define FB_DEVICE_PASS  "admin123"

// NTP (WIB = UTC+7). gmtOffset 7*3600, no DST.
const long  GMT_OFFSET_SEC = 7 * 3600;
const int   DST_OFFSET_SEC = 0;
const char* NTP1 = "pool.ntp.org";
const char* NTP2 = "time.google.com";

// Interval (ms) — dipercepat untuk respon mendekati real-time.
// Aman karena koneksi DB pakai keep-alive (lihat g_db) → tak handshake TLS tiap request.
const unsigned long POLL_CMD_INTERVAL   = 500;    // latensi tombol/feedNow/stop ≤ ~0.7 dtk
const unsigned long PUSH_STATE_INTERVAL = 1000;   // telemetri & status online terasa live
const unsigned long FETCH_SCHED_INTERVAL= 30000;  // jadwal jarang berubah, cukup 30 dtk
const unsigned long LCD_INTERVAL        = 500;

// Safety timeout feeding (ms)
const unsigned long MOTOR_MOVE_TIMEOUT  = 8000;
const unsigned long WEIGH_TIMEOUT       = 60000;
const unsigned long EMPTY_TIMEOUT       = 30000;

// Parameter sekuens pakan (tune sesuai hardware)
const float         WEIGH_OVERSHOOT_G = 100.0;  // tutup katup lebih awal sebesar ini: pakan
                                                // masih jatuh saat katup menutup (mis. SP 500 -> tutup di 400)
const unsigned long SETTLE_MS         = 3000;   // jeda setelah servo BUKA, sebelum blower nyala
const unsigned long BLOW_EXTRA_MS     = 3000;   // lanjut blower setelah berat < EMPTY_THRESHOLD

// Periode loop tiap task
const TickType_t SYS_TICK = pdMS_TO_TICKS(10);   // kontrol real-time
const TickType_t NET_TICK = pdMS_TO_TICKS(1);   // jaringan

// ============================ PIN HARDWARE ==================================
HX711 scale;
LiquidCrystal_I2C lcd(0x27, 16, 2);
uint8_t dataPin = 15, clockPin = 5;

#define RPWM 26
#define LPWM 25
#define ENCODER_A 34
#define ENCODER_B 35
#define LIMIT_SW  19          // limit switch HOME katup (NO->GND), aktif LOW (INPUT_PULLUP)
#define POSISI_BUKA   400    // hitungan encoder saat katup BUKA penuh (hasil kalibrasi bench)
#define POSISI_TUTUP  0       // HOME = posisi limit switch; encoder dikalibrasi 0 di sini
#define PWM_MOTOR 120
#define TOLERANSI 3

#define SSR_PIN 14
#define SERVO_PIN 23
// Pemetaan sudut servo & kecepatan — tune sendiri sesuai hardware
#define SERVO_CLOSE    0    // gate TUTUP (idle/normal)
#define SERVO_OPEN    40    // gate BUKA (dispense pakan)
#define SERVO_STEP_MS 1    // ms antar step (makin kecil makin cepat)
#define SERVO_STEP_DEG 50    // derajat per step (makin besar makin cepat)
#define PB1 32   // Motor
#define PB2 33   // SSR
#define PB3 27   // Servo

Servo myservo;

// ============================ STATE HARDWARE (milik sysTask) ================
float berat = 0;
const float WEIGHT_VALID_MIN = 50.0;   // < ini dianggap 0
const float EMPTY_THRESHOLD  = 50.0;   // blower berhenti saat berat < ini ("dibawah 50")

volatile long encoderCount = 0;
bool  posisiBuka = false;
bool  motorRunning = false;
long  targetEncoder = POSISI_TUTUP;
unsigned long motorStartMs = 0;

bool  ssrState = false;
int   servoTarget = SERVO_CLOSE;
int   servoCurrent = SERVO_CLOSE;
unsigned long lastServoStep = 0;

// ============================ STATE JARINGAN (milik netTask) ================
WiFiClientSecure tls;
HTTPClient g_db;                  // koneksi DB persisten (keep-alive) -> hemat handshake TLS = respon cepat
String idToken = "";
unsigned long tokenExpireMs = 0;
double lastCmdTs = 0;             // last-write-wins tracking

// ============================ FLAG ATOMIK LINTAS-CORE =======================
volatile bool g_wifiOnline    = false;   // net tulis, sys baca (LCD)
volatile bool g_fbReady       = false;   // net tulis, sys baca (LCD)
volatile bool g_stopRequested = false;   // net tulis (stop), sys baca+clear

// ============================ JADWAL (shared, schedMutex) ===================
struct Cycle { char name[20]; int days; float fr; };

struct ScheduleData {
  bool enabled = false;
  char startDate[12] = "2026-01-01";
  int  offsetAge = 1;
  long count = 1000;
  float initialWeight = 5.0;
  char feedTimes[6][6];
  int  feedTimesN = 0;
  Cycle cycles[6];
  int  cyclesN = 0;
};

ScheduleData g_sched;     // ditulis netTask (fetchSchedule), dilindungi schedMutex
ScheduleData sched;       // salinan kerja milik sysTask (di-refresh tiap loop)
String lastFeedKey = "";  // cegah trigger ganda per slot/hari (sysTask)

// ============================ SNAPSHOT STATE (shared, stateMutex) ===========
struct StateSnapshot {
  float weight = 0;
  long  encoder = 0;
  int   motor = 0;     // 0/1
  int   ssr = 0;       // 0/1
  int   servo = 0;     // 0..50
  bool  feeding = false;
  int   stage = 0;
};
StateSnapshot g_snap;     // sysTask tulis, netTask baca, dilindungi stateMutex

// ============================ ANTREAN LINTAS-CORE ===========================
enum CmdType : uint8_t { CMD_MOTOR, CMD_SSR, CMD_SERVO, CMD_FEED_NOW };
struct DeviceCommand { uint8_t type; int value; };

struct FeedEventMsg {
  double ts;
  float  setpoint;
  float  delivered;
  char   cycle[20];
  char   trigger[10];
};

QueueHandle_t     cmdQueue     = nullptr;   // net -> sys (command manual / feedNow)
QueueHandle_t     feedEvtQueue = nullptr;   // sys -> net (event feeding selesai)
SemaphoreHandle_t stateMutex   = nullptr;
SemaphoreHandle_t schedMutex   = nullptr;

// ============================ FEEDING STATE MACHINE (sysTask) ===============
// Urutan baru:
//  TARE -> buka katup -> timbang (tutup di SP-100) -> tutup katup ->
//  buka servo -> jeda 3s -> blower ON -> dorong s/d <50 -> blower 3s lagi ->
//  blower OFF -> TARE -> tutup servo -> selesai.
enum FeedStage {
  F_IDLE,        // 0
  F_OPEN,        // 1  buka katup (motor)
  F_WEIGH,       // 2  timbang s/d (setpoint - WEIGH_OVERSHOOT_G)
  F_CLOSE,       // 3  tutup katup (motor)
  F_SERVO_OPEN,  // 4  buka servo (gerbang dispense)
  F_SETTLE,      // 5  jeda 3 dtk sebelum blower
  F_BLOW,        // 6  blower dorong pakan s/d berat < EMPTY_THRESHOLD
  F_BLOW_EXTRA,  // 7  blower lanjut 3 dtk
  F_FINISH,      // 8  blower OFF -> tare -> tutup servo
  F_DONE         // 9  selesai (tunggu servo tertutup)
};

// Stage labels (pakai int agar Arduino auto-prototype tidak error)
const char* stageLabel(int s) {
  switch (s) {
    case F_IDLE:       return "Idle";
    case F_OPEN:       return "BukaKatup";
    case F_WEIGH:      return "Timbang";
    case F_CLOSE:      return "TutupKatup";
    case F_SERVO_OPEN: return "BukaServo";
    case F_SETTLE:     return "Jeda 3s";
    case F_BLOW:       return "Blower";
    case F_BLOW_EXTRA: return "Blower 3s";
    case F_FINISH:     return "Tare+Tutup";
    case F_DONE:       return "Selesai";
    default:           return "?";
  }
}
FeedStage feedStage = F_IDLE;
float  feedSetpoint = 0;
float  feedWeighed  = 0;   // takaran final yang ditimbang (untuk dicatat sbg "delivered")
String feedCycleName = "";
String feedTrigger = "auto";
unsigned long stageStartMs = 0;

// timers
unsigned long tCmd=0, tState=0, tSched=0, tLcd=0;

// ============================ ENCODER ISR (Core 1) ==========================
void IRAM_ATTR encoderISR() {
  if (digitalRead(ENCODER_A) == digitalRead(ENCODER_B)) {
    encoderCount = encoderCount + 1;
  } else {
    encoderCount = encoderCount - 1;
  }
  if (encoderCount < 0) encoderCount = 0;   // HOME (limit switch) = 0, cegah nilai negatif
}

// ============================ MOTOR (sysTask) ===============================
// Pakai ledcWrite dengan channel dedicated (timer 1) agar tidak konflik dgn servo (timer 0)
void motorMaju()  { ledcWrite(RPWM, PWM_MOTOR); ledcWrite(LPWM, 0); }
void motorMundur(){ ledcWrite(RPWM, 0); ledcWrite(LPWM, PWM_MOTOR); }
void stopMotor()  { ledcWrite(RPWM, 0); ledcWrite(LPWM, 0); motorRunning = false; }

void setMotorPosition(bool buka) {
  if (motorRunning) return;
  posisiBuka = buka;
  motorStartMs = millis();
  if (buka) {
    targetEncoder = POSISI_BUKA;
    (encoderCount < POSISI_BUKA) ? motorMaju() : motorMundur();
  } else {
    targetEncoder = POSISI_TUTUP;
    motorMundur();                       // TUTUP = selalu menuju HOME (limit switch)
  }
  motorRunning = true;
}

// dipanggil tiap loop sysTask: cek target tercapai ATAU timeout (anti-runaway)
void updateMotor() {
  if (!motorRunning) return;

  if (targetEncoder == POSISI_BUKA) {
    // BUKA: berhenti saat hitungan encoder mencapai target
    if (encoderCount >= POSISI_BUKA - TOLERANSI) { stopMotor(); return; }
  } else {
    // TUTUP: PRIORITAS limit switch (HOME). Saat tertekan -> stop + kalibrasi encoder = 0.
    if (digitalRead(LIMIT_SW) == LOW) {
      stopMotor();
      noInterrupts(); encoderCount = 0; interrupts();
      return;
    }
    // Cadangan: bila limit switch gagal/terlepas, encoder tetap menghentikan motor
    if (encoderCount <= POSISI_TUTUP + TOLERANSI) { stopMotor(); return; }
  }

  if (millis() - motorStartMs > MOTOR_MOVE_TIMEOUT) {
    stopMotor();
    Serial.println("⚠️ MOTOR_TIMEOUT");
  }
}

// ============================ SSR / SERVO (sysTask) =========================
void setSSR(bool on) { ssrState = on; digitalWrite(SSR_PIN, on ? HIGH : LOW); }

void setServo(int angle) {
  if (angle == 1) angle = SERVO_OPEN;   // web kirim 1 = buka
  servoTarget = (angle > (SERVO_OPEN + SERVO_CLOSE) / 2) ? SERVO_OPEN : SERVO_CLOSE;
}

void updateServo() {
  if (servoCurrent == servoTarget) return;
  unsigned long now = millis();
  if (SERVO_STEP_MS > 0 && now - lastServoStep < (unsigned long)SERVO_STEP_MS) return;
  lastServoStep = now;
  int diff = servoTarget - servoCurrent;
  if (diff > 0) servoCurrent += (diff < SERVO_STEP_DEG) ? diff : SERVO_STEP_DEG;
  else          servoCurrent -= ((-diff) < SERVO_STEP_DEG) ? (-diff) : SERVO_STEP_DEG;
  myservo.write(servoCurrent);
}

// ============================ LOADCELL (sysTask) ============================
float getValidatedWeight() {
  float w = scale.get_units(5);
  if (w < WEIGHT_VALID_MIN) return 0.0;
  return w;
}

// ============================ WAKTU =========================================
// Howard Hinnant days_from_civil -> hari sejak epoch (untuk selisih tanggal)
long daysFromCivil(int y, unsigned m, unsigned d) {
  y -= m <= 2;
  long era = (y >= 0 ? y : y - 399) / 400;
  unsigned yoe = (unsigned)(y - era * 400);
  unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097L + (long)doe - 719468L;
}

bool getNowTm(struct tm &out) {
  time_t now = time(nullptr);
  if (now < 100000) return false;   // belum sinkron NTP
  localtime_r(&now, &out);
  return true;
}

// umur udang hari ini = offset + (hari ini - startDate). Pakai salinan `sched`.
int currentAgeDays() {
  struct tm t;
  if (!getNowTm(t)) return -1;
  long today = daysFromCivil(t.tm_year + 1900, t.tm_mon + 1, t.tm_mday);
  int sy, sm, sd;
  if (sscanf(sched.startDate, "%d-%d-%d", &sy, &sm, &sd) != 3) return -1;
  long start = daysFromCivil(sy, sm, sd);
  return sched.offsetAge + (int)(today - start);
}

// setpoint siklus aktif (gram per feed); -1 bila di luar masa tebar. Pakai `sched`.
float currentSetpoint(String &cycleNameOut) {
  int age = currentAgeDays();
  if (age < 0) return -1;
  float biomass = sched.initialWeight * (float)sched.count;
  long acc = 0;
  for (int i = 0; i < sched.cyclesN; i++) {
    if (age < acc + sched.cycles[i].days) {
      cycleNameOut = String(sched.cycles[i].name);
      float daily = biomass * sched.cycles[i].fr / 100.0;
      return daily / (sched.feedTimesN > 0 ? sched.feedTimesN : 3);
    }
    acc += sched.cycles[i].days;
  }
  return -1;   // selesai
}

// ============================ FIREBASE REST (netTask) =======================
bool fbAuthenticate() {
  tls.setInsecure();
  HTTPClient http;
  String url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + String(FB_API_KEY);
  http.begin(tls, url);
  http.setReuse(false);   // host beda dari DB; jangan biarkan socket ter-ikat ke host auth
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"email\":\"") + FB_DEVICE_EMAIL +
                "\",\"password\":\"" + FB_DEVICE_PASS + "\",\"returnSecureToken\":true}";
  int code = http.POST(body);
  bool ok = false;
  if (code == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString()) && doc["idToken"].is<const char*>()) {
      idToken = doc["idToken"].as<String>();
      tokenExpireMs = millis() + 3500000UL;   // ~58 menit
      g_fbReady = true; ok = true;
      Serial.println("✅ Firebase auth OK");
    }
  } else {
    Serial.printf("❌ Auth gagal HTTP %d\n", code);
  }
  http.end();
  if (!ok) g_fbReady = false;
  return ok;
}

void ensureToken() {
  if (!g_fbReady || millis() > tokenExpireMs) fbAuthenticate();
}

// Semua request DB pakai g_db (keep-alive): begin->...->end() dgn setReuse(true)
// membuat socket TLS TETAP hidup ke host yg sama, jadi request berikutnya tak
// handshake ulang (hemat ~1 dtk/poll) -> respon perintah & telemetri jauh lebih cepat.
bool fbGet(const String &path, String &out) {
  if (!g_fbReady) return false;
  String url = String(FB_DB_URL) + path + ".json?auth=" + idToken;
  g_db.begin(tls, url);
  g_db.setReuse(true);
  g_db.setTimeout(6000);
  int code = g_db.GET();
  bool ok = (code == 200);
  if (ok) out = g_db.getString();
  g_db.end();
  return ok;
}

bool fbPut(const String &path, const String &json) {
  if (!g_fbReady) return false;
  String url = String(FB_DB_URL) + path + ".json?auth=" + idToken;
  g_db.begin(tls, url);
  g_db.setReuse(true);
  g_db.addHeader("Content-Type", "application/json");
  g_db.setTimeout(6000);
  int code = g_db.PUT(json);
  g_db.end();
  return (code == 200);
}

bool fbPost(const String &path, const String &json) {
  if (!g_fbReady) return false;
  String url = String(FB_DB_URL) + path + ".json?auth=" + idToken;
  g_db.begin(tls, url);
  g_db.setReuse(true);
  g_db.addHeader("Content-Type", "application/json");
  g_db.setTimeout(6000);
  int code = g_db.POST(json);
  g_db.end();
  return (code == 200);
}

// --------------------------- STATE / COMMAND (netTask) ----------------------
void pushState() {
  // ambil snapshot terbaru dari sysTask
  StateSnapshot s;
  if (xSemaphoreTake(stateMutex, pdMS_TO_TICKS(50)) != pdTRUE) return;
  s = g_snap;
  xSemaphoreGive(stateMutex);

  JsonDocument doc;
  doc["weight"]   = s.weight;
  doc["encoder"]  = s.encoder;
  doc["motor"]    = s.motor;
  doc["ssr"]      = s.ssr;
  doc["servo"]    = s.servo;
  doc["feeding"]  = s.feeding;
  doc["stage"]    = s.stage;
  doc["stageLabel"] = stageLabel(s.stage);
  doc["online"]   = true;
  doc["lastSeen"] = (double)time(nullptr) * 1000.0;
  doc["error"]    = "";
  String out; serializeJson(doc, out);
  fbPut("/state", out);
}

// netTask: parse /command -> teruskan ke sysTask via cmdQueue (TIDAK menyentuh hardware)
void pollCommand() {
  String resp;
  if (!fbGet("/command", resp)) return;
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return;
  if (resp == "null") return;

  double ts = doc["ts"] | 0.0;
  if (ts <= lastCmdTs) return;   // bukan command baru (cegah stop/command basi diproses ulang)
  lastCmdTs = ts;

  // emergency stop = command baru paling diutamakan; abaikan perintah lain di pesan yg sama
  if (doc["stop"] | false) {
    g_stopRequested = true;
    Serial.println("🛑 STOP diterima");
    return;
  }

  // feedNow -> minta sysTask mulai feeding manual. value = setpoint (gram) dari web;
  // 0 = tidak diisi -> sysTask pakai setpoint jadwal / fallback.
  if (doc["feedNow"] | false) {
    int sp = doc["setpoint"] | 0;
    DeviceCommand c = { CMD_FEED_NOW, sp };
    xQueueSend(cmdQueue, &c, 0);
    return;
  }

  // command manual diteruskan apa adanya; sysTask yang memutuskan abaikan/terapkan
  if (!doc["motor"].isNull()) { DeviceCommand c = { CMD_MOTOR, doc["motor"].as<int>() }; xQueueSend(cmdQueue, &c, 0); }
  if (!doc["ssr"].isNull())   { DeviceCommand c = { CMD_SSR,   doc["ssr"].as<int>()   }; xQueueSend(cmdQueue, &c, 0); }
  if (!doc["servo"].isNull()) { DeviceCommand c = { CMD_SERVO, doc["servo"].as<int>() }; xQueueSend(cmdQueue, &c, 0); }
}

void fetchSchedule() {
  String resp;
  if (!fbGet("/activeSchedule", resp)) return;
  JsonDocument doc;
  if (deserializeJson(doc, resp)) return;
  if (resp == "null") return;

  ScheduleData tmp;
  tmp.enabled       = doc["enabled"] | false;
  strlcpy(tmp.startDate, doc["startDate"] | "2026-01-01", sizeof(tmp.startDate));
  tmp.offsetAge     = doc["offsetAge"] | 1;
  tmp.count         = doc["count"] | 1000;
  tmp.initialWeight = doc["initialWeight"] | 5.0f;

  tmp.feedTimesN = 0;
  for (JsonVariant v : doc["feedTimes"].as<JsonArray>()) {
    const char* s = v.as<const char*>();
    if (s && tmp.feedTimesN < 6) { strlcpy(tmp.feedTimes[tmp.feedTimesN], s, 6); tmp.feedTimesN++; }
  }
  if (tmp.feedTimesN == 0) {
    strcpy(tmp.feedTimes[0],"07:00"); strcpy(tmp.feedTimes[1],"15:00"); strcpy(tmp.feedTimes[2],"23:00");
    tmp.feedTimesN = 3;
  }

  tmp.cyclesN = 0;
  for (JsonObject c : doc["cycles"].as<JsonArray>()) {
    if (tmp.cyclesN >= 6) break;
    strlcpy(tmp.cycles[tmp.cyclesN].name, c["name"] | "", sizeof(tmp.cycles[tmp.cyclesN].name));
    tmp.cycles[tmp.cyclesN].days = c["days"] | 0;
    tmp.cycles[tmp.cyclesN].fr   = c["fr"] | 0.0f;
    tmp.cyclesN++;
  }

  if (xSemaphoreTake(schedMutex, portMAX_DELAY) == pdTRUE) {
    g_sched = tmp;             // struct POD, copy aman
    xSemaphoreGive(schedMutex);
  }
}

// netTask: kuras antrean event feeding dari sysTask lalu POST. Retry bila gagal.
void drainFeedEvents() {
  FeedEventMsg ev;
  while (xQueueReceive(feedEvtQueue, &ev, 0) == pdTRUE) {
    JsonDocument doc;
    doc["ts"]        = ev.ts;
    doc["setpoint"]  = ev.setpoint;
    doc["delivered"] = ev.delivered;
    doc["cycle"]     = ev.cycle;
    doc["trigger"]   = ev.trigger;
    String out; serializeJson(doc, out);
    if (!fbPost("/feedEvents", out)) {
      // gagal kirim: kembalikan ke depan antrean, coba lagi siklus berikutnya
      xQueueSendToFront(feedEvtQueue, &ev, 0);
      break;
    }
    Serial.println("📤 feedEvent terkirim");
  }
}

// ============================ FEEDING SEQUENCE (sysTask) ====================
void startFeeding(float setpoint, String cycleName, String trigger) {
  if (feedStage != F_IDLE) return;
  feedSetpoint  = setpoint;
  feedCycleName = cycleName;
  feedTrigger   = trigger;
  feedWeighed   = 0;
  g_stopRequested = false;
  scale.tare();                        // TARE dulu: nol-kan timbangan agar takaran akurat
  berat = 0;
  feedStage = F_OPEN;
  stageStartMs = millis();
  setMotorPosition(true);              // buka katup
  Serial.printf("🍽️ Feeding mulai: setpoint=%.0f g, tutup di %.0f g (%s/%s)\n",
                setpoint, setpoint - WEIGH_OVERSHOOT_G, cycleName.c_str(), trigger.c_str());
}

void abortFeeding() {
  stopMotor(); setSSR(false); setServo(SERVO_CLOSE);
  feedStage = F_IDLE;
  Serial.println("🛑 Feeding dibatalkan");
}

// sysTask: kirim event feeding ke netTask (TIDAK menyentuh jaringan langsung)
void enqueueFeedEvent(float delivered) {
  FeedEventMsg ev;
  ev.ts        = (double)time(nullptr) * 1000.0;
  ev.setpoint  = feedSetpoint;
  ev.delivered = delivered;
  strlcpy(ev.cycle,   feedCycleName.c_str(), sizeof(ev.cycle));
  strlcpy(ev.trigger, feedTrigger.c_str(),   sizeof(ev.trigger));
  xQueueSend(feedEvtQueue, &ev, 0);
}

void updateFeeding() {
  if (feedStage == F_IDLE) { g_stopRequested = false; return; }  // buang stop basi
  if (g_stopRequested) { abortFeeding(); g_stopRequested = false; return; }
  unsigned long el = millis() - stageStartMs;

  switch (feedStage) {
    case F_OPEN:   // katup membuka, pakan mulai jatuh ke timbangan
      if (!motorRunning) { feedStage = F_WEIGH; stageStartMs = millis(); }
      else if (el > MOTOR_MOVE_TIMEOUT) { Serial.println("⚠️ open timeout"); feedStage = F_WEIGH; stageStartMs = millis(); }
      break;

    case F_WEIGH: {
      // tutup lebih awal: kompensasi pakan yg masih jatuh saat katup menutup (SP-100)
      float closeAt = feedSetpoint - WEIGH_OVERSHOOT_G;
      if (closeAt < 0) closeAt = 0;
      if (berat >= closeAt)        { setMotorPosition(false); feedStage = F_CLOSE; stageStartMs = millis(); }
      else if (el > WEIGH_TIMEOUT) { Serial.println("⚠️ weigh timeout"); setMotorPosition(false); feedStage = F_CLOSE; stageStartMs = millis(); }
      break;
    }

    case F_CLOSE:  // katup menutup; setelah tertutup, simpan takaran lalu BUKA servo
      if (!motorRunning || el > MOTOR_MOVE_TIMEOUT) {
        feedWeighed = berat;                 // takaran final (≈ setpoint) yg akan didorong keluar
        setServo(SERVO_OPEN);                // buka servo DULU (sebelum blower)
        feedStage = F_SERVO_OPEN; stageStartMs = millis();
      }
      break;

    case F_SERVO_OPEN:  // tunggu servo benar-benar terbuka
      if (servoCurrent == SERVO_OPEN || el > 1000) { feedStage = F_SETTLE; stageStartMs = millis(); }
      break;

    case F_SETTLE:  // jeda 3 dtk setelah servo buka, baru nyalakan blower
      if (el >= SETTLE_MS) { setSSR(true); feedStage = F_BLOW; stageStartMs = millis(); }
      break;

    case F_BLOW:  // blower mendorong pakan keluar sampai timbangan < EMPTY_THRESHOLD (<50)
      if (berat <= EMPTY_THRESHOLD || el > EMPTY_TIMEOUT) { feedStage = F_BLOW_EXTRA; stageStartMs = millis(); }
      break;

    case F_BLOW_EXTRA:  // sudah <50 -> hitung mundur 3 dtk sambil blower tetap nyala
      if (el >= BLOW_EXTRA_MS) {
        setSSR(false);                       // matikan blower
        scale.tare(); berat = 0;             // TARE -> nol-kan timbangan
        setServo(SERVO_CLOSE);               // tutup servo
        enqueueFeedEvent(feedWeighed);       // catat takaran yg diberikan
        feedStage = F_FINISH; stageStartMs = millis();
      }
      break;

    case F_FINISH:  // tunggu servo benar-benar tertutup
      if (servoCurrent == SERVO_CLOSE || el > 1500) { feedStage = F_DONE; stageStartMs = millis(); }
      break;

    case F_DONE:
      feedStage = F_IDLE;
      Serial.println("✅ Feeding selesai");
      break;

    default: break;
  }
}

// ============================ SCHEDULER (sysTask) ===========================
void checkSchedule() {
  if (!sched.enabled || feedStage != F_IDLE) return;
  struct tm t;
  if (!getNowTm(t)) return;
  char hhmm[6]; snprintf(hhmm, sizeof(hhmm), "%02d:%02d", t.tm_hour, t.tm_min);
  for (int i = 0; i < sched.feedTimesN; i++) {
    if (strcmp(sched.feedTimes[i], hhmm) == 0) {
      char key[24];
      snprintf(key, sizeof(key), "%04d%02d%02d-%s", t.tm_year+1900, t.tm_mon+1, t.tm_mday, hhmm);
      if (lastFeedKey == String(key)) return;   // sudah dipicu
      String cyc; float sp = currentSetpoint(cyc);
      if (sp > 0) {
        lastFeedKey = String(key);
        startFeeding(sp, cyc, "auto");
      }
      return;
    }
  }
}

// ============================ COMMAND APPLY (sysTask) =======================
// Terapkan command dari netTask. Aturan domain dipegang DI SINI (bukan di net).
void applyCommands() {
  DeviceCommand cmd;
  while (xQueueReceive(cmdQueue, &cmd, 0) == pdTRUE) {
    if (cmd.type == CMD_FEED_NOW) {
      if (feedStage == F_IDLE) {
        String cyc; float schedSp = currentSetpoint(cyc);
        // prioritas: takaran manual dari web (cmd.value>0) -> jadwal -> fallback 100
        float sp = (cmd.value > 0) ? (float)cmd.value : schedSp;
        if (sp <= 0) sp = 100;
        startFeeding(sp, cyc.length() ? cyc : "manual", "manual");
      }
      continue;
    }
    if (feedStage != F_IDLE) continue;               // manual diabaikan saat feeding
    switch (cmd.type) {
      case CMD_MOTOR: setMotorPosition(cmd.value == 1); break;
      case CMD_SSR:   setSSR(cmd.value == 1);           break;
      case CMD_SERVO: setServo(cmd.value);              break;
      default: break;
    }
  }
}

// ============================ PUSH BUTTON lokal (sysTask) ===================
void handleButtons() {
  static bool l1=HIGH,l2=HIGH,l3=HIGH;
  bool b1=digitalRead(PB1), b2=digitalRead(PB2), b3=digitalRead(PB3);
  if (feedStage == F_IDLE) {   // manual lokal hanya saat idle
    if (l1==HIGH && b1==LOW && !motorRunning) setMotorPosition(!posisiBuka);
    if (l2==HIGH && b2==LOW) setSSR(!ssrState);
    if (l3==HIGH && b3==LOW) setServo(servoTarget == SERVO_CLOSE ? SERVO_OPEN : SERVO_CLOSE);
  }
  l1=b1; l2=b2; l3=b3;
}

// ============================ SNAPSHOT (sysTask -> shared) ==================
void publishSnapshot() {
  if (xSemaphoreTake(stateMutex, pdMS_TO_TICKS(5)) != pdTRUE) return;
  g_snap.weight  = berat;
  g_snap.encoder = encoderCount;
  g_snap.motor   = posisiBuka ? 1 : 0;
  g_snap.ssr     = ssrState ? 1 : 0;
  g_snap.servo   = servoCurrent;
  g_snap.feeding = (feedStage != F_IDLE);
  g_snap.stage   = (int)feedStage;
  xSemaphoreGive(stateMutex);
}

// ============================ LCD (sysTask) =================================
void updateLCD() {
  lcd.setCursor(0,0);
  lcd.print("B:"); lcd.print(berat,0); lcd.print("g ");
  lcd.print(feedStage!=F_IDLE ? "FEED " : (g_fbReady ? "ONL " : "OFF "));
  lcd.print("   ");
  lcd.setCursor(0,1);
  lcd.print("M:"); lcd.print(posisiBuka?"O":"-");
  lcd.print(" S:"); lcd.print(ssrState?"1":"0");
  lcd.print(" V:"); lcd.print(servoCurrent);
  lcd.print(" ");  lcd.print(sched.enabled?"AUTO":"man");
  lcd.print("   ");
}

// ============================ TASK: SISTEM (Core 1) =========================
void sysTask(void* pv) {
  // --- init hardware (semua milik core ini) ---
  pinMode(PB1, INPUT_PULLUP); pinMode(PB2, INPUT_PULLUP); pinMode(PB3, INPUT_PULLUP);
  pinMode(SSR_PIN, OUTPUT); digitalWrite(SSR_PIN, LOW);
  pinMode(RPWM, OUTPUT); pinMode(LPWM, OUTPUT);
  pinMode(ENCODER_A, INPUT); pinMode(ENCODER_B, INPUT);
  pinMode(LIMIT_SW, INPUT_PULLUP);   // limit switch HOME katup, aktif LOW
  // Init motor PWM dulu (ledcAttachChannel, timer 1) SEBELUM servo (timer 0) agar timer tidak rebutan
  ledcAttachChannel(RPWM, 5000, 8, 4);   // channel 4 → timer 1 (beda dgn servo yg ch 0 → timer 0)
  ledcAttachChannel(LPWM, 5000, 8, 5);   // channel 5 → timer 1
  ledcWrite(RPWM, 0); ledcWrite(LPWM, 0);
  attachInterrupt(digitalPinToInterrupt(ENCODER_A), encoderISR, CHANGE);  // ISR ter-alokasi di Core 1

  lcd.init(); lcd.backlight();
  lcd.setCursor(0,0); lcd.print("Shrimp Feeder v3");
  lcd.setCursor(0,1); lcd.print("Init... [2core]");

  // --- Homing katup: tutup penuh sampai limit switch supaya encoder ter-kalibrasi 0.
  //     Posisi awal pasti TUTUP/aman walau alat reboot di tengah pakan. ---
  lcd.setCursor(0,1); lcd.print("Homing katup... ");
  if (digitalRead(LIMIT_SW) != LOW) {           // belum di HOME -> jalan mundur cari limit
    motorMundur();
    unsigned long hStart = millis();
    while (digitalRead(LIMIT_SW) == HIGH && millis() - hStart < MOTOR_MOVE_TIMEOUT) {
      vTaskDelay(pdMS_TO_TICKS(5));
    }
    stopMotor();
  }
  noInterrupts(); encoderCount = 0; interrupts();
  posisiBuka = false;
  targetEncoder = POSISI_TUTUP;

  scale.begin(dataPin, clockPin);
  scale.set_offset(193344);
  scale.set_scale(104.434151);
  scale.tare();

  myservo.setPeriodHertz(50);
  myservo.attach(SERVO_PIN, 500, 2400);
  myservo.write(SERVO_CLOSE);
  servoCurrent = SERVO_CLOSE;

  lcd.clear();
  Serial.println("🧩 sysTask aktif di core " + String(xPortGetCoreID()));

  for (;;) {
    unsigned long now = millis();

    // refresh salinan jadwal dari netTask (lock singkat; skip bila lagi dipakai)
    if (xSemaphoreTake(schedMutex, pdMS_TO_TICKS(5)) == pdTRUE) {
      sched = g_sched;
      xSemaphoreGive(schedMutex);
    }

    berat = getValidatedWeight();   // blocking HX711, aman: tak ganggu jaringan
    applyCommands();                // terapkan command dari netTask
    updateMotor();
    updateServo();
    handleButtons();
    updateFeeding();
    checkSchedule();
    publishSnapshot();

    if (now - tLcd >= LCD_INTERVAL) { tLcd = now; updateLCD(); }

    vTaskDelay(SYS_TICK);
  }
}

// ============================ TASK: IOT/JARINGAN (Core 0) ===================
void connectWiFi(int maxAttempts) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int a = 0;
  while (WiFi.status() != WL_CONNECTED && a < maxAttempts) {
    vTaskDelay(pdMS_TO_TICKS(500)); Serial.print("."); a++;
  }
  g_wifiOnline = (WiFi.status() == WL_CONNECTED);
  if (g_wifiOnline) {
    Serial.println("\n✅ WiFi: " + WiFi.localIP().toString());
    configTime(GMT_OFFSET_SEC, DST_OFFSET_SEC, NTP1, NTP2);
  } else {
    Serial.println("\n⚠️ WiFi gagal — mode lokal (sysTask tetap jalan)");
  }
}

void netTask(void* pv) {
  Serial.println("🌐 netTask aktif di core " + String(xPortGetCoreID()));
  connectWiFi(30);
  if (g_wifiOnline) {
    fbAuthenticate();
    fetchSchedule();
    pushState();
  }

  for (;;) {
    unsigned long now = millis();

    // jaga koneksi WiFi
    if (WiFi.status() != WL_CONNECTED) {
      g_wifiOnline = false; g_fbReady = false;
      Serial.println("🔁 WiFi putus, reconnect...");
      WiFi.reconnect();
      vTaskDelay(pdMS_TO_TICKS(2000));
      if (WiFi.status() == WL_CONNECTED) {
        g_wifiOnline = true;
        configTime(GMT_OFFSET_SEC, DST_OFFSET_SEC, NTP1, NTP2);
        fbAuthenticate();
      }
      continue;
    }
    g_wifiOnline = true;

    ensureToken();
    if (now - tCmd   >= POLL_CMD_INTERVAL)    { tCmd=now;   pollCommand(); }
    if (now - tState >= PUSH_STATE_INTERVAL)  { tState=now; pushState(); }
    if (now - tSched >= FETCH_SCHED_INTERVAL) { tSched=now; fetchSchedule(); }
    drainFeedEvents();

    vTaskDelay(NET_TICK);
  }
}

// ============================ SETUP / LOOP ==================================
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println("\n=== Shrimp Feeder v3 — DUAL CORE ===");

  // primitif komunikasi antar-core (WAJIB dibuat sebelum task start)
  cmdQueue     = xQueueCreate(8, sizeof(DeviceCommand));
  feedEvtQueue = xQueueCreate(8, sizeof(FeedEventMsg));
  stateMutex   = xSemaphoreCreateMutex();
  schedMutex   = xSemaphoreCreateMutex();

  // sysTask: kontrol hardware real-time -> Core 1, prioritas lebih tinggi
  xTaskCreatePinnedToCore(sysTask, "sysTask", 8192,  NULL, 3, NULL, 1);
  // netTask: IoT/jaringan (TLS rakus stack)  -> Core 0
  xTaskCreatePinnedToCore(netTask, "netTask", 12288, NULL, 1, NULL, 0);
}

void loop() {
  // semua kerja ada di sysTask & netTask; loopTask cukup idle.
  vTaskDelay(pdMS_TO_TICKS(1000));
}
