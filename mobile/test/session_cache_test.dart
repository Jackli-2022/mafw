import 'package:flutter_test/flutter_test.dart';
import 'package:mafw_mobile/src/cache/session_cache.dart';

void main() {
  group('SessionCache', () {
    late SessionCache cache;

    setUp(() async {
      cache = SessionCache();
      await cache.init();
    });

    tearDown(() async {
      await cache.dispose();
    });

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

      cache.clear();
      expect(cache.get('msg-1'), isNull);
      expect(cache.get('msg-2'), isNull);
    });

    test('expired entries are evicted on access', () async {
      final cache = SessionCache(ttl: const Duration(milliseconds: 50));
      await cache.init();

      final now = DateTime.now().millisecondsSinceEpoch;
      await cache.put(CachedMessage(
        id: 'msg-1', sessionID: 'sess-1', role: 'user', text: 'Hello', timeCreated: now,
      ));

      expect(cache.get('msg-1'), isNotNull);

      await Future.delayed(const Duration(milliseconds: 100));

      expect(cache.get('msg-1'), isNull);
      await cache.dispose();
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
