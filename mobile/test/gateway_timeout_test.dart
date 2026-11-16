// 统一请求超时（F 批打磨）：弱网/黑洞网络下所有 GET/POST 默认 20s 兜底，
// 抛可读的 GatewayTimeoutException 而不是无限转圈。
import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:orcalore_mobile/src/config/connection_config.dart';
import 'package:orcalore_mobile/src/network/gateway_client.dart';

GatewayClient _client({Duration? requestTimeout}) => GatewayClient(
      const ConnectionConfig(baseUrl: 'http://127.0.0.1:1', apiToken: ''),
      requestTimeout: requestTimeout ?? const Duration(seconds: 20),
      httpClient: MockClient((_) => Completer<http.Response>().future),
    );

void main() {
  test('GET times out with a friendly GatewayTimeoutException', () async {
    final client = _client(requestTimeout: const Duration(milliseconds: 40));

    await expectLater(
      client.listSessions(),
      throwsA(isA<GatewayTimeoutException>()),
    );
  });

  test('the timeout stays catchable as the standard TimeoutException', () async {
    final client = _client(requestTimeout: const Duration(milliseconds: 40));

    await expectLater(
      client.listSessions(),
      throwsA(isA<TimeoutException>()),
    );
  });

  test('POST times out with the same exception', () async {
    final client = _client(requestTimeout: const Duration(milliseconds: 40));

    await expectLater(
      client.sendEnriched('hi'),
      throwsA(isA<GatewayTimeoutException>()),
    );
  });

  test('the client default request timeout is 20 seconds', () {
    final client = GatewayClient(
      const ConnectionConfig(baseUrl: 'http://127.0.0.1:1', apiToken: ''),
      httpClient: MockClient((_) async => http.Response('{}', 200)),
    );

    expect(client.requestTimeout, const Duration(seconds: 20));
  });
}
