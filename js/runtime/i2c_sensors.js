// Simulated I2C sensor libraries: SHT30/SHT31 (Adafruit_SHT31), BMP280 (Adafruit_BMP280), BH1750 (BH1750 by claws),
// VL53L0X (Adafruit_VL53L0X and Pololu VL53L0X), MAX30100 (MAX30100lib: PulseOximeter), MLX90614 (Adafruit_MLX90614).
// Each sensor is a part with `i2c: <kind>` (js/circuit/parts.js); values are read from the part's attributes at every
// measurement (so the inspector sliders act live, and a disconnected sensor stops answering), quantized like the chip.

const hex = (a) => '0x' + a.toString(16).toUpperCase().padStart(2, '0');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// find the part on the current I2C bus; warn once (Vietnamese, like the other libraries) when it is missing
function findSensor(R, kind, addr, label) {
  const p = R.sim.findI2C(kind, addr);
  if (!p) R.warnOnce(kind + addr, `${label} địa chỉ ${hex(addr)} không tìm thấy (kiểm tra dây SDA→GPIO${R.i2c.sda}, SCL→GPIO${R.i2c.scl}, nguồn, GND và địa chỉ I2C).`);
  return p;
}

// ---------------------------------------------------------------- SHT30 / SHT31 (Adafruit_SHT31.h)
export class Adafruit_SHT31 {
  constructor(R) { this.R = R; this.addr = 0x44; this.heat = false; }
  begin(addr) {
    if (addr !== undefined) this.addr = addr;
    return !!findSensor(this.R, 'sht3x', this.addr, 'SHT30/SHT31');
  }
  // single shot, high repeatability: ~15 ms; 16-bit raw values (T = -45 + 175·raw/65535, RH = 100·raw/65535)
  async $read() {
    const p = this.R.sim.findI2C('sht3x', this.addr);
    await this.R.delay(15);
    if (!p) return [NaN, NaN];
    const t = Math.round((Math.max(-45, Math.min(130, num(p.attrs.temperature))) + 45) / 175 * 65535) / 65535 * 175 - 45;
    const h = Math.round(Math.max(0, Math.min(100, num(p.attrs.humidity))) / 100 * 65535) / 65535 * 100;
    return [t + (this.heat ? 3 : 0), h];
  }
  async readTemperature() { return (await this.$read())[0]; }
  async readHumidity() { return (await this.$read())[1]; }
  heater(on) { this.heat = !!on; }
  isHeaterEnabled() { return this.heat; }
  reset() {}
  readStatus() { return this.heat ? 0x2000 : 0; }
}
Adafruit_SHT31.meta = { ret: { begin: 'bool', readTemperature: 'float', readHumidity: 'float', isHeaterEnabled: 'bool', readStatus: 'u16' } };

