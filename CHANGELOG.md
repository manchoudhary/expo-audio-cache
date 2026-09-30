# Changelog

## 0.1.1

- Reconcile index with disk on startup (reset stuck downloading/paused without partial files)
- Fall back to non-resumable download when the server rejects range/resume or advertises `Accept-Ranges: none`
- Document Authorization / JWT headers in README

## 0.1.0

- Initial release: persistent documentDirectory cache for audio downloads
- Resumable downloads via expo-file-system (legacy-aware loader)
- LRU eviction by `maxBytes`
- `resolveSource` + `useAudioCacheDownload` for expo-audio
- Example Expo app
