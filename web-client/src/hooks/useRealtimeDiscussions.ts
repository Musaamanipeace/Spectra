import { useCallback, useEffect, useRef, useState } from 'react';

interface IdentifiedThread {
  id: string;
}

interface ForumEvent<TThread> {
  thread?: TThread;
}

function normalizeThread<TThread extends IdentifiedThread>(value: unknown): TThread | null {
  if (typeof value !== 'object' || value === null) return null;

  const thread = value as Record<string, unknown>;
  const id = thread.id ?? thread.thread_id;
  if (id === undefined || id === null) return null;

  return { ...thread, id: String(id) } as TThread;
}

export function useRealtimeDiscussions<TThread extends IdentifiedThread>(
  initialThreads: TThread[],
  channel = 'all'
) {
  const [threads, setThreads] = useState<TThread[]>(initialThreads);
  const [sseConnected, setSseConnected] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'stale' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const loadedOnce = useRef(initialThreads.length > 0);
  const nextOffset = useRef(0);
  const loadedChannel = useRef(channel);

  const refreshThreads = useCallback(async () => {
    const sameChannel = loadedChannel.current === channel;
    if (!sameChannel) {
      loadedChannel.current = channel;
      nextOffset.current = 0;
      loadedOnce.current = false;
      setThreads([]);
      setHasMore(false);
    }
    if (!loadedOnce.current) setLoadState('loading');
    try {
      const response = await fetch(`/api/forum/threads?channel=${encodeURIComponent(channel)}&limit=100&offset=0`);
      if (!response.ok) throw new Error(`Forum request failed (${response.status})`);
      const payload: unknown = await response.json();
      if (loadedChannel.current !== channel) return;
      const rows = Array.isArray(payload)
        ? payload
        : typeof payload === 'object' && payload !== null && 'threads' in payload
          ? (payload as { threads: unknown }).threads
          : [];
      if (!Array.isArray(rows)) throw new Error('Forum returned an invalid case list');

      const normalized = rows
        .map((row) => normalizeThread<TThread>(row))
        .filter((row): row is TThread => row !== null);
      setThreads((current) => {
        if (!sameChannel || !loadedOnce.current) return normalized;
        const firstPageIds = new Set(normalized.map((thread) => thread.id));
        const loadedOlderPages = current.filter((thread) => !firstPageIds.has(thread.id));
        return [...normalized, ...loadedOlderPages];
      });
      nextOffset.current = Math.max(nextOffset.current, rows.length);
      setHasMore(rows.length === 100);
      loadedOnce.current = true;
      setLoadState('ready');
      setLoadError(null);
      setLoadMoreError(null);
    } catch (error) {
      if (loadedChannel.current !== channel) return;
      setLoadState(loadedOnce.current ? 'stale' : 'error');
      setLoadError(error instanceof Error ? error.message : 'Could not load cases');
    }
  }, [channel]);

  const loadMoreThreads = useCallback(async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await fetch(`/api/forum/threads?channel=${encodeURIComponent(channel)}&limit=100&offset=${nextOffset.current}`);
      if (!response.ok) throw new Error(`Forum request failed (${response.status})`);
      const payload: unknown = await response.json();
      if (loadedChannel.current !== channel) return;
      const rows = Array.isArray(payload)
        ? payload
        : typeof payload === 'object' && payload !== null && 'threads' in payload
          ? (payload as { threads: unknown }).threads
          : [];
      if (!Array.isArray(rows)) throw new Error('Forum returned an invalid case list');
      const normalized = rows
        .map((row) => normalizeThread<TThread>(row))
        .filter((row): row is TThread => row !== null);
      setThreads((current) => {
        const known = new Set(current.map((thread) => thread.id));
        return [...current, ...normalized.filter((thread) => !known.has(thread.id))];
      });
      nextOffset.current += rows.length;
      setHasMore(rows.length === 100);
      setLoadMoreError(null);
    } catch (error) {
      if (loadedChannel.current !== channel) return;
      setLoadMoreError(error instanceof Error ? error.message : 'Could not load more cases');
    } finally {
      setLoadingMore(false);
    }
  }, [channel, hasMore, loadingMore]);

  useEffect(() => {
    let active = true;
    let openedOnce = false;
    const upsertThread = (thread: TThread) => {
      setThreads((current) => {
        const exists = current.some((item) => item.id === thread.id);
        return exists
          ? current.map((item) => (item.id === thread.id ? thread : item))
          : [thread, ...current];
      });
    };

    void refreshThreads();

    if (typeof EventSource === 'undefined') {
      return () => {
        active = false;
      };
    }

    const source = new EventSource('/api/forum/stream');
    source.onopen = () => {
      if (!active) return;
      setSseConnected(true);
      if (openedOnce) void refreshThreads();
      openedOnce = true;
    };
    source.onerror = () => active && setSseConnected(false);

    const onForumEvent = (event: Event) => {
      const message = event as MessageEvent<string>;
      try {
        const payload = JSON.parse(message.data) as ForumEvent<unknown>;
        const thread = normalizeThread<TThread>(payload.thread);
        if (thread) {
          loadedOnce.current = true;
          if (channel === 'all') upsertThread(thread);
          else void refreshThreads();
        }
      } catch {
        // Ignore malformed events and keep the last valid feed state.
      }
    };

    for (const eventName of [
      'new_thread',
      'new_reply',
      'upvote_update',
      'moderator_verified',
      'classification_update',
    ]) {
      source.addEventListener(eventName, onForumEvent);
    }

    return () => {
      active = false;
      source.close();
      setSseConnected(false);
    };
  }, [channel, refreshThreads]);

  return { threads, setThreads, sseConnected, loadState, loadError, loadMoreError, loadingMore, hasMore, refreshThreads, loadMoreThreads };
}