// ---------------------------------------------------------------- BMP280 (Adafruit_BMP280.h)
export class Adafruit_BMP280 {
  constructor(R) { this.R = R; this.addr = 0x77; this.osrsP = 3; this.found = false; }
  begin(addr, chipid) {
    if (addr !== undefined) this.addr = addr;
    this.found = !!findSensor(this.R, 'bmp280', this.addr, 'BMP280');
    if (this.found && chipid !== undefined && chipid !== 0x58) this.found = false;
    return this.found;
  }
  sensorID() { return this.R.sim.findI2C('bmp280', this.addr) ? 0x58 : 0; }
  setSampling(mode, osT, osP) { if (osP !== undefined) this.osrsP = osP; }
  // 20-bit ADC: temperature 0.01 °C, pressure ~0.16 Pa at x16 (coarser with less oversampling)
  $part() { return this.found ? this.R.sim.findI2C('bmp280', this.addr) : null; }
  readTemperature() {
    const p = this.$part();
    return p ? Math.round(num(p.attrs.temperature) * 100) / 100 : NaN;
  }
  readPressure() {
    const p = this.$part();
    if (!p) return NaN;
    const step = [2.62, 2.62, 1.31, 0.66, 0.33, 0.16][this.osrsP] || 0.16;
    return Math.round(num(p.attrs.pressure) * 100 / step) * step;
  }
  readAltitude(sea = 1013.25) {
    const pa = this.readPressure();
    return 44330 * (1 - Math.pow(pa / 100 / sea, 0.1903));
  }
  seaLevelForAltitude(alt, atm) { return atm / Math.pow(1 - alt / 44330, 5.255); }
  takeForcedMeasurement() { return this.found; }
  getStatus() { return 0; }
  reset() {}
}
Object.assign(Adafruit_BMP280, {
  MODE_SLEEP: 0, MODE_FORCED: 1, MODE_NORMAL: 3, MODE_SOFT_RESET_CODE: 0xB6,
  SAMPLING_NONE: 0, SAMPLING_X1: 1, SAMPLING_X2: 2, SAMPLING_X4: 3, SAMPLING_X8: 4, SAMPLING_X16: 5,
  FILTER_OFF: 0, FILTER_X2: 1, FILTER_X4: 2, FILTER_X8: 3, FILTER_X16: 4,
  STANDBY_MS_1: 0, STANDBY_MS_63: 1, STANDBY_MS_125: 2, STANDBY_MS_250: 3, STANDBY_MS_500: 4,
  STANDBY_MS_1000: 5, STANDBY_MS_2000: 6, STANDBY_MS_4000: 7,
});
Adafruit_BMP280.meta = { ret: { begin: 'bool', sensorID: 'u32', readTemperature: 'float', readPressure: 'float', readAltitude: 'float', seaLevelForAltitude: 'float', takeForcedMeasurement: 'bool', getStatus: 'u8' } };

// ---------------------------------------------------------------- BH1750 (BH1750.h by claws)
export class BH1750 {
  constructor(R, addr) { this.R = R; this.addr = addr || 0x23; this.mode = 0; this.mt = 69; this.last = 0; }
  begin(mode = 0x10, addr = 0) {
    if (addr) this.addr = addr;
    if (!findSensor(this.R, 'bh1750', this.addr, 'BH1750')) return false;
    return this.configure(mode);
  }
  configure(mode) {
    if (![0x10, 0x11, 0x13, 0x20, 0x21, 0x23].includes(mode)) return false;
    this.mode = mode; this.last = this.R.millis();
    return true;
  }
  setMTreg(mt) { if (mt < 31 || mt > 254) return false; this.mt = mt; this.last = this.R.millis(); return true; }
  $convMs() { return ((this.mode & 3) === 3 ? 16 : 120) * this.mt / 69; }
  measurementReady() { return this.R.millis() - this.last >= this.$convMs(); }
  // raw count = lux·1.2·MTreg/69 (x2 for HIGH_RES_MODE_2, /4 resolution for LOW_RES), saturates at 65535
  async readLightLevel() {
    if (!this.mode) return -1;
    const p = this.R.sim.findI2C('bh1750', this.addr);
    if (!p) return -2;
    if ((this.mode & 0x20) && !this.measurementReady()) await this.R.delay(this.$convMs() - (this.R.millis() - this.last));
    const k = 1.2 * this.mt / 69 * ((this.mode & 3) === 1 ? 2 : 1);
    let raw = Math.min(65535, Math.round(Math.max(0, num(p.attrs.lux)) * k));
    if ((this.mode & 3) === 3) raw &= ~3;
    if (this.mode & 0x20) this.last = this.R.millis();
    return raw / k;
  }
}
Object.assign(BH1750, {
  UNCONFIGURED: 0, CONTINUOUS_HIGH_RES_MODE: 0x10, CONTINUOUS_HIGH_RES_MODE_2: 0x11, CONTINUOUS_LOW_RES_MODE: 0x13,
  ONE_TIME_HIGH_RES_MODE: 0x20, ONE_TIME_HIGH_RES_MODE_2: 0x21, ONE_TIME_LOW_RES_MODE: 0x23,
});
BH1750.meta = { ret: { begin: 'bool', configure: 'bool', setMTreg: 'bool', measurementReady: 'bool', readLightLevel: 'float' } };

