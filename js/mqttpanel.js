// Built-in MQTT client (like MQTTX) to talk to the simulated ESP32 through a public broker.
export class MqttPanel {
  constructor(el) {
    this.el = el;
    this.client = null;
    this.subs = new Set();
    const brokers = el.brokers();
    for (const [host, url] of Object.entries(brokers)) {
      const o = document.createElement('option');
      o.value = url;
      o.textContent = host;
      el.brokerSelect.append(o);
    }
    const custom = document.createElement('option');
    custom.value = '';
    custom.textContent = 'Tùy chỉnh…';
    el.brokerSelect.append(custom);
    el.url.value = el.brokerSelect.value;
    el.brokerSelect.onchange = () => { if (el.brokerSelect.value) el.url.value = el.brokerSelect.value; };
    el.connect.onclick = () => (this.client ? this.disconnect() : this.connect());
    el.sub.onclick = () => this.subscribe(el.subTopic.value.trim());
    el.subTopic.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.subscribe(el.subTopic.value.trim()); });
    el.pub.onclick = () => this.publish();
    el.pubMsg.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.publish(); });
  }

  setState(text, on) {
    this.el.state.textContent = '● ' + text;
    this.el.state.classList.toggle('on', !!on);
    this.el.connect.textContent = this.client ? 'Ngắt' : 'Kết nối';
  }

  log(cls, text) {
    const d = document.createElement('div');
    d.className = 'log-line ' + cls;
    const t = new Date().toLocaleTimeString();
    d.innerHTML = `<span class="t">${t}</span>`;
    d.append(document.createTextNode(text));
    this.el.log.append(d);
    while (this.el.log.childNodes.length > 1000) this.el.log.removeChild(this.el.log.firstChild);
    if (this.el.autoscroll.checked) this.el.log.scrollTop = this.el.log.scrollHeight;
  }

  connect() {
    if (!window.mqtt) { this.log('err', 'mqtt.js chưa được nạp'); return; }
    const url = this.el.url.value.trim();
    if (!url) return;
    const id = 'esp32sim-panel-' + Math.random().toString(16).slice(2, 8);
    this.setState('Đang kết nối…');
    const c = window.mqtt.connect(url, { clientId: id, reconnectPeriod: 0, connectTimeout: 10000, clean: true });
    this.client = c;
    this.el.connect.textContent = 'Ngắt';
    c.on('connect', () => {
      this.setState('Đã kết nối ' + url.replace(/^wss?:\/\//, ''), true);
      this.log('', `Kết nối thành công (clientId=${id})`);
      for (const t of this.subs) c.subscribe(t);
    });
    c.on('message', (topic, payload, packet) => {
      this.log('in', `↓ ${topic}${packet.retain ? ' [retained]' : ''}: ${new TextDecoder().decode(payload)}`);
    });
    c.on('error', (e) => this.log('err', 'Lỗi: ' + e.message));
    c.on('close', () => {
      if (this.client === c) { this.client = null; this.setState('Chưa kết nối'); }
    });
  }

  disconnect() {
    if (this.client) { const c = this.client; this.client = null; c.end(true); }
    this.setState('Chưa kết nối');
    this.log('', 'Đã ngắt kết nối');
  }

  subscribe(topic) {
    if (!topic || this.subs.has(topic)) return;
    this.subs.add(topic);
    if (this.client && this.client.connected) this.client.subscribe(topic);
    this.renderSubs();
    this.log('', 'Subscribe ' + topic);
  }

  renderSubs() {
    this.el.subs.innerHTML = '';
    for (const t of this.subs) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.title = 'Bấm để hủy subscribe';
      chip.textContent = t + ' ✕';
      chip.onclick = () => {
        this.subs.delete(t);
        if (this.client && this.client.connected) this.client.unsubscribe(t);
        this.renderSubs();
      };
      this.el.subs.append(chip);
    }
  }

  publish() {
    const topic = this.el.pubTopic.value.trim();
    const msg = this.el.pubMsg.value;
    if (!this.client || !this.client.connected) { this.log('err', 'Chưa kết nối broker'); return; }
    if (!topic) return;
    this.client.publish(topic, msg, { retain: this.el.retain.checked });
    this.log('out', `↑ ${topic}: ${msg}`);
  }

  clear() { this.el.log.innerHTML = ''; }
}
