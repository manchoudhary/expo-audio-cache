# Changelog

## 1.0.0

- Persistent `documentDirectory` cache for expo-audio with resumable downloads and LRU eviction
- Reconcile index with disk on startup; range-download fallback when servers reject resume
- Auth / JWT headers via `configureAudioCache` (never persisted to disk)
- Harden concurrent downloads, atomic `index.json` writes, safe cache IDs
- Fail fast when offline: connectivity probe + `downloadTimeoutMs` (default 30s) so status becomes `error` instead of hanging
- `clear()` cancels in-flight downloads; peer `expo-file-system` `>=18.0.0`
