/// MAFW Work / Presence / Pod read models + client endpoints (Task 4).
///
/// Contract sources (gateway, verified by reading the route files — never guessed):
/// - `GET /api/projects` → `{projects:[{id, worktree}]}` (gateway/src/index.ts:6813)
/// - `GET /api/projects/:projectId/work` → `{projectDir, podId, groups{5 buckets},
///   counts, total}` — 404 when the project has no Pod (gateway/src/routes/pod-work.ts:31)
/// - `GET /api/presence` → `{running[], attention{count,items},
///   unreadResults{count,latest}}` (gateway/src/core/pod/pod-presence.ts:46)
/// - `GET /api/pods/:podId/goals` → `{items: PodGoalView[]}` (gateway/src/routes/pods.ts:367)
/// - `GET /api/projects/:projectId/pod/lookup` → PodDetailView, 404 = no Pod
///   (gateway/src/routes/pods.ts:59)
/// - `POST /api/pods/:podId/lead/ensure` → `{podId, projectDir, sessionId}`
///   (gateway/src/core/pod/pod-service.ts:174)
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/models/pod_models.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';

const _projectDir = r'C:\work\proj';

GatewayClient _client(http_testing.MockClient mock) => GatewayClient(
      const ConnectionConfig(baseUrl: 'http://localhost:3000', apiToken: 't'),
      httpClient: mock,
    );

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

