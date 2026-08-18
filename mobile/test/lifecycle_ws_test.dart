import 'package:flutter_test/flutter_test.dart';
import 'package:mafw_mobile/src/services/lifecycle_ws.dart';

void main() {
  group('LifecycleWsManager', () {
    late LifecycleWsManager manager;
    late int connectCalls;
    late int disconnectCalls;

    setUp(() {
      connectCalls = 0;
      disconnectCalls = 0;
      manager = LifecycleWsManager(
        onConnect: () async => connectCalls++,
        onDisconnect: () async => disconnectCalls++,
      );
    });

    tearDown(() {
      manager.dispose();
    });

    test('starts in resumed state', () {
      expect(manager.isResumed, isTrue);
      expect(manager.isInBackground, isFalse);
    });

    test('pause triggers disconnect', () async {
      manager.pause();
      await Future.delayed(Duration.zero);
      expect(disconnectCalls, 1);
      expect(manager.isInBackground, isTrue);
    });

    test('resume triggers connect', () async {
      manager.pause();
      await Future.delayed(Duration.zero);
      expect(disconnectCalls, 1);

      manager.resume();
      await Future.delayed(Duration.zero);
      expect(connectCalls, 1);
      expect(manager.isInBackground, isFalse);
    });

    test('multiple pauses only disconnect once', () async {
      manager.pause();
      manager.pause();
      manager.pause();
      await Future.delayed(Duration.zero);
      expect(disconnectCalls, 1);
    });

    test('pause then resume then pause disconnects twice total', () async {
      manager.pause();
      await Future.delayed(Duration.zero);
      manager.resume();
      await Future.delayed(Duration.zero);
      manager.pause();
      await Future.delayed(Duration.zero);
      expect(disconnectCalls, 2);
    });

    test('dispose prevents further callbacks', () async {
      manager.dispose();
      manager.pause();
      await Future.delayed(Duration.zero);
      expect(disconnectCalls, 0);
    });

    test('dispose cancels reconnect timer', () {
      manager.scheduleReconnect(const Duration(seconds: 5));
      manager.dispose();
      // Should not throw
    });

    test('scheduleReconnect fires callback after delay', () async {
      var called = false;
      manager.scheduleReconnect(
        const Duration(milliseconds: 50),
        onReconnect: () async => called = true,
      );
      expect(called, isFalse);
      await Future.delayed(const Duration(milliseconds: 100));
      expect(called, isTrue);
    });

    test('pause cancels pending reconnect', () async {
      var called = false;
      manager.scheduleReconnect(
        const Duration(milliseconds: 50),
        onReconnect: () async => called = true,
      );
      manager.pause();
      await Future.delayed(const Duration(milliseconds: 100));
      expect(called, isFalse);
    });
  });
}