// ---------------------------------------------------------------- VL53L0X (Adafruit_VL53L0X.h, Pololu VL53L0X.h)
const VL_MAX = 2000; // beyond this (or no target) the result is "out of range": status 4, 8190 mm
async function vlMeasure(R, addr, ms = 33) {
  await R.delay(ms);
  const p = R.sim.findI2C('vl53l0x', addr);
  if (!p) return null;
  const d = Math.round(num(p.attrs.distance));
  return d > VL_MAX || d <= 0 ? { mm: 8190, status: 4 } : { mm: d, status: 0 };
}

export class VL53L0X_RangingMeasurementData_t {
  constructor() { this.TimeStamp = 0; this.MeasurementTimeUsec = 0; this.RangeMilliMeter = 0; this.RangeDMaxMilliMeter = 0; this.SignalRateRtnMegaCps = 0; this.AmbientRateRtnMegaCps = 0; this.EffectiveSpadRtnCount = 0; this.ZoneId = 0; this.RangeFractionalPart = 0; this.RangeStatus = 0; }
}
VL53L0X_RangingMeasurementData_t.meta = { fields: { TimeStamp: 'u32', MeasurementTimeUsec: 'u32', RangeMilliMeter: 'u16', RangeDMaxMilliMeter: 'u16', SignalRateRtnMegaCps: 'u32', AmbientRateRtnMegaCps: 'u32', EffectiveSpadRtnCount: 'u16', ZoneId: 'u8', RangeFractionalPart: 'u8', RangeStatus: 'u8' } };

export class Adafruit_VL53L0X {
  constructor(R) { this.R = R; this.addr = 0x29; this.st = 0; this.cont = 0; this.next = 0; }
  begin(addr = 0x29) {
    // after power-up the chip always answers at 0x29; begin(addr) then moves it to addr
    if (!findSensor(this.R, 'vl53l0x', 0x29, 'VL53L0X')) return false;
    this.addr = addr;
    return true;
  }
  setAddress(a) { this.addr = a; return true; }
  async rangingTest(m) {
    const r = await vlMeasure(this.R, this.addr);
    this.st = r ? r.status : 4;
    if (m) Object.assign(m, { TimeStamp: this.R.millis(), MeasurementTimeUsec: 33000, RangeMilliMeter: r ? r.mm : 8191, RangeDMaxMilliMeter: VL_MAX, RangeStatus: this.st });
    return r ? 0 : -1;
  }
  async readRange() { const r = await vlMeasure(this.R, this.addr); this.st = r ? r.status : 4; return r ? r.mm : 8191; }
  readRangeStatus() { return this.st; }
  startRangeContinuous(period = 50) { this.cont = Math.max(33, period); this.next = this.R.millis() + this.cont; return true; }
  stopRangeContinuous() { this.cont = 0; }
  isRangeComplete() { return !!this.cont && this.R.millis() >= this.next; }
  async waitRangeComplete() { if (this.cont && this.R.millis() < this.next) await this.R.delay(this.next - this.R.millis()); return 0; }
  async readRangeResult() { const r = await vlMeasure(this.R, this.addr, 0); this.st = r ? r.status : 4; this.next = this.R.millis() + this.cont; return r ? r.mm : 8191; }
  setMeasurementTimingBudgetMicroSeconds() { return true; }
  configSensor() { return true; }
}
Object.assign(Adafruit_VL53L0X, { VL53L0X_SENSE_DEFAULT: 0, VL53L0X_SENSE_LONG_RANGE: 1, VL53L0X_SENSE_HIGH_SPEED: 2, VL53L0X_SENSE_HIGH_ACCURACY: 3 });
Adafruit_VL53L0X.meta = { ret: { begin: 'bool', setAddress: 'bool', rangingTest: 'int', readRange: 'u16', readRangeStatus: 'u8', startRangeContinuous: 'bool', isRangeComplete: 'bool', waitRangeComplete: 'int', readRangeResult: 'u16', setMeasurementTimingBudgetMicroSeconds: 'bool', configSensor: 'bool' } };

