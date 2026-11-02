/// Drift guard: Dart canonical vocabulary must mirror the shared TS contract.
///
/// `packages/gateway-sdk/src/events.ts` is the single source of truth (gateway
/// mirrors it in `gateway/src/runtime/mafw-vocabulary.ts`, pinned by
/// `vocabulary-sync.test.ts`). This test parses the TS arrays and asserts the
/// Dart mirror matches **exactly, including order**.
///
/// Requires the monorepo layout (`mobile/` sibling of `packages/`); CI runs it
/// from the repo checkout on every `events.ts` change.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:mafw_mobile/src/models/mafw_models.dart';

const List<String> _eventsTsCandidates = [
  '../packages/gateway-sdk/src/events.ts',
  'packages/gateway-sdk/src/events.ts',
  '../../packages/gateway-sdk/src/events.ts',
];

String _readEventsContract() {
  for (final candidate in _eventsTsCandidates) {
    final file = File(candidate);
    if (file.existsSync()) return file.readAsStringSync();
  }
  fail(
    'Cannot locate packages/gateway-sdk/src/events.ts (tried '
    '${_eventsTsCandidates.join(', ')} from ${Directory.current.path}). '
    'This contract test must run from the monorepo (mobile/ next to packages/).',
  );
}

/// Extract the string entries of `export const <name> = [ ... ] as const`.
List<String> _parseConstArray(String source, String name) {
  final start = source.indexOf('export const $name = [');
  expect(start, greaterThanOrEqualTo(0), reason: 'missing `export const $name` in events.ts');
  final end = source.indexOf('] as const', start);
  expect(end, greaterThan(start), reason: 'unterminated `$name` array in events.ts');
  final body = source.substring(start, end);
  return RegExp(r'"([^"]+)"')
      .allMatches(body)
      .map((m) => m.group(1)!)
      .toList(growable: false);
}

void main() {
  group('canonical vocabulary parity (Dart ⇄ gateway-sdk events.ts)', () {
    test('kMafwCanonicalEventTypes equals RUNTIME_EVENT_TYPES in set and order', () {
      final source = _readEventsContract();
      final gatewayTypes = _parseConstArray(source, 'RUNTIME_EVENT_TYPES');

      expect(gatewayTypes, isNotEmpty);
      expect(
        kMafwCanonicalEventTypes.toList(),
        gatewayTypes,
        reason: 'mobile canonical vocabulary drifted from packages/gateway-sdk/src/events.ts',
      );
    });

    test('flat broadcast names never leak into the canonical set', () {
      final source = _readEventsContract();
      final flatTypes = _parseConstArray(source, 'FLAT_EVENT_TYPES');

      expect(flatTypes, isNotEmpty);
      for (final flat in flatTypes) {
        expect(kMafwCanonicalEventTypes.contains(flat), isFalse, reason: flat);
        expect(canonicalEventTypeOf(flat), isEmpty, reason: flat);
      }
    });

    test('envelope name matches the contract', () {
      final source = _readEventsContract();
      expect(source.contains('type: "mafw_event"'), isTrue);
      expect(kMafwEventEnvelope, 'mafw_event');
    });

    test('plugin namespaced inner types are accepted, legacy names are not', () {
      for (final type in kMafwCanonicalEventTypes) {
        expect(canonicalEventTypeOf(type), type);
      }
      expect(canonicalEventTypeOf('plugin:example:progress'), 'plugin:example:progress');
      for (final legacy in const [
        'opencode_event',
        'message.part.updated',
        'message.part.delta',
        'message.complete',
        'message.error',
        'session.idle',
      ]) {
        expect(canonicalEventTypeOf(legacy), isEmpty, reason: legacy);
      }
    });
  });
}
