# NVR Timeline Card

Custom Lovelace card для Home Assistant — интерактивный таймлайн событий NVR камер с воспроизведением архива через RTSP.

## Установка

1. Скачай `nvr-timeline-card.js`
2. Положи в `/config/www/`
3. В HA: Settings → Dashboards → Resources → Add resource
   - URL: `/local/nvr-timeline-card.js`
   - Type: JavaScript module

## Конфигурация

```yaml
type: custom:nvr-timeline-card
ha_url: http://192.168.2.50:8123
ha_token: YOUR_LONG_LIVED_TOKEN
output_entity: input_text.nvr_playback_url
live_url_template: "rtsp://admin:pass@192.168.2.230:554/Streaming/channels/{track}"
archive_url_template: "rtsp://admin:pass@192.168.2.230:554/Streaming/tracks/{track}?starttime={start}&endtime={end}"
row_height: 9
min_segment_width: 12
entities:
  - entity: input_boolean.nvr_channel_1_recording
    label: Улица
    color: "#2196F3"
    track: 101
    tap_action: true
    time_offset: 0
```

## Использование

- Одиночный тап на сегмент → архивный RTSP URL записывается в `output_entity`
- Двойной тап → живой RTSP URL
- Кнопки 1 2 4 6 12 24 → масштаб в часах
- Стрелки ‹ › → листать назад/вперёд
