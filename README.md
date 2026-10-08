# expo-audio-cache

Persistent offline download and cache layer for [`expo-audio`](https://docs.expo.dev/versions/latest/sdk/audio/).

`expo-audio`'s `downloadFirst` option downloads into the device **tmp** directory, and Expo documents that the OS can purge that file. This package stores audio under the app **document directory**, keeps a small JSON index, supports **resumable** downloads across app restarts, and returns a local `file://` URI you can pass straight to `useAudioPlayer` / playlists.

It is **not** a music player, Track Player replacement, or generic offline sync framework. Apps often reinvent this with `expo-file-system`; this package is that focused reusable layer.

## Install

```sh
npx expo install expo-file-system expo-audio
npm install expo-audio-cache
# or
yarn add expo-audio-cache
```

**Peers:** `expo-file-system` `>=18.0.0` (required). `expo-audio` is the intended consumer but not a hard dependency.

**Platforms:** iOS and Android. Web is not supported (`documentDirectory` is required).

## Quick start

```tsx
import { useAudioPlayer } from 'expo-audio';
import {
  configureAudioCache,
  download,
  resolveSource,
  useAudioCacheDownload,
} from 'expo-audio-cache';

configureAudioCache({ maxBytes: 500 * 1024 * 1024 });

const id = 'episode-42';
const url = 'https://example.com/episode.mp3';

export function Episode() {
  const { status, progress, localUri } = useAudioCacheDownload(id);
  const player = useAudioPlayer(localUri ? { uri: localUri } : null);

  return (
    <>
      <Button title="Download" onPress={() => download(id, url)} />
      <Text>{status} {(progress * 100).toFixed(0)}%</Text>
      <Button title="Play" onPress={() => player.play()} disabled={!localUri} />
    </>
  );
}

// Or resolve at play time:
const source = await resolveSource(id, url); // { uri: local or remote }
```

## Authenticated / private audio (JWT headers)

Many production apps fetch private audio behind auth. Pass default headers once via `configureAudioCache`, and optionally override per download:

```tsx
configureAudioCache({
  maxBytes: 500 * 1024 * 1024,
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});

// Uses the configured Authorization header
await download('episode-42', 'https://api.example.com/audio/42.mp3');

// Or override / add headers for a single request
await download('episode-42', 'https://api.example.com/audio/42.mp3', {
  headers: {
    Authorization: `Bearer ${freshToken}`,
    'X-Tenant-Id': tenantId,
  },
});
```

Refresh tokens by calling `configureAudioCache({ headers: { Authorization: ... } })` again when the JWT rotates (safe to call more than once).

Authorization headers are used for the network request only — they are **never** written to `index.json` or resume snapshots.

## API

| Method | Description |
| --- | --- |
| `configureAudioCache({ directoryName?, maxBytes?, headers?, downloadTimeoutMs? })` | Optional setup (defaults applied on first use) |
| `download(id, url, options?)` | Download into documentDirectory; resumes metadata on success |
| `pause(id)` / `resume(id)` | Pause / resume a resumable download (survives app kill) |
| `cancel(id)` / `remove(id)` / `clear()` | Abort or delete cached files |
| `getLocalUri(id)` | Local URI if status is `ready`, else `null` |
| `getEntry(id)` / `list()` / `getStats()` | Inspect cache index |
| `resolveSource(id, remoteUrl)` | Prefer local URI when ready, else remote |
| `useAudioCacheDownload(id)` | `{ status, progress, localUri, error }` |

Statuses: `idle` · `downloading` · `paused` · `ready` · `error`.

Default `maxBytes` is **500MB**. After each successful download, least-recently-used **ready** entries are deleted until under budget. In-flight downloads are never evicted.

Default `downloadTimeoutMs` is **30 seconds**. Offline devices often leave `expo-file-system` hung forever; the library fails a short connectivity probe first and otherwise times out so status becomes `error` instead of stuck `downloading`.

On startup the cache **reconciles** `index.json` with files on disk: missing ready files are dropped, and stuck `downloading` / `paused` entries without a partial file (or resume snapshot) are reset so IDs never stay in limbo after a crash. If a server rejects HTTP range / resume (or advertises `Accept-Ranges: none`), the library falls back to a fresh non-resumable download.

## Example app

```sh
cd example
npm install
npx expo start
```

Download the sample track, then enable airplane mode and press Play to confirm offline playback.

## How it stores data

```
documentDirectory/expo-audio-cache/
  index.json          # entries + savable() resume snapshots
  files/<id>.mp3      # audio bytes
```

Downloads use `expo-file-system` resumable APIs (`expo-file-system/legacy` on SDK 54+, package root on older SDKs), with a simple `downloadAsync` fallback when ranges are unsupported.

## License

MIT
