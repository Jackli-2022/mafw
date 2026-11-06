// SmartReconnectManager persistence (Task 3).
//
// The manager promises "state survives app restarts" so a phone that was
// killed mid-reconnect-storm does not immediately retry 10 more times on
// relaunch. These tests pin that promise: the stored blob must be real JSON
// and a fresh manager instance must load it back faithfully.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:orcalore_mobile/src/services/smart_reconnect.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Storage key used by [SmartReconnectManager] (private constant, pinned here
/// so the wire format stays observable).
const String _stateKey = 'smart_reconnect_state';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('SmartReconnectManager persistence', () {
    setUp(() {
      SharedPreferences.setMockInitialValues({});
    });

    test('attempt count survives a manager restart (JSON round-trip)', () async {
      final first = SmartReconnectManager();
      await first.init();
      expect(first.state.attempts, 0);

      await first.nextDelay();
      await first.nextDelay();
      expect(first.state.attempts, 2);

      // New instance == app relaunch: state must come back from storage.
      final second = SmartReconnectManager();
      await second.init();
      expect(second.state.attempts, 2);
      expect(second.state.lastFailure, isNotNull);
    });

    test('exhausted retry budget survives restart (no reconnect storm)', () async {
      final first = SmartReconnectManager();
      await first.init();
      for (var i = 0; i < SmartReconnectManager.maxAttempts; i++) {
        expect(await first.nextDelay(), isNotNull);
      }
      expect(first.state.attempts, SmartReconnectManager.maxAttempts);

      final second = SmartReconnectManager();
      await second.init();
      expect(second.state.attempts, SmartReconnectManager.maxAttempts);
      expect(await second.nextDelay(), isNull);
    });

    test('last success timestamp survives restart', () async {
      final first = SmartReconnectManager();
      await first.init();
      await first.nextDelay();
      await first.onSuccess();
      expect(first.state.attempts, 0);

      final second = SmartReconnectManager();
      await second.init();
      expect(second.state.attempts, 0);
      expect(second.state.lastSuccess, isNotNull);
    });

    test('stored blob is JSON, not a Dart Map toString()', () async {
      final manager = SmartReconnectManager();
      await manager.init();
      await manager.nextDelay();

      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_stateKey);
      expect(raw, isNotNull);

      final decoded = jsonDecode(raw!);
      expect(decoded, isA<Map<String, dynamic>>());
      expect((decoded as Map<String, dynamic>)['attempts'], 1);
    });

    test('corrupt stored blob falls back to a fresh state', () async {
      SharedPreferences.setMockInitialValues({_stateKey: 'not-json{{'});

      final manager = SmartReconnectManager();
      await manager.init();
      expect(manager.state.attempts, 0);
      expect(manager.state.lastSuccess, isNull);
      expect(manager.state.lastFailure, isNull);
    });
  });
}