// Pololu VL53L0X library
export class VL53L0X {
  constructor(R) { this.R = R; this.addr = 0x29; this.to = 0; this.tmo = false; this.cont = 0; this.next = 0; }
  init() { return !!findSensor(this.R, 'vl53l0x', 0x29, 'VL53L0X'); }
  setAddress(a) { this.addr = a; }
  getAddress() { return this.addr; }
  setTimeout(ms) { this.to = ms; }
  getTimeout() { return this.to; }
  timeoutOccurred() { const t = this.tmo; this.tmo = false; return t; }
  setSignalRateLimit() { return true; }
  setMeasurementTimingBudget() { return true; }
  setVcselPulsePeriod() { return true; }
  startContinuous(period = 0) { this.cont = Math.max(33, period); this.next = this.R.millis() + this.cont; }
  stopContinuous() { this.cont = 0; }
  async $range(wait) {
    const r = await vlMeasure(this.R, this.addr, wait);
    if (!r) { if (this.to) await this.R.delay(this.to); this.tmo = true; return 65535; }
    return r.mm;
  }
  async readRangeContinuousMillimeters() {
    const w = this.cont ? Math.max(0, this.next - this.R.millis()) : 33;
    const v = await this.$range(w);
    this.next = this.R.millis() + (this.cont || 33);
    return v;
  }
  async readRangeSingleMillimeters() { return this.$range(33); }
}
VL53L0X.meta = { ret: { init: 'bool', getAddress: 'u8', getTimeout: 'u16', timeoutOccurred: 'bool', setSignalRateLimit: 'bool', setMeasurementTimingBudget: 'bool', setVcselPulsePeriod: 'bool', readRangeContinuousMillimeters: 'u16', readRangeSingleMillimeters: 'u16' } };

// ---------------------------------------------------------------- MAX30100 (MAX30100_PulseOximeter.h, MAX30100lib)
// The library samples the photodiode at 100 Hz inside update(): the sketch must call update() continuously (no long
// delay()). The detector needs a couple of beats before getHeartRate() is meaningful and a few more for SpO2. With the
// default IR LED current (50 mA) the IR channel of most GY-MAX30100 modules saturates and no beat is found:
// setIRLedCurrent(MAX30100_LED_CURR_7_6MA) is the usual fix — the simulation reproduces that.
export const MAX30100_CONSTS = Object.fromEntries([0, 4.4, 7.6, 11, 14.2, 17.4, 20.8, 24, 27.1, 30.6, 33.8, 37, 40.2, 43.6, 46.8, 50]
  .map((ma, i) => ['MAX30100_LED_CURR_' + String(ma).replace('.', '_') + 'MA', [i, 'int']]));
const LED_MA = [0, 4.4, 7.6, 11, 14.2, 17.4, 20.8, 24, 27.1, 30.6, 33.8, 37, 40.2, 43.6, 46.8, 50];

