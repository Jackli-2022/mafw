/// E10f-E: triage 卡片兜底单测。
///
/// Wire 事实源：`GET /api/triage` → `{ items: [{ id, automationId, discoveredAt,
/// source, summary, proposedGoal?, state, userAction, deadline, llmSuggestions? }] }`
/// （`gateway/src/routes/schemas/human-gate.ts`）。
/// 幻影字段 `goalId` / `reason` / `severity` / `createdAt` 不在任何 writer 输出里。
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/models/triage_card_model.dart';

Map<String, dynamic> item([Map<String, dynamic> overrides = const {}]) {
  return <String, dynamic>{
    'id': 'triage_1',
    'automationId': 'automation_1',
    'discoveredAt': '2026-11-13T08:30:00.000Z',
    'source': 'skill-scan',
    'summary': <String, dynamic>{},
    'state': 'PENDING_CONFIRMATION',
    'userAction': null,
    'deadline': '2026-11-14T08:30:00.000Z',
    ...overrides,
  };
}

String expectedLocal(String iso) {
  final local = DateTime.parse(iso).toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} '
      '${two(local.hour)}:${two(local.minute)}';
}

void main() {
  group('title', () {
    test('prefers proposedGoal.title over summary.title', () {
      final model = triageCardModel(item({
        'proposedGoal': {
          'title': '把 nightly 扫描改成可验证 Goal',
          'boundaries': <String>[],
          'estimatedLoops': 2,
        },
        'summary': {'title': 'draft title'},
      }));
      expect(model.title, '把 nightly 扫描改成可验证 Goal');
    });

    test('falls back to summary.title when there is no proposedGoal', () {
      expect(triageCardModel(item({'summary': {'title': 'draft title'}})).title,
          'draft title');
    });

    test('falls back to the draft names inside summary', () {
      expect(
        triageCardModel(item({
          'summary': {'skillDraft': {'name': 'release-notes'}},
        })).title,
        'release-notes',
      );
      expect(
        triageCardModel(item({
          'summary': {'axiomDraft': {'name': 'axiom-no-hex-colors'}},
        })).title,
        'axiom-no-hex-colors',
      );
    });

    test('falls back to id (never the phantom description/reason)', () {
      final model = triageCardModel(item({
        'summary': {'note': 'no usable title'},
        // Phantom fields must be ignored even when a stale client sends them.
        'reason': 'phantom reason',
        'severity': 'high',
        'goalId': 'goal_1',
      }));
      expect(model.title, 'triage_1');
      expect(model.title, isNot(contains('phantom')));
    });

    test('degrades to a stable label when id is absent too', () {
      expect(triageCardModel(<String, dynamic>{}).title, '未命名待决项');
    });
  });

  group('meta', () {
    test('source · discoveredAt · 截止 deadline', () {
      final meta = triageCardModel(item()).meta.split(' · ');
      expect(meta.first, 'skill-scan');
      expect(meta[1], expectedLocal('2026-11-13T08:30:00.000Z'));
      expect(meta[2], '截止 ${expectedLocal('2026-11-14T08:30:00.000Z')}');
      expect(meta.length, 3);
    });

    test('missing discoveredAt/deadline are omitted, not invented', () {
      final noDeadline = triageCardModel(item({'deadline': ''})).meta.split(' · ');
      expect(noDeadline.length, 2, reason: 'source + discoveredAt only');
      expect(noDeadline.first, 'skill-scan');

      final noDiscovered = triageCardModel(item({'discoveredAt': null})).meta.split(' · ');
      expect(noDiscovered.length, 2, reason: 'source + deadline only');
      expect(noDiscovered[1], startsWith('截止 '));

      expect(triageCardModel(item({'source': '', 'discoveredAt': null, 'deadline': null})).meta,
          '');
    });

    test('unparseable dates are dropped, never rendered as "Invalid Date"', () {
      final meta = triageCardModel(item({
        'discoveredAt': 'not-a-date',
        'deadline': 'deadline-tbd',
      })).meta;
      expect(meta, 'skill-scan');
      expect(meta, isNot(contains('Invalid')));
      expect(localizedTimestamp('not-a-date'), isNull);
      expect(localizedTimestamp(null), isNull);
    });
  });

  group('badge', () {
    test('state drives the badge label and tone', () {
      expect(triageCardModel(item()).badge.label, '待确认');
      expect(triageCardModel(item()).badge.tone, TriageTone.warn);
      expect(triageCardModel(item({'state': 'CONFIRMED'})).badge.tone,
          TriageTone.neutral);
      expect(triageCardModel(item({'state': 'REJECTED'})).badge.tone,
          TriageTone.danger);
    });

    test('unknown state is shown verbatim with a neutral tone', () {
      final badge = triageCardModel(item({'state': 'ESCALATED'})).badge;
      expect(badge.label, 'ESCALATED');
      expect(badge.tone, TriageTone.neutral);
    });

    test('only the highest-priority suggestion is appended (tone unchanged)', () {
      final badge = triageCardModel(item({
        'llmSuggestions': [
          {'action': 'reject', 'reason': 'low', 'priority': 'low', 'timestamp': 't'},
          {'action': 'confirm', 'reason': 'high', 'priority': 'high', 'timestamp': 't'},
          {'action': 'reject', 'reason': 'medium', 'priority': 'medium', 'timestamp': 't'},
        ],
      })).badge;
      expect(badge.tone, TriageTone.warn);
      expect(badge.label, '待确认 · 建议确认 high');
    });

    test('empty suggestions keep the bare state label', () {
      expect(triageCardModel(item({'llmSuggestions': <dynamic>[]})).badge.label, '待确认');
    });
  });
}
