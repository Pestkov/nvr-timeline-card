class NvrTimelineCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._offsetMs = 0;
    this._periodHours = 2;
    this._history = {};
    this._loading = false;
  }

  setConfig(config) {
    if (!config.entities || !config.entities.length) throw new Error('entities required');
    this._config = Object.assign({
      row_height: 9,
      min_segment_width: 12,
      output_entity: null,
      live_url_template: '',
      archive_url_template: '',
      ha_url: '',
      ha_token: '',
    }, config);
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._render();
      this._rendered = true;
    }
  }

  static getConfigElement() { return document.createElement('div'); }
  static getStubConfig() {
    return { entities: [{ entity: 'input_boolean.example', label: 'Канал 1', color: '#2196F3', track: 101, tap_action: true }] };
  }

  getCardSize() { return this._config.entities ? this._config.entities.length + 2 : 3; }

  _fmt(d) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  _fmtFull(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
      + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  _toRtspTime(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}Z`;
  }

  _buildUrl(template, track, start, end) {
    return template
      .replace('{track}', track)
      .replace('{start}', this._toRtspTime(start))
      .replace('{end}', this._toRtspTime(end));
  }

  async _loadHistory(from, to) {
    const cfg = this._config;
    const haUrl = (cfg.ha_url || '').replace(/\/$/, '');
    const token = cfg.ha_token || (this._hass && this._hass.auth && this._hass.auth.data && this._hass.auth.data.access_token) || '';
    const ids = cfg.entities.map(e => e.entity).join(',');
    const url = `${haUrl}/api/history/period/${from.toISOString()}?filter_entity_id=${ids}&end_time=${to.toISOString()}&minimal_response=true&no_attributes=true`;
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) return null;
      return await resp.json();
    } catch(e) { return null; }
  }

  _buildSegments(states, from, to) {
    if (!states || !states.length) return [];
    const segs = [];
    let onTime = null;
    for (const s of states) {
      const t = new Date(s.last_changed || (s.lu * 1000));
      if (s.state === 'on') {
        onTime = t < from ? from : t;
      } else if ((s.state === 'off') && onTime) {
        segs.push({ start: onTime, end: t });
        onTime = null;
      }
    }
    if (onTime) segs.push({ start: onTime, end: to });
    return segs;
  }

  _buildAvailability(states, from, to) {
    if (!states || !states.length) return [];
    const segs = [];
    let avTime = null;
    for (const s of states) {
      const t = new Date(s.last_changed || (s.lu * 1000));
      const avail = s.state !== 'unavailable' && s.state !== 'unknown';
      if (avail && !avTime) avTime = t < from ? from : t;
      else if (!avail && avTime) { segs.push({ start: avTime, end: t }); avTime = null; }
    }
    if (avTime) segs.push({ start: avTime, end: to });
    return segs;
  }

  async _refresh() {
    if (this._loading) return;
    this._loading = true;
    const toMs = Date.now() + this._offsetMs;
    const fromMs = toMs - this._periodHours * 3600000;
    const from = new Date(fromMs);
    const to = new Date(toMs);
    const data = await this._loadHistory(from, to);
    if (data) {
      const cfg = this._config;
      this._history = {};
      cfg.entities.forEach((ent, i) => {
        this._history[ent.entity] = data[i] || [];
      });
    }
    this._loading = false;
    this._renderChart();
  }

  _writeOutput(url) {
    if (!this._config.output_entity || !this._hass) return;
    this._hass.callService('input_text', 'set_value', {
      entity_id: this._config.output_entity,
      value: url,
    });
  }

  _render() {
    const s = this.shadowRoot;
    s.innerHTML = `
<style>
  :host { display: block; background: #1a1a1a; border-radius: 8px; padding: 10px 12px; font-family: sans-serif; }
  .controls { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 11px; color: #666; }
  .btn { background: none; border: none; color: #888; cursor: pointer; padding: 2px 4px; font-size: 11px; }
  .btn:hover { color: #ccc; }
  .period-btn { cursor: pointer; padding: 1px 5px; border-radius: 3px; }
  .period-btn:hover { color: #fff; }
  .period-btn.active { color: #2196F3; }
  .range-label { flex: 1; text-align: right; font-size: 11px; color: #555; }
  .row { display: flex; align-items: center; margin-bottom: 5px; }
  .row-label { width: 44px; font-size: 11px; color: #666; text-align: right; padding-right: 8px; flex-shrink: 0; }
  .track { flex: 1; position: relative; border-radius: 3px; overflow: hidden; background: #2a2a2a; }
  .avail { position: absolute; top: 0; bottom: 0; background: #333; border-radius: 2px; }
  .seg { position: absolute; top: 2px; bottom: 2px; border-radius: 2px; cursor: pointer; transition: opacity 0.1s; }
  .seg:hover { opacity: 0.7; }
  .axis { display: flex; margin-left: 44px; justify-content: space-between; margin-top: 2px; }
  .axis span { font-size: 10px; color: #444; }
  .status { font-size: 10px; color: #444; text-align: right; margin-top: 4px; }
</style>
<div class="controls">
  <button class="btn" id="prev">‹</button>
  <button class="btn" id="next">›</button>
  ${[1,2,4,6,12,24].map(h => `<span class="period-btn${h===2?' active':''}" data-h="${h}">${h}</span>`).join(' ')}
  <span class="range-label" id="range_label"></span>
  <button class="btn" id="refresh" title="Обновить">↻</button>
</div>
<div id="chart"></div>
<div class="axis" id="axis"></div>
<div class="status" id="status"></div>
`;

    s.getElementById('prev').addEventListener('click', () => {
      this._offsetMs -= this._periodHours * 3600000;
      this._refresh();
    });
    s.getElementById('next').addEventListener('click', () => {
      if (this._offsetMs < 0) {
        this._offsetMs = Math.min(this._offsetMs + this._periodHours * 3600000, 0);
        this._refresh();
      }
    });
    s.getElementById('refresh').addEventListener('click', () => this._refresh());
    s.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._periodHours = parseInt(btn.dataset.h);
        s.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._refresh();
      });
    });

    this._refresh();
  }

  _renderChart() {
    const cfg = this._config;
    const s = this.shadowRoot;
    const chart = s.getElementById('chart');
    const axis = s.getElementById('axis');
    const status = s.getElementById('status');
    const rangeLabel = s.getElementById('range_label');
    const h = cfg.row_height || 9;
    const minW = cfg.min_segment_width || 12;

    const toMs = Date.now() + this._offsetMs;
    const fromMs = toMs - this._periodHours * 3600000;
    const from = new Date(fromMs);
    const to = new Date(toMs);
    const totalMs = toMs - fromMs;

    rangeLabel.textContent = `${this._fmtFull(from)} — ${this._fmtFull(to)}`;
    status.textContent = this._loading ? 'Загрузка...' : '';

    chart.innerHTML = '';

    cfg.entities.forEach(ent => {
      const states = this._history[ent.entity] || [];
      const segs = this._buildSegments(states, from, to);
      const avail = this._buildAvailability(states, from, to);

      const row = document.createElement('div');
      row.className = 'row';

      const label = document.createElement('div');
      label.className = 'row-label';
      label.textContent = ent.label || ent.entity.split('.')[1];
      row.appendChild(label);

      const track = document.createElement('div');
      track.className = 'track';
      track.style.height = `${h + 4}px`;

      avail.forEach(av => {
        const left = Math.max((av.start - from) / totalMs * 100, 0);
        const width = Math.min((av.end - av.start) / totalMs * 100, 100 - left);
        const el = document.createElement('div');
        el.className = 'avail';
        el.style.cssText = `left:${left}%; width:${width}%;`;
        track.appendChild(el);
      });

      segs.forEach(seg => {
        const leftPx = (seg.start - from) / totalMs;
        const widthPx = (seg.end - seg.start) / totalMs;
        const trackW = track.getBoundingClientRect().width || 300;
        const leftPct = leftPx * 100;
        const widthPct = Math.max(widthPx * 100, minW / trackW * 100);

        const el = document.createElement('div');
        el.className = 'seg';
        el.style.cssText = `left:${leftPct}%; width:${widthPct}%; background:${ent.color || '#2196F3'}; top:2px; bottom:2px;`;

        let tapTimer = null;
        el.addEventListener('click', () => {
          if (!ent.tap_action) return;
          if (tapTimer) {
            clearTimeout(tapTimer);
            tapTimer = null;
            const liveUrl = this._buildUrl(cfg.live_url_template, ent.track, seg.start, seg.end);
            this._writeOutput(liveUrl);
            status.textContent = `Live: ${ent.label || ent.entity}`;
          } else {
            tapTimer = setTimeout(() => {
              tapTimer = null;
              const archiveUrl = this._buildUrl(cfg.archive_url_template, ent.track, seg.start, seg.end);
              this._writeOutput(archiveUrl);
              status.textContent = `Архив: ${this._fmtFull(seg.start)} → ${this._fmtFull(seg.end)}`;
            }, 300);
          }
        });

        track.appendChild(el);
      });

      row.appendChild(track);
      chart.appendChild(row);
    });

    axis.innerHTML = '';
    const steps = this._periodHours <= 2 ? 6 : this._periodHours <= 6 ? 8 : 8;
    for (let i = 0; i <= steps; i++) {
      const t = new Date(fromMs + (totalMs / steps) * i);
      const span = document.createElement('span');
      span.textContent = this._fmt(t);
      axis.appendChild(span);
    }
  }
}

customElements.define('nvr-timeline-card', NvrTimelineCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'nvr-timeline-card',
  name: 'NVR Timeline Card',
  description: 'Interactive timeline for NVR cameras',
});
