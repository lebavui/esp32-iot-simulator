const int LED1 = 4;
void fast(void *pv) {
  for (;;) {
    digitalWrite(LED1, !digitalRead(LED1));
    Serial.printf("fast %d\n", digitalRead(LED1));
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}
void setup() {
  Serial.begin(115200);
  pinMode(LED1, OUTPUT);
  xTaskCreatePinnedToCore(fast, "fast", 2048, NULL, 1, NULL, 0);
}
void loop() { vTaskDelete(NULL); }
