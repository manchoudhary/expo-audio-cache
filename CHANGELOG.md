# Changelog

## 1.0.1

- Harden concurrent downloads (coalesce same-id calls; serialize mutations)
- Atomic `index.json` writes via temp file + move; recover `.tmp` on boot
- Reject unsafe cache IDs / directory names; invalidate same-id when URL changes
- Never persist Authorization/cookies in resume metadata; validate HTTP 200/206 and non-empty files
- Refresh filesystem sizes for accurate LRU/stats; tighten `expo-file-system` peer to `>=18.0.0`
- Hook cleanup resets state on id change; `prepublishOnly` runs tests + build

## 1.0.0

- First stable release metadata for npm (`author`, `repository`, Expo-focused keywords)
- Includes reconcile-on-startup, range-download fallback, and auth header docs from 0.1.1

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
