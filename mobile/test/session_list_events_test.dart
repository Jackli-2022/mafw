/// E6-4: live session-list patches (`applySessionListEvent`).
///
/// Spec: `docs/superpowers/specs/2026-11-13-gateway-e6-interaction-model-design.md` §6.1
/// Plan: `docs/superpowers/plans/2026-11-13-gateway-e6-interaction.md` Task 4
///
/// Contract pinned here:
/// - only the canonical lifecycle events (`session.created/updated/deleted`,
///   read from `MafwEvent.innerType`) touch the list; flat / legacy frames and
///   every other event return the same list;
/// - `session.updated` patches only the fields present in `properties.info`
///   (title / directory / projectID / metadata / time.created) and keeps the
///   existing row order — absent fields are **not** cleared;
/// - `session.deleted` removes the id (info.id or the envelope sessionID);
/// - `session.created` needs complete info (id + non-empty title); it
///   replaces/appends and re-sorts Lead-first then newest-first, mirroring the
///   chat list comparator. Incomplete info returns the list unchanged so the
///   page can fall back to a debounced full refresh;
/// - `isHiddenSessionRow` mirrors the gateway `/api/sessions` visibility
///   predicate (parentID / legacy worker titles / internal agents / internal
///   roles; `manager` stays visible), so an incremental `created` for an
///   internal session is dropped instead of surviving until the next full fetch;
/// - malformed payload field types are ignored, never thrown.
library;

import 'package:flutter_test/flutter_test.dart';

import 'package:orcalore_mobile/src/models/mafw_models.dart';
import 'package:orcalore_mobile/src/models/session_list_events.dart';

MafwEvent _event(
  String innerType, {
  Map<String, dynamic>? info,
  String? sessionID,
  String frameType = kMafwEventEnvelope,
}) =>
    MafwEvent(
      type: frameType,
      innerType: frameType == kMafwEventEnvelope ? innerType : '',
      properties: {
        'info': ?info,
        'sessionID': ?sessionID,
      },
      sessionID: sessionID,
    );

MafwSession _session(
  String id, {
  String? title,
  String? projectID = '/work/a',
  String? directory = '/work/a',
  String? parentID,
  String? agent,
  Map<String, dynamic>? metadata,
  int? timeCreated,
}) =>
    MafwSession(
      id: id,
      title: title,
      projectID: projectID,
      directory: directory,
      parentID: parentID,
      agent: agent,
      metadata: metadata,
      timeCreated: timeCreated,
    );

Map<String, dynamic> _leadMetadata() => {
      'mafw': {'role': 'lead'},
    };

