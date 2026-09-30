import { useAudioPlayer } from 'expo-audio';
import {
  configureAudioCache,
  download,
  getStats,
  useAudioCacheDownload,
} from 'expo-audio-cache';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const TRACK_ID = 'demo-sample';
const TRACK_URL =
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';

configureAudioCache({
  directoryName: 'expo-audio-cache-example',
  maxBytes: 200 * 1024 * 1024,
});

export default function App() {
  const { status, progress, localUri, error } = useAudioCacheDownload(TRACK_ID);
  const [statsText, setStatsText] = useState('—');
  const [busy, setBusy] = useState(false);

  const source = useMemo(
    () => (localUri ? { uri: localUri } : null),
    [localUri]
  );
  const player = useAudioPlayer(source);

  useEffect(() => {
    void refreshStats();
  }, [status, localUri]);

  async function refreshStats() {
    const stats = await getStats();
    setStatsText(
      `${stats.count} file(s), ${(stats.totalBytes / (1024 * 1024)).toFixed(2)} MB`
    );
  }

  async function onDownload() {
    setBusy(true);
    try {
      await download(TRACK_ID, TRACK_URL);
      await refreshStats();
    } catch (e) {
      console.warn(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>expo-audio-cache</Text>
      <Text style={styles.subtitle}>
        Persistent download for expo-audio (not tmp / downloadFirst)
      </Text>

      <View style={styles.card}>
        <Text>Status: {status}</Text>
        <Text>Progress: {(progress * 100).toFixed(0)}%</Text>
        <Text numberOfLines={2}>Local URI: {localUri ?? '—'}</Text>
        <Text>Cache: {statsText}</Text>
        {error ? <Text style={styles.error}>{error.message}</Text> : null}
      </View>

      {busy || status === 'downloading' ? (
        <ActivityIndicator style={styles.spinner} />
      ) : null}

      <View style={styles.row}>
        <Button
          title="Download"
          onPress={onDownload}
          disabled={busy || status === 'downloading' || status === 'ready'}
        />
        <Button
          title={player.playing ? 'Pause' : 'Play'}
          onPress={() => {
            if (!localUri) {
              return;
            }
            if (player.playing) {
              player.pause();
            } else {
              player.play();
            }
          }}
          disabled={!localUri}
        />
      </View>

      <Text style={styles.hint}>
        After Ready, enable airplane mode and press Play to confirm offline
        playback from documentDirectory.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 24,
    gap: 16,
  },
  title: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '700',
    marginTop: 24,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  error: {
    color: '#f87171',
  },
  spinner: {
    marginVertical: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    gap: 12,
  },
  hint: {
    color: '#64748b',
    fontSize: 13,
    lineHeight: 18,
  },
});
