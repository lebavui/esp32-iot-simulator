#define LED 2
int counter = 0;
float temp = 23.456;
String name = "ESP32";
byte b = 250;
unsigned long last = 0;
int arr[] = {5, 3, 9, 1};
char buf[32];
struct Point { int x; int y; };
Point p = {3, 4};
enum Mode { IDLE, RUN = 5, STOP };

int add(int a, int b = 10) { return a + b; }
void swap(int &a, int &b) { int t = a; a = b; b = t; }
float avg(int *a, int n) { long s = 0; for (int i = 0; i < n; i++) s += a[i]; return (float)s / n; }

void setup() {
  Serial.begin(115200);
  pinMode(LED, OUTPUT);
  Serial.println("Hello " + name + " xin chào!");
  Serial.println(temp);
  Serial.println(temp, 3);
  Serial.println(7 / 2);
  Serial.println(7.0 / 2);
  Serial.println(255, HEX);
  Serial.println('A');
  Serial.println((int)'A');
  Serial.println(true);
  for (int i = 0; i < 10; i++) b++;
  Serial.println(b);
  Serial.println(add(5));
  int x = 1, y = 2; swap(x, y);
  Serial.printf("x=%d y=%d avg=%.2f size=%d\n", x, y, avg(arr, 4), sizeof(arr) / sizeof(arr[0]));
  sprintf(buf, "T=%05.1f", temp);
  Serial.println(buf);
  String s = String(temp, 1) + "C";
  s += 'X'; s += 12;
  Serial.println(s);
  s.toUpperCase();
  Serial.println(s + " len=" + s.length());
  Serial.println(p.x * p.y);
  Serial.println(STOP);
  Serial.println(map(512, 0, 1023, 0, 255));
  String msg = "";
  byte payload[] = {104, 105};
  for (int i = 0; i < 2; i++) msg += (char)payload[i];
  Serial.println(msg == "hi" ? "match" : "no");
  switch (counter) { case 0: Serial.println("zero"); break; default: Serial.println("other"); }
  unsigned int u = 0; u--; Serial.println(u);
  int big = 2147483647; big++; Serial.println(big);
  Serial.println(String("abc").indexOf('b'));
  Serial.println(sq(3));
  bitSet(counter, 3); Serial.println(counter);
}

void loop() {
  digitalWrite(LED, !digitalRead(LED));
  delay(100);
  counter++;
  if (counter == 2) Serial.println("loop2 " + String(millis() > 150));
}