void main() {
  group('MafwSession.copyWith', () {
    test('keeps the id and only overwrites supplied fields', () {
      final row = _session('ses_1', title: 'old', timeCreated: 10);

      final patched = row.copyWith(title: 'new');

      expect(patched.id, 'ses_1');
      expect(patched.title, 'new');
      expect(patched.projectID, '/work/a');
      expect(patched.directory, '/work/a');
      expect(patched.timeCreated, 10);
    });

    test('without arguments returns an equal row', () {
      final row = _session('ses_1', title: 'old', timeCreated: 10);

      final copy = row.copyWith();

      expect(copy.id, row.id);
      expect(copy.title, row.title);
      expect(copy.projectID, row.projectID);
      expect(copy.directory, row.directory);
      expect(copy.metadata, row.metadata);
      expect(copy.timeCreated, row.timeCreated);
    });
  });

  group('applySessionListEvent: session.updated', () {
    test('patches title in place and preserves order', () {
      final current = [
        _session('ses_a', title: 'A', timeCreated: 300),
        _session('ses_b', title: 'B', timeCreated: 200),
        _session('ses_c', title: 'C', timeCreated: 100),
      ];

      final next = applySessionListEvent(
        current,
        _event('session.updated', info: {'id': 'ses_b', 'title': 'B renamed'}),
      );

      expect(next.map((s) => s.id), ['ses_a', 'ses_b', 'ses_c']);
      expect(next[1].title, 'B renamed');
      // Untouched rows keep their identity (no rebuild churn).
      expect(identical(next[0], current[0]), isTrue);
      expect(identical(next[2], current[2]), isTrue);
    });

    test('never clears fields that the patch omits', () {
      final current = [
        _session(
          'ses_a',
          title: 'A',
          projectID: '/work/a',
          directory: '/work/a',
          metadata: {'mafw': {'role': 'lead'}},
          timeCreated: 300,
        ),
      ];

      final next = applySessionListEvent(
        current,
        _event('session.updated', info: {'id': 'ses_a', 'title': 'A2'}),
      );

      expect(next.single.title, 'A2');
      expect(next.single.projectID, '/work/a');
      expect(next.single.directory, '/work/a');
      expect(next.single.metadata, {'mafw': {'role': 'lead'}});
      expect(next.single.timeCreated, 300);
    });

    test('applies directory / projectID / metadata / time.created when present', () {
      final current = [_session('ses_a', title: 'A', timeCreated: 1)];

      final next = applySessionListEvent(
        current,
        _event('session.updated', info: {
          'id': 'ses_a',
          'directory': '/work/b',
          'projectID': '/work/b',
          'metadata': _leadMetadata(),
          'time': {'created': 42},
        }),
      );

      expect(next.single.directory, '/work/b');
      expect(next.single.projectID, '/work/b');
      expect(next.single.isLead, isTrue);
      expect(next.single.timeCreated, 42);
    });

    test('an explicit empty title is applied (it is a real value)', () {
      final current = [_session('ses_a', title: 'A')];

      final next = applySessionListEvent(
        current,
        _event('session.updated', info: {'id': 'ses_a', 'title': ''}),
      );

      expect(next.single.title, '');
    });

    test('falls back to the envelope sessionID when info has no id', () {
      final current = [_session('ses_a', title: 'A')];

      final next = applySessionListEvent(
        current,
        _event(
          'session.updated',
          info: {'title': 'from sessionID'},
          sessionID: 'ses_a',
        ),
      );

      expect(next.single.title, 'from sessionID');
    });

    test('unknown id / no id / no info keeps the list untouched', () {
      final current = [_session('ses_a', title: 'A')];

      expect(
        identical(
          applySessionListEvent(
            current,
            _event('session.updated', info: {'id': 'ses_zzz', 'title': 'X'}),
          ),
          current,
        ),
        isTrue,
      );
      expect(
        identical(
          applySessionListEvent(
            current,
            _event('session.updated', info: {'title': 'X'}),
          ),
          current,
        ),
        isTrue,
      );
      expect(
        identical(
          applySessionListEvent(current, _event('session.updated')),
          current,
        ),
        isTrue,
      );
    });

    test('a patch with no recognised fields keeps the same list object', () {
      final current = [_session('ses_a', title: 'A')];

      final next = applySessionListEvent(
        current,
        _event('session.updated', info: {'id': 'ses_a', 'status': 'busy'}),
      );

      expect(identical(next, current), isTrue);
    });
  });

  group('applySessionListEvent: session.deleted', () {
    test('removes the row addressed by info.id', () {
      final current = [
        _session('ses_a', timeCreated: 300),
        _session('ses_b', timeCreated: 200),
      ];

      final next = applySessionListEvent(
        current,
        _event('session.deleted', info: {'id': 'ses_a'}),
      );

      expect(next.map((s) => s.id), ['ses_b']);
    });

    test('removes the row addressed by the envelope sessionID', () {
      final current = [
        _session('ses_a', timeCreated: 300),
        _session('ses_b', timeCreated: 200),
      ];

      final next = applySessionListEvent(
        current,
        _event('session.deleted', sessionID: 'ses_b'),
      );

      expect(next.map((s) => s.id), ['ses_a']);
    });

    test('unknown / missing id keeps the list untouched', () {
      final current = [_session('ses_a')];

      expect(
        identical(
          applySessionListEvent(
            current,
            _event('session.deleted', info: {'id': 'ses_zzz'}),
          ),
          current,
        ),
        isTrue,
      );
      expect(
        identical(
          applySessionListEvent(current, _event('session.deleted')),
          current,
        ),
        isTrue,
      );
    });
  });

  group('applySessionListEvent: session.created', () {
    test('appends a complete session and sorts newest-first', () {
      final current = [
        _session('ses_a', title: 'A', timeCreated: 100),
        _session('ses_b', title: 'B', timeCreated: 200),
      ];

      final next = applySessionListEvent(
        current,
        _event('session.created', info: {
          'id': 'ses_new',
          'title': 'New',
          'projectID': '/work/a',
          'directory': '/work/a',
          'time': {'created': 300},
        }),
      );

      expect(next.map((s) => s.id), ['ses_new', 'ses_b', 'ses_a']);
      expect(next.first.title, 'New');
    });

    test('keeps Lead rows first, then newest-first', () {
      final current = [
        _session('ses_lead', title: 'Lead', metadata: _leadMetadata(), timeCreated: 10),
        _session('ses_b', title: 'B', timeCreated: 200),
      ];

      final next = applySessionListEvent(
        current,
        _event('session.created', info: {
          'id': 'ses_new',
          'title': 'New',
          'time': {'created': 300},
        }),
      );

      expect(next.map((s) => s.id), ['ses_lead', 'ses_new', 'ses_b']);
    });

    test('replaces an existing row instead of duplicating it', () {
      final current = [
        _session('ses_a', title: 'old', timeCreated: 100),
        _session('ses_b', title: 'B', timeCreated: 200),
      ];

      final next = applySessionListEvent(
        current,
        _event('session.created', info: {
          'id': 'ses_a',
          'title': 'A fresh',
          'time': {'created': 100},
        }),
      );

      expect(next.map((s) => s.id), ['ses_b', 'ses_a']);
      expect(next.firstWhere((s) => s.id == 'ses_a').title, 'A fresh');
      expect(next.length, 2);
    });

    test('missing info / id / title returns the list unchanged (page debounces)', () {
      final current = [_session('ses_a', title: 'A')];

      for (final event in [
        _event('session.created'),
        _event('session.created', info: {'title': 'no id'}),
        _event('session.created', info: {'id': 'ses_new'}),
        _event('session.created', info: {'id': 'ses_new', 'title': ''}),
      ]) {
        expect(
          identical(applySessionListEvent(current, event), current),
          isTrue,
          reason: '$event',
        );
      }
    });

    test('a title-only session is rejected even when the envelope has a sessionID', () {
      final current = [_session('ses_a', title: 'A')];

      final next = applySessionListEvent(
        current,
        _event(
          'session.created',
          info: {'title': 'incomplete'},
          sessionID: 'ses_new',
        ),
      );

      expect(identical(next, current), isTrue);
    });
  });

  group('isHiddenSessionRow (mirrors gateway isHiddenSession)', () {
    test('a child session (parentID) is hidden', () {
      expect(isHiddenSessionRow(_session('ses_child', title: 'task', parentID: 'ses_a')), isTrue);
    });

    test('legacy worker title prefixes are hidden', () {
      for (final title in [
        '# Memory Index 2026-11-13',
        '{"task":"reflect"}',
        '```json\n{}',
        '标题：整理记忆',
      ]) {
        expect(
          isHiddenSessionRow(_session('ses_worker', title: title)),
          isTrue,
          reason: title,
        );
      }
    });

    test('internal agent names are hidden', () {
      for (final agent in [
        'memory-curator',
        'mafw-tech-lead',
        'mafw-execute',
        'mafw-review',
      ]) {
        expect(
          isHiddenSessionRow(_session('ses_w', title: 'Worker', agent: agent)),
          isTrue,
          reason: agent,
        );
      }
    });

    test('internal metadata roles are hidden', () {
      for (final role in ['lead', 'tech-lead', 'tech_lead']) {
        expect(
          isHiddenSessionRow(_session(
            'ses_w',
            title: 'Role row',
            metadata: {
              'mafw': {'role': role},
            },
          )),
          isTrue,
          reason: role,
        );
      }
    });

    test('manager stays visible (legacy coordination sessions are user history)', () {
      expect(
        isHiddenSessionRow(_session(
          'ses_manager',
          title: 'Coordinator',
          metadata: {
            'mafw': {'role': 'manager'},
          },
        )),
        isFalse,
      );
    });

    test('a normal conversation is visible', () {
      expect(isHiddenSessionRow(_session('ses_a', title: 'Alpha')), isFalse);
    });
  });

  group('applySessionListEvent: hidden sessions never enter the list', () {
    test('a hidden session.created leaves the list untouched', () {
      final current = [_session('ses_a', title: 'A', timeCreated: 100)];

      for (final info in [
        {'id': 'ses_child', 'title': 'Task', 'parentID': 'ses_a'},
        {'id': 'ses_worker', 'title': '{"task":"reflect"}'},
        {'id': 'ses_agent', 'title': 'Worker', 'agent': 'memory-curator'},
        {
          'id': 'ses_lead',
          'title': 'Lead',
          'metadata': {
            'mafw': {'role': 'lead'},
          },
        },
      ]) {
        expect(
          identical(
            applySessionListEvent(current, _event('session.created', info: info)),
            current,
          ),
          isTrue,
          reason: '$info',
        );
      }
    });

    test('a manager session is still appended (parity with /api/sessions)', () {
      final current = [_session('ses_a', title: 'A', timeCreated: 100)];

      final next = applySessionListEvent(
        current,
        _event('session.created', info: {
          'id': 'ses_manager',
          'title': 'Coordinator',
          'metadata': {
            'mafw': {'role': 'manager'},
          },
          'time': {'created': 300},
        }),
      );

      expect(next.map((s) => s.id), ['ses_manager', 'ses_a']);
    });
  });

  group('applySessionListEvent: malformed payloads', () {
    test('session.updated with wrong field types is ignored, not thrown', () {
      final current = [
        _session('ses_a', title: 'A', timeCreated: 1),
      ];

      final next = applySessionListEvent(
        current,
        _event('session.updated', info: {
          'id': 'ses_a',
          'title': 42,
          'projectID': <String, dynamic>{},
          'directory': ['/work/a'],
          'metadata': 'not-a-map',
          'time': {'created': 'soon'},
        }),
      );

      expect(identical(next, current), isTrue);
    });

    test('a session.created with wrong field types does not throw', () {
      final current = [_session('ses_a', title: 'A', timeCreated: 1)];

      final next = applySessionListEvent(
        current,
        _event('session.created', info: {
          'id': 'ses_new',
          'title': 'New',
          'parentID': 123,
          'projectID': true,
          'directory': 9,
          'metadata': 'nope',
          'time': {'created': 'later'},
        }),
      );

      // Complete enough to append, but the malformed fields stay null.
      expect(next.length, 2);
      final row = next.firstWhere((s) => s.id == 'ses_new');
      expect(row.parentID, isNull);
      expect(row.projectID, isNull);
      expect(row.directory, isNull);
      expect(row.metadata, isNull);
      expect(row.timeCreated, isNull);
    });
  });

  group('applySessionListEvent: other frames', () {
    test('unknown canonical events return the same list', () {
      final current = [_session('ses_a', title: 'A')];

      expect(
        identical(
          applySessionListEvent(
            current,
            _event('turn.completed', info: {'id': 'ses_a', 'title': 'X'}),
          ),
          current,
        ),
        isTrue,
      );
    });

    test('legacy / flat frames (innerType empty) are ignored', () {
      final current = [_session('ses_a', title: 'A')];

      final legacy = MafwEvent(
        type: 'session.updated',
        properties: {
          'info': {'id': 'ses_a', 'title': 'legacy'},
        },
      );

      expect(identical(applySessionListEvent(current, legacy), current), isTrue);
    });

    test('empty list stays empty for events that match nothing', () {
      const current = <MafwSession>[];

      expect(
        applySessionListEvent(
          current,
          _event('session.deleted', info: {'id': 'ses_x'}),
        ),
        isEmpty,
      );
    });
  });
}
