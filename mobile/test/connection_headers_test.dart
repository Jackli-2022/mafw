import 'package:flutter_test/flutter_test.dart';
import 'package:orcalore_mobile/src/config/connection_config.dart';

void main() {
  test('declares the mobile client channel on every gateway request', () {
    const config = ConnectionConfig(baseUrl: 'http://127.0.0.1:3000', apiToken: '');
    expect(config.headers['X-MAFW-Client'], 'mobile');
  });

  test('keeps the authorization header alongside the channel', () {
    const config = ConnectionConfig(baseUrl: 'https://gw.example.ts.net', apiToken: 'tok');
    expect(config.headers['X-MAFW-Client'], 'mobile');
    expect(config.headers['Authorization'], 'Bearer tok');
  });
}