export class PulseOximeter {
  constructor(R) { this.R = R; this.ir = 15; this.on = false; this.cb = null; this.$reset(); this.lastUpd = 0; }
  $reset() { this.hr = 0; this.spo2 = 0; this.beats = 0; this.next = 0; this.lastBeat = 0; this.ivs = []; }
  begin() {
    this.on = !!findSensor(this.R, 'max30100', 0x57, 'MAX30100');
    this.ir = 15; this.$reset(); this.lastUpd = this.R.millis();
    return this.on;
  }
  setIRLedCurrent(c) { this.ir = Math.max(0, Math.min(15, c | 0)); }
  setOnBeatDetectedCallback(fn) { this.cb = fn; }
  shutdown() { this.on = false; this.$reset(); }
  resume() { this.on = true; this.lastUpd = this.R.millis(); }
  getHeartRate() { return this.hr; }
  getSpO2() { return this.spo2; }
  getRedLedCurrentBias() { return 8; }
  async update() {
    const R = this.R, now = R.millis();
    const gap = now - this.lastUpd;
    this.lastUpd = now;
    if (!this.on) return;
    const p = R.sim.findI2C('max30100', 0x57);
    const finger = p && String(p.attrs.finger) !== 'Không';
    if (!finger || this.ir === 0) { this.$reset(); return; }
    if (LED_MA[this.ir] > 24) {
      R.warnOnce('max30100sat', `MAX30100: dòng LED IR ${LED_MA[this.ir]} mA làm tín hiệu IR bão hòa, không phát hiện được nhịp tim — gọi pox.setIRLedCurrent(MAX30100_LED_CURR_7_6MA) sau pox.begin().`);
      this.$reset(); return;
    }
    if (gap > 250) {
      R.warnOnce('max30100gap', 'MAX30100: pox.update() phải được gọi liên tục (lấy mẫu 100 Hz) — tránh delay() dài trong loop(), dùng millis() để định kỳ in kết quả.');
      this.$reset();
    }
    if (!this.next) { this.next = now + 1200; return; } // detector warm-up: DC removal / threshold settling
    if (now < this.next) return;
    const bpm = Math.max(30, Math.min(220, num(p.attrs.bpm, 75)));
    // small beat-to-beat variability (deterministic) like a real pulse
    const iv = 60000 / bpm * (1 + 0.02 * Math.sin(this.beats * 2.3));
    if (this.lastBeat) { this.ivs.push(now - this.lastBeat); if (this.ivs.length > 5) this.ivs.shift(); }
    this.lastBeat = now;
    this.beats++;
    if (this.ivs.length) this.hr = 60000 / (this.ivs.reduce((a, b) => a + b, 0) / this.ivs.length);
    if (this.beats >= 4) this.spo2 = Math.round(Math.max(0, Math.min(100, num(p.attrs.spo2, 97)) - (this.beats % 3 === 0 ? 1 : 0)));
    this.next = now + iv;
    if (this.cb) await this.cb();
  }
}
PulseOximeter.meta = { ret: { begin: 'bool', getHeartRate: 'float', getSpO2: 'u8', getRedLedCurrentBias: 'u8' } };

// ---------------------------------------------------------------- MLX90614 (Adafruit_MLX90614.h)
export class Adafruit_MLX90614 {
  constructor(R, addr) { this.R = R; this.addr = addr || 0x5A; this.emis = 1; }
  begin(addr) {
    if (addr !== undefined) this.addr = addr;
    return !!findSensor(this.R, 'mlx90614', this.addr, 'MLX90614');
  }
  // RAM registers in 0.02 K steps; an emissivity < 1 set in the sensor scales the object reading (radiated power ∝ ε·T⁴)
  $t(key) {
    const p = this.R.sim.findI2C('mlx90614', this.addr);
    if (!p) return NaN;
    let k = num(p.attrs[key]) + 273.15;
    if (key === 'object' && this.emis !== 1) {
      const ka = num(p.attrs.ambient) + 273.15;
      k = Math.pow(ka ** 4 + (k ** 4 - ka ** 4) / this.emis, 0.25);
    }
    return Math.round(k / 0.02) * 0.02 - 273.15;
  }
  readObjectTempC() { return this.$t('object'); }
  readAmbientTempC() { return this.$t('ambient'); }
  readObjectTempF() { return this.$t('object') * 1.8 + 32; }
  readAmbientTempF() { return this.$t('ambient') * 1.8 + 32; }
  readEmissivity() { return this.emis; }
  writeEmissivity(e) { this.emis = Math.max(0.1, Math.min(1, Number(e))); }
  readEmissivityReg() { return Math.round(this.emis * 65535); }
  writeEmissivityReg(r) { this.emis = Math.max(0.1, r / 65535); }
}
Adafruit_MLX90614.meta = { ret: { begin: 'bool', readObjectTempC: 'double', readAmbientTempC: 'double', readObjectTempF: 'double', readAmbientTempF: 'double', readEmissivity: 'double', readEmissivityReg: 'u16' } };

export const I2C_SENSOR_LIBS = {
  Adafruit_SHT31, Adafruit_BMP280, BH1750, Adafruit_VL53L0X, VL53L0X, VL53L0X_RangingMeasurementData_t, PulseOximeter, Adafruit_MLX90614,
};
export const I2C_SENSOR_HEADERS = ['Adafruit_SHT31.h', 'Adafruit_BMP280.h', 'BH1750.h', 'Adafruit_VL53L0X.h', 'VL53L0X.h',
  'MAX30100_PulseOximeter.h', 'Adafruit_MLX90614.h'];
