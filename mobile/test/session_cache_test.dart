import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:hive_ce/hive.dart';
import 'package:orcalore_mobile/src/cache/session_cache.dart';

void main() {
  group('SessionCache', () {
    late SessionCache cache;
    late Directory hiveDir;

    setUpAll(() async {
      TestWidgetsFlutterBinding.ensureInitialized();
      hiveDir = await Directory.systemTemp.createTemp('mafw_session_cache_test');
      Hive.init(hiveDir.path);
    });

    tearDownAll(() async {
      await Hive.close();
      await hiveDir.delete(recursive: true);
    });

    setUp(() async {
      // One Hive box is shared for the whole file (closing/reopening a named box
      // in hive_ce leaves a closed notifier behind); clear it per test instead.
      cache = SessionCache(limitPerSession: 2);
      await cache.init();
      await cache.clear();
    });

    // No per-test dispose: closing the shared box would poison later tests.

    test('put and get stores message', () async {
      final msg = CachedMessage(
        id: 'msg-1',
        sessionID: 'sess-1',
        role: 'user',
        text: 'Hello',
        timeCreated: DateTime.now().millisecondsSinceEpoch,
      );
      await cache.put(msg);

      final result = cache.get('msg-1');
      expect(result, isNotNull);
      expect(result!.id, 'msg-1');
      expect(result.text, 'Hello');
    });

    test('get returns null for missing id', () {
      final result = cache.get('nonexistent');
      expect(result, isNull);
    });

    test('getBySession returns messages for a session', () async {
      final now = DateTime.now().millisecondsSinceEpoch;
      await cache.put(CachedMessage(
        id: 'msg-1', sessionID: 'sess-1', role: 'user', text: 'A', timeCreated: now,
      ));
      await cache.put(CachedMessage(
        id: 'msg-2', sessionID: 'sess-1', role: 'assistant', text: 'B', timeCreated: now + 1,
      ));
      await cache.put(CachedMessage(
        id: 'msg-3', sessionID: 'sess-2', role: 'user', text: 'C', timeCreated: now,
      ));

      final msgs = cache.getBySession('sess-1');
      expect(msgs.length, 2);
      expect(msgs[0].id, 'msg-1');
      expect(msgs[1].id, 'msg-2');
    });

    test('getBySession returns empty for unknown session', () {
      final msgs = cache.getBySession('unknown');
      expect(msgs, isEmpty);
    });

    test('evicts oldest when exceeding limit', () async {
      final now = DateTime.now().millisecondsSinceEpoch;
      // Insert 3 messages (limit is 2 per session)
      for (var i = 0; i < 3; i++) {
        await cache.put(CachedMessage(
          id: 'msg-$i', sessionID: 'sess-1', role: 'user', text: 'Text $i', timeCreated: now + i,
        ));
      }

      final msgs = cache.getBySession('sess-1');
      expect(msgs.length, 2);
      // Oldest (msg-0) should be evicted
      expect(msgs[0].id, 'msg-1');
      expect(msgs[1].id, 'msg-2');
    });

    test('remove deletes a message', () async {
      final now = DateTime.now().millisecondsSinceEpoch;
      await cache.put(CachedMessage(
        id: 'msg-1', sessionID: 'sess-1', role: 'user', text: 'Hello', timeCreated: now,
      ));

      cache.remove('msg-1');
      expect(cache.get('msg-1'), isNull);
    });

    test('clearSession removes all messages for a session', () async {
      final now = DateTime.now().millisecondsSinceEpoch;
      await cache.put(CachedMessage(
        id: 'msg-1', sessionID: 'sess-1', role: 'user', text: 'A', timeCreated: now,
      ));
      await cache.put(CachedMessage(
        id: 'msg-2', sessionID: 'sess-1', role: 'assistant', text: 'B', timeCreated: now,
      ));

      cache.clearSession('sess-1');
      expect(cache.getBySession('sess-1'), isEmpty);
    });

    test('clear removes all messages', () async {
      final now = DateTime.now().millisecondsSinceEpoch;
      await cache.put(CachedMessage(
        id: 'msg-1', sessionID: 'sess-1', role: 'user', text: 'A', timeCreated: now,
      ));
      await cache.put(CachedMessage(
        id: 'msg-2', sessionID: 'sess-2', role: 'user', text: 'B', timeCreated: now,
      ));

      await cache.clear();
      expect(cache.get('msg-1'), isNull);
      expect(cache.get('msg-2'), isNull);
    });

    test('expired entries are evicted on access', () async {
      // Shares the file-wide box; a short TTL is the only difference.
      final shortLived = SessionCache(ttl: const Duration(milliseconds: 50));
      await shortLived.init();
      await shortLived.clear();

      final now = DateTime.now().millisecondsSinceEpoch;
      await shortLived.put(CachedMessage(
        id: 'msg-1', sessionID: 'sess-1', role: 'user', text: 'Hello', timeCreated: now,
      ));

      expect(shortLived.get('msg-1'), isNotNull);

      await Future.delayed(const Duration(milliseconds: 100));

      expect(shortLived.get('msg-1'), isNull);
    });

    test('size reports total count', () async {
      final now = DateTime.now().millisecondsSinceEpoch;
      await cache.put(CachedMessage(
        id: 'msg-1', sessionID: 'sess-1', role: 'user', text: 'A', timeCreated: now,
      ));
      await cache.put(CachedMessage(
        id: 'msg-2', sessionID: 'sess-2', role: 'user', text: 'B', timeCreated: now,
      ));

      expect(cache.size, 2);
    });
  });
}
