#include <ArduinoJson.h>
#include <Preferences.h>
Preferences prefs;
typedef struct { const char* name; int pin; } Led;
Led leds[] = { {"red", 25}, {"green", 26} };
const char* names[] = {"a", "bb", "ccc"};
int matrix[2][3] = {{1,2,3},{4,5,6}};
volatile int ticks = 0;

void task1(void *pv) {
  for (;;) { ticks++; vTaskDelay(pdMS_TO_TICKS(20)); }
}

void setup() {
  Serial.begin(115200);
  StaticJsonDocument<200> doc;
  doc["sensor"] = "dht22";
  doc["temp"] = 25.5;
  doc["ok"] = true;
  JsonArray data = doc.createNestedArray("data");
  data.add(1); data.add(2);
  doc["nested"]["a"] = 7;
  String out;
  serializeJson(doc, out);
  Serial.println(out);
  JsonDocument d2;
  DeserializationError err = deserializeJson(d2, "{\"led\":\"on\",\"value\":42,\"f\":1.5,\"arr\":[10,20,30]}");
  if (err) { Serial.print("err "); Serial.println(err.c_str()); }
  const char* led = d2["led"];
  int value = d2["value"];
  float f = d2["f"].as<float>();
  Serial.println(String(led) + " " + value + " " + f);
  for (JsonVariant v : d2["arr"].as<JsonArray>()) Serial.print(v.as<int>()), Serial.print(",");
  Serial.println();
  int missing = d2["nope"] | -1;
  Serial.println(missing);
  if (String(led) == "on") Serial.println("LED ON");
  DeserializationError e2 = deserializeJson(d2, "{bad");
  Serial.println(e2.c_str());
  serializeJson(doc, Serial); Serial.println();
  for (int i = 0; i < 2; i++) Serial.printf("%s=%d ", leds[i].name, leds[i].pin);
  Serial.println(sizeof(leds)/sizeof(leds[0]));
  Serial.println(names[2]);
  Serial.println(matrix[1][2]);
  auto sq2 = [](int v) { return v * v; };
  Serial.println(sq2(9));
  prefs.begin("app", false);
  int boots = prefs.getInt("boots", 0);
  prefs.putInt("boots", boots + 1);
  Serial.println(prefs.getInt("boots", 0));
  xTaskCreatePinnedToCore(task1, "t1", 2048, NULL, 1, NULL, 0);
}

void loop() {
  delay(150);
  Serial.println(ticks > 3 ? "tasks ok" : "tasks slow");
  vTaskDelete(NULL);
}
