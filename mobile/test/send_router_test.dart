/// Orcalore 发送分流纪律（Task 12）。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.6（发送路由纪律）/ §9（讨论视图绝不调 `sendEnriched` 的契约测试）。
/// Plan: `docs/superpowers/plans/2026-11-05-mobile-app-v1.md` Task 12.
///
/// Contract pinned here（实读 gateway 路由，不按草图猜）：
/// - **硬约束**：Goal 绑定视图（Tech Lead 讨论）的发送只走
///   `POST /api/pods/:podId/goals/:goalId/tech-lead/messages {text}` ——
///   直接 `promptAsync` / `/api/chat/enriched` 会丢 Tech Lead agent 绑定与
///   revision 的 ContextManifest（`gateway/src/core/pod/pod-tech-lead-service.ts`
///   `prompt()`），所以 `SendRouter` 对 goalBound 视图**永不**返回 enriched 通道。
/// - goalBound 视图缺 `podId` / `goalId` 时 **fail-closed**：本地报
///   [SendRouteException]，一个请求都不发（绝不回退 enriched 兜底）。
/// - 普通会话视图仍走 `POST /api/chat/enriched`，并把服务端返回的 sessionID
///   （Manager 重定向时可能不同）交给调用方。
/// - 文本原样发送（client 层不做 trim：服务端 `text is required` 是唯一校验）。
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart' as http_testing;

import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';
import 'package:orcalore_mobile/src/services/send_router.dart';

const String _podId = 'pod-1';
const String _goalId = 'g1';
const String _sessionId = 'ses_tech_lead';
const String _token = 'test-token';

// ── Fake gateway（真 GatewayClient + MockClient：路径/载荷都可断言）────────────

class _Call {
  final String method;
  final String path;
  final String body;

  const _Call(this.method, this.path, this.body);

  Map<String, dynamic> get json => body.isEmpty
      ? const <String, dynamic>{}
      : jsonDecode(body) as Map<String, dynamic>;
}

typedef _Reply = http.Response Function(http.Request request);

class _FakeGateway {
  final Map<String, _Reply> _routes = <String, _Reply>{};
  final List<_Call> calls = <_Call>[];

  late final GatewayClient client = GatewayClient(
    const ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: _token),
    httpClient: http_testing.MockClient(_handle),
  );

  void on(String method, String path, _Reply reply) {
    _routes['$method $path'] = reply;
  }

  Future<http.Response> _handle(http.Request request) async {
    final path = '/${request.url.pathSegments.join('/')}';
    calls.add(_Call(request.method, path, request.body));
    final reply = _routes['${request.method} $path'];
    if (reply == null) {
      return _json({'error': 'unexpected ${request.method} $path'}, 500);
    }
    return reply(request);
  }
}

http.Response _json(Object body, [int status = 200]) => http.Response(
      jsonEncode(body),
      status,
      headers: {'content-type': 'application/json'},
    );

void main() {
  group('SendRouter.resolve — channel contract', () {
    test('a goal-bound view resolves to the tech-lead channel', () {
      expect(
        SendRouter.resolve(const SendView.techLead(podId: _podId, goalId: _goalId)),
        SendChannel.techLead,
      );
    });

    test('an ordinary chat view resolves to the enriched channel', () {
      expect(
        SendRouter.resolve(const SendView.chat(sessionID: 'ses-1')),
        SendChannel.enriched,
      );
    });

    test('a goal-bound view can NEVER resolve to enriched (negative contract)', () {
      // 任意 goalBound 形态（含带 sessionID 的畸形输入）都必须是 techLead。
      const views = <SendView>[
        SendView(goalBound: true),
        SendView(goalBound: true, podId: _podId, goalId: _goalId),
        SendView(goalBound: true, podId: _podId, goalId: _goalId, sessionID: 'ses-1'),
        SendView(goalBound: true, sessionID: _sessionId),
      ];
      for (final view in views) {
        final channel = SendRouter.resolve(view);
        expect(channel, SendChannel.techLead, reason: '$view');
        expect(channel, isNot(SendChannel.enriched), reason: '$view');
      }
    });
  });

  group('SendRouter.send — dispatch', () {
    test('goal-bound send posts tech-lead/messages and never touches chat/enriched',
        () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/tech-lead/messages',
          (_) => _json({
            'goalId': _goalId,
            'revision': 2,
            'sessionID': _sessionId,
            'text': '我倾向方案 A',
          }),
        );
      final router = SendRouter(gateway.client);

      final outcome = await router.send(
        const SendView.techLead(podId: _podId, goalId: _goalId),
        '我倾向方案 A',
      );

      expect(outcome.channel, SendChannel.techLead);
      // 讨论页没有「回复被重定向到新会话」的语义。
      expect(outcome.sessionID, isNull);

      expect(gateway.calls.map((c) => '${c.method} ${c.path}'), [
        'POST /api/pods/$_podId/goals/$_goalId/tech-lead/messages',
      ]);
      expect(gateway.calls.single.json, {'text': '我倾向方案 A'});
      // 负断言：任何形态的 enriched 请求都没有发生。
      expect(gateway.calls.any((c) => c.path == '/api/chat/enriched'), isFalse);
    });

    test('the text is forwarded verbatim (no local trimming)', () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/pods/$_podId/goals/$_goalId/tech-lead/messages',
          (_) => _json({'goalId': _goalId}),
        );

      await SendRouter(gateway.client).send(
        const SendView.techLead(podId: _podId, goalId: _goalId),
        '  保留前后空白  ',
      );

      expect(gateway.calls.single.json, {'text': '  保留前后空白  '});
    });

    test('a goal-bound send without podId/goalId fails closed (no request, no enriched fallback)',
        () async {
      final gateway = _FakeGateway();

      await expectLater(
        SendRouter(gateway.client).send(const SendView(goalBound: true), 'hi'),
        throwsA(isA<SendRouteException>()),
      );

      expect(gateway.calls, isEmpty);
    });

    test('a chat send posts chat/enriched and returns the (possibly redirected) session',
        () async {
      final gateway = _FakeGateway()
        ..on(
          'POST',
          '/api/chat/enriched',
          (_) => _json({'sessionID': 'ses-redirected'}),
        );

      final outcome = await SendRouter(gateway.client).send(
        const SendView.chat(sessionID: 'ses-1'),
        '你好',
      );

      expect(outcome.channel, SendChannel.enriched);
      expect(outcome.sessionID, 'ses-redirected');
      expect(gateway.calls.single.path, '/api/chat/enriched');
      expect(gateway.calls.single.json, {'message': '你好', 'sessionID': 'ses-1'});
    });

    test('a chat send without a session omits the field', () async {
      final gateway = _FakeGateway()
        ..on('POST', '/api/chat/enriched', (_) => _json({'sessionID': 'ses-new'}));

      final outcome = await SendRouter(gateway.client).send(const SendView.chat(), '你好');

      expect(gateway.calls.single.json, {'message': '你好'});
      expect(outcome.sessionID, 'ses-new');
    });
  });
}
