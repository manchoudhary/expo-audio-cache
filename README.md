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

**Peers:** `expo-file-system` (required). `expo-audio` is the intended consumer but not a hard dependency.

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

## API

| Method | Description |
| --- | --- |
| `configureAudioCache({ directoryName?, maxBytes?, headers? })` | Optional setup (defaults applied on first use) |
| `download(id, url, options?)` | Download into documentDirectory; resumes metadata on success |
| `pause(id)` / `resume(id)` | Pause / resume a resumable download (survives app kill) |
| `cancel(id)` / `remove(id)` / `clear()` | Abort or delete cached files |
| `getLocalUri(id)` | Local URI if status is `ready`, else `null` |
| `getEntry(id)` / `list()` / `getStats()` | Inspect cache index |
| `resolveSource(id, remoteUrl)` | Prefer local URI when ready, else remote |
| `useAudioCacheDownload(id)` | `{ status, progress, localUri, error }` |

Statuses: `idle` · `downloading` · `paused` · `ready` · `error`.

Default `maxBytes` is **500MB**. After each successful download, least-recently-used **ready** entries are deleted until under budget. In-flight downloads are never evicted.

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

Downloads use `expo-file-system` resumable APIs (`expo-file-system/legacy` on SDK 54+, package root on older SDKs).

## License

MIT