void main() {
  group('WorkOverview five buckets', () {
    test('parses every bucket, count, stage owner/kind and goal fields', () {
      final overview = WorkOverview.fromJson({
        'projectDir': _projectDir,
        'podId': 'pod-1',
        'groups': {
          'needs_you': [
            {
              'id': 'goalrow-1',
              'goalId': 'g1',
              'title': '修 CI',
              'status': 'active',
              'bucket': 'needs_you',
              'revision': 2,
              'activeRevision': 2,
              'verdict': null,
              'resultReady': false,
              'strategy': 'collaborative',
              'stage': {'owner': 'person', 'kind': 'plan_approval'},
            },
          ],
          'queued': [
            {
              'goalId': 'g2',
              'title': '排队的',
              'status': 'queued',
              'bucket': 'queued',
              'revision': 1,
              'stage': {'owner': 'team', 'kind': 'queued'},
            },
          ],
          'in_progress': [],
          'result_ready': [
            {
              'goalId': 'g3',
              'title': '完成的',
              'status': 'done',
              'bucket': 'result_ready',
              'revision': 1,
              'verdict': 'PASS',
              'resultReady': true,
              'strategy': 'quick',
              'stage': {'owner': 'person', 'kind': 'open_result'},
            },
          ],
          'ended': [],
        },
        'counts': {
          'needs_you': 1,
          'queued': 1,
          'in_progress': 0,
          'result_ready': 1,
          'ended': 0,
        },
        'total': 3,
      });

      expect(overview.groups.keys, containsAll(workBuckets));
      expect(overview.groups['needs_you']!.single.goalId, 'g1');
      expect(overview.groups['needs_you']!.single.title, '修 CI');
      expect(overview.groups['needs_you']!.single.status, 'active');
      expect(overview.groups['needs_you']!.single.bucket, 'needs_you');
      expect(overview.groups['needs_you']!.single.revision, 2);
      expect(overview.groups['needs_you']!.single.verdict, isNull);
      expect(overview.groups['needs_you']!.single.resultReady, isFalse);
      expect(overview.groups['needs_you']!.single.strategy, 'collaborative');
      expect(overview.groups['needs_you']!.single.stageOwner, 'person');
      expect(overview.groups['needs_you']!.single.stageKind, 'plan_approval');
      expect(overview.groups['result_ready']!.single.verdict, 'PASS');
      expect(overview.groups['result_ready']!.single.resultReady, isTrue);
      expect(overview.counts['result_ready'], 1);
      expect(overview.counts['in_progress'], 0);
      expect(overview.podId, 'pod-1');
      expect(overview.projectDir, _projectDir);
      expect(overview.total, 3);
    });

    test('missing buckets are materialised as empty lists and zero counts', () {
      final overview = WorkOverview.fromJson({
        'groups': {
          'queued': [],
        },
        'counts': <String, dynamic>{},
      });

      for (final bucket in workBuckets) {
        expect(overview.groups[bucket], isEmpty, reason: 'bucket $bucket');
        expect(overview.counts[bucket], 0, reason: 'count $bucket');
      }
      expect(overview.total, 0);
    });

    test('malformed buckets are tolerated instead of throwing', () {
      final overview = WorkOverview.fromJson({
        'groups': {
          'needs_you': 'not-a-list',
          'queued': [
            'not-a-map',
            {'goalId': 'g1', 'title': 'ok'},
          ],
        },
        'counts': {'queued': '3'},
      });

      expect(overview.groups['needs_you'], isEmpty);
      expect(overview.groups['queued']!.single.goalId, 'g1');
      expect(overview.counts['queued'], 3);
    });
  });

  group('PodGoalView half-present fields', () {
    test('a goal with only goalId keeps defaults and a null verdict', () {
      final view = PodGoalView.fromJson({'goalId': 'g1'});

      expect(view.goalId, 'g1');
      expect(view.title, '');
      expect(view.status, '');
      expect(view.bucket, '');
      expect(view.revision, 1);
      expect(view.verdict, isNull);
      expect(view.resultReady, isFalse);
      expect(view.strategy, isNull);
      expect(view.stageOwner, isNull);
      expect(view.stageKind, isNull);
    });

    test('revision falls back to activeRevision when only the pointer is sent', () {
      final view = PodGoalView.fromJson({'id': 'row1', 'goalId': 'g1', 'activeRevision': 3});

      expect(view.goalId, 'g1');
      expect(view.revision, 3);
    });

    test('id-only rows keep an empty goalId instead of inventing one', () {
      final view = PodGoalView.fromJson({'id': 'row1'});

      expect(view.goalId, isEmpty);
      expect(view.title, isEmpty);
    });
  });

  group('PresenceInfo aggregate', () {
    test('aggregates running titles, attention items and unread result count', () {
      final presence = PresenceInfo.fromJson({
        'running': [
          {
            'podId': 'pod-1',
            'projectId': _projectDir,
            'projectName': 'proj',
            'goalId': 'g1',
            'title': '跑着的目标',
            'phase': 'EXECUTING',
            'node': 'execute',
            'revision': 1,
            'progress': {'current': 1, 'total': 3},
          },
        ],
        'attention': {
          'count': 1,
          'items': [
            {
              'id': 'g1:plan_approval:r1',
              'goalId': 'g1',
              'revision': 1,
              'kind': 'plan_approval',
              'title': '批准计划',
              'action': {'type': 'open_goal', 'goalId': 'g1'},
            },
          ],
        },
        'unreadResults': {
          'count': 2,
          'latest': {'goalId': 'g9', 'title': '结果'},
        },
      });

      expect(presence.running, ['跑着的目标']);
      expect(presence.attention.single.id, 'g1:plan_approval:r1');
      expect(presence.attention.single.goalId, 'g1');
      expect(presence.attention.single.kind, 'plan_approval');
      expect(presence.attention.single.title, '批准计划');
      // Gateway presence attaches the owning Pod + parent-folded project
      // (Task 7) — a payload without them must still parse as null, never guess.
      expect(presence.attention.single.projectId, isNull);
      expect(presence.attention.single.podId, isNull);
      expect(presence.unreadResultsCount, 2);
    });

    test('attention items expose the owning pod/project when the gateway sends them', () {
      final presence = PresenceInfo.fromJson({
        'attention': {
          'count': 1,
          'items': [
            {
              'id': 'g1:blocked:r1',
              'goalId': 'g1',
              'revision': 1,
              'kind': 'blocked',
              'title': '卡住了',
              'projectId': _projectDir,
              'podId': 'pod-1',
            },
          ],
        },
      });

      expect(presence.attention.single.projectId, _projectDir);
      expect(presence.attention.single.podId, 'pod-1');
    });

    test('running titles fall back to goalId; an empty payload yields an empty presence', () {
      final presence = PresenceInfo.fromJson({
        'running': [
          {'goalId': 'g2'},
        ],
      });
      expect(presence.running, ['g2']);

      final empty = PresenceInfo.fromJson(const <String, dynamic>{});
      expect(empty.running, isEmpty);
      expect(empty.attention, isEmpty);
      expect(empty.unreadResultsCount, 0);
    });

    test('a half-present attention item keeps defaults and stays usable', () {
      final presence = PresenceInfo.fromJson({
        'attention': {
          'items': [
            {'id': 'x'},
          ],
        },
      });

      final item = presence.attention.single;
      expect(item.id, 'x');
      expect(item.goalId, isEmpty);
      expect(item.kind, isEmpty);
      expect(item.title, isEmpty);
      expect(presence.unreadResultsCount, 0);
    });
  });

  group('GatewayClient work/presence/pod endpoints', () {
    test('projects() reads the envelope and keeps the directory id', () async {
      late http.Request captured;
      final client = _client(http_testing.MockClient((request) async {
        captured = request;
        return _json({
          'projects': [
            {'id': _projectDir, 'worktree': _projectDir},
            {'id': r'C:\work\other', 'worktree': r'C:\work\other'},
          ],
        });
      }));

      final projects = await client.projects();

      expect(captured.url.path, '/api/projects');
      expect(captured.headers['Authorization'], 'Bearer t');
      expect(projects.map((p) => p.dir), [_projectDir, r'C:\work\other']);
    });

    test('workOverview() percent-encodes the project directory in the path', () async {
      late http.Request captured;
      final client = _client(http_testing.MockClient((request) async {
        captured = request;
        return _json({
          'projectDir': _projectDir,
          'podId': 'pod-1',
          'groups': {
            'needs_you': [],
            'queued': [],
            'in_progress': [
              {'goalId': 'g1', 'title': '跑着', 'status': 'active', 'bucket': 'in_progress'},
            ],
            'result_ready': [],
            'ended': [],
          },
          'counts': {
            'needs_you': 0,
            'queued': 0,
            'in_progress': 1,
            'result_ready': 0,
            'ended': 0,
          },
          'total': 1,
        });
      }));

      final overview = await client.workOverview(_projectDir);

      expect(captured.url.pathSegments, ['api', 'projects', _projectDir, 'work']);
      expect(captured.url.toString(), contains('/api/projects/C%3A%5Cwork%5Cproj/work'));
      expect(overview.groups['in_progress']!.single.title, '跑着');
      expect(overview.counts['in_progress'], 1);
    });

    test('workOverview() 404 says the project has no Pod (not a generic failure)', () async {
      final client = _client(http_testing.MockClient((request) async {
        return _json({'error': 'pod not found'}, 404);
      }));

      expect(
        client.workOverview(_projectDir),
        throwsA(
          isA<GatewayException>().having(
            (e) => e.message,
            'message',
            allOf(contains('workOverview'), contains('no Pod')),
          ),
        ),
      );
    });

    test('presence() parses the cross-project aggregate', () async {
      late http.Request captured;
      final client = _client(http_testing.MockClient((request) async {
        captured = request;
        return _json({
          'running': [
            {'goalId': 'g1', 'title': '跑着'},
          ],
          'attention': {
            'count': 0,
            'items': <dynamic>[],
          },
          'unreadResults': {'count': 0, 'latest': null},
        });
      }));

      final presence = await client.presence();

      expect(captured.url.path, '/api/presence');
      expect(presence.running, ['跑着']);
      expect(presence.attention, isEmpty);
      expect(presence.unreadResultsCount, 0);
    });

    test('listPodGoals() reads items from /api/pods/:id/goals', () async {
      late http.Request captured;
      final client = _client(http_testing.MockClient((request) async {
        captured = request;
        return _json({
          'items': [
            {
              'goalId': 'g1',
              'title': '目标一',
              'status': 'active',
              'bucket': 'needs_you',
              'revision': 1,
              'verdict': 'FAIL',
              'resultReady': false,
              'strategy': 'collaborative',
              'stage': {'owner': 'person', 'kind': 'blocked'},
            },
          ],
        });
      }));

      final goals = await client.listPodGoals('pod-1');

      expect(captured.url.path, '/api/pods/pod-1/goals');
      expect(goals.single.goalId, 'g1');
      expect(goals.single.verdict, 'FAIL');
      expect(goals.single.stageOwner, 'person');
      expect(goals.single.stageKind, 'blocked');
    });

    test('podLookup() returns null on 404 and rethrows every other failure', () async {
      final missing = _client(http_testing.MockClient((request) async {
        return _json({'error': 'pod not found'}, 404);
      }));
      expect(await missing.podLookup(_projectDir), isNull);

      final broken = _client(http_testing.MockClient((request) async {
        return _json({'error': 'boom'}, 500);
      }));
      expect(
        broken.podLookup(_projectDir),
        throwsA(isA<GatewayException>()),
      );
    });

    test('podLookup() parses the Pod detail envelope', () async {
      late http.Request captured;
      final client = _client(http_testing.MockClient((request) async {
        captured = request;
        return _json({
          'pod': {
            'id': 'pod-1',
            'projectDir': _projectDir,
            'name': 'proj',
            'status': 'active',
            'activeGoalId': 'g1',
          },
          'members': <dynamic>[],
          'goals': [
            {'goalId': 'g1', 'title': '目标一', 'status': 'active', 'bucket': 'in_progress'},
          ],
          'tasks': <dynamic>[],
          'sessions': <dynamic>[],
          'attention': [
            {'id': 'g1:question:r1', 'goalId': 'g1', 'revision': 1, 'kind': 'question', 'title': '目标一'},
          ],
          'messageHealth': <dynamic>[],
        });
      }));

      final pod = await client.podLookup(_projectDir);

      expect(captured.url.pathSegments, ['api', 'projects', _projectDir, 'pod', 'lookup']);
      expect(pod, isNotNull);
      expect(pod!.id, 'pod-1');
      expect(pod.projectDir, _projectDir);
      expect(pod.name, 'proj');
      expect(pod.status, 'active');
      expect(pod.activeGoalId, 'g1');
      expect(pod.goals.single.goalId, 'g1');
      expect(pod.attention.single.kind, 'question');
    });

    test('podEnsure() POSTs to the project pod endpoint', () async {
      late http.Request captured;
      final client = _client(http_testing.MockClient((request) async {
        captured = request;
        return _json({'pod': {'id': 'pod-1', 'projectDir': _projectDir}});
      }));

      await client.podEnsure(_projectDir);

      expect(captured.method, 'POST');
      expect(captured.url.pathSegments, ['api', 'projects', _projectDir, 'pod']);
    });

    test('ensureLeadSessionId() returns the sessionId from lead/ensure', () async {
      late http.Request captured;
      final client = _client(http_testing.MockClient((request) async {
        captured = request;
        return _json({
          'podId': 'pod-1',
          'projectDir': _projectDir,
          'sessionId': 'ses_lead',
        });
      }));

      final sessionId = await client.ensureLeadSessionId('pod-1');

      expect(captured.method, 'POST');
      expect(captured.url.path, '/api/pods/pod-1/lead/ensure');
      expect(sessionId, 'ses_lead');
    });
  });
}
