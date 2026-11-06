/// Connection settings page for the MAFW mobile app.
///
/// This is a simplified version of the ConnectionSettingsPage for testing purposes.
library;

import 'package:flutter/material.dart';

import '../config/connection_config.dart';
import '../network/gateway_client.dart';
import '../services/secure_config_store.dart';

/// Connection setup: gateway base URL + API token, with a connectivity test.
class ConnectionSettingsPage extends StatefulWidget {
  final ConnectionConfig initial;
  final Future<void> Function(ConnectionConfig) onSaved;

  const ConnectionSettingsPage({super.key, required this.initial, required this.onSaved});

  @override
  State<ConnectionSettingsPage> createState() => _ConnectionSettingsPageState();
}

class _ConnectionSettingsPageState extends State<ConnectionSettingsPage> {
  late final TextEditingController _urlCtrl;
  late final TextEditingController _tokenCtrl;
  late UrlCheck _urlCheck;
  bool _testing = false;
  String? _testResult;

  @override
  void initState() {
    super.initState();
    _urlCtrl = TextEditingController(text: widget.initial.baseUrl);
    _tokenCtrl = TextEditingController(text: widget.initial.apiToken);
    _urlCheck = checkBaseUrl(widget.initial.baseUrl);
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _tokenCtrl.dispose();
    super.dispose();
  }

  bool get _blocked =>
      _urlCheck == UrlCheck.invalid || _urlCheck == UrlCheck.publicPlaintext;

  String? get _urlHint {
    if (_urlCtrl.text.trim().isEmpty) return null;
    return switch (_urlCheck) {
      UrlCheck.ok => null,
      UrlCheck.bareIpWarn =>
        '提示：建议改用 MagicDNS 主机名（http://<机器名>.<tailnet>.ts.net:3000）。裸 IP 明文仅建议调试使用。',
      UrlCheck.plaintextLanWarn =>
        '警告：局域网明文连接，仅限可信网络。远程访问请使用 Tailscale（https 或 *.ts.net 主机名）。',
      UrlCheck.publicPlaintext =>
        '公网地址不允许明文 http：请使用 https，或 Tailscale / 局域网地址（应用层策略，仅放行 ts.net 与私网明文）。',
      UrlCheck.invalid => '地址无效：需以 http:// 或 https:// 开头，并包含主机名（如 http://pc.tailnet.ts.net:3000）。',
    };
  }

  Color get _urlHintColor => switch (_urlCheck) {
        UrlCheck.ok => Colors.green.shade700,
        UrlCheck.bareIpWarn || UrlCheck.plaintextLanWarn => Colors.orange.shade800,
        UrlCheck.publicPlaintext || UrlCheck.invalid => Colors.red.shade700,
      };

  Future<void> _test() async {
    if (_blocked) {
      setState(() => _testResult = '✗ 地址无效或不允许明文公网连接，无法测试');
      return;
    }
    setState(() {
      _testing = true;
      _testResult = null;
    });
    final cfg = ConnectionConfig(baseUrl: _urlCtrl.text.trim(), apiToken: _tokenCtrl.text.trim());
    final ok = await GatewayClient(cfg).health();
    if (!mounted) return;
    setState(() {
      _testing = false;
      _testResult = ok ? '✓ 连接成功' : '✗ 无法连接（检查地址/网络）';
    });
  }

  Future<void> _save() async {
    if (_blocked || _urlCtrl.text.trim().isEmpty) {
      setState(() => _testResult = '✗ 请先填写有效的 Gateway 地址（公网明文 http 不允许）');
      return;
    }
    final cfg = ConnectionConfig(baseUrl: _urlCtrl.text.trim(), apiToken: _tokenCtrl.text.trim());
    await SecureConfigStore().save(cfg);
    await widget.onSaved(cfg);
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('连接 Gateway')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('电脑上的 Orcalore Gateway 地址',
              style: TextStyle(fontSize: 13, color: Colors.grey)),
          const SizedBox(height: 6),
          TextField(
            controller: _urlCtrl,
            keyboardType: TextInputType.url,
            onChanged: (value) => setState(() => _urlCheck = checkBaseUrl(value)),
            decoration: const InputDecoration(
              labelText: 'Base URL',
              hintText: 'http://<机器名>.<tailnet>.ts.net:3000（MagicDNS 主机名优先）',
              border: OutlineInputBorder(),
            ),
          ),
          if (_urlHint != null) ...[
            const SizedBox(height: 6),
            Text(_urlHint!, style: TextStyle(fontSize: 12, color: _urlHintColor)),
          ],
          const SizedBox(height: 16),
          TextField(
            controller: _tokenCtrl,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'API Token（远程必填）',
              hintText: 'MAFW_SERVER_API_TOKEN 的值',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Expanded(
                child: FilledButton.tonal(
                  onPressed: _testing ? null : _test,
                  child: _testing ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('测试连接'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: _save,
                  child: const Text('保存并连接'),
                ),
              ),
            ],
          ),
          if (_testResult != null) ...[
            const SizedBox(height: 12),
            Text(_testResult!, style: const TextStyle(fontSize: 14)),
          ],
          const SizedBox(height: 24),
          const Text(
            '提示：\n'
            '· 推荐：http://<机器名>.<tailnet>.ts.net:3000（MagicDNS 主机名）\n'
            '· 手机 Tailscale 需保持「Use Tailscale DNS」开启，否则主机名无法解析\n'
            '· 应用层策略：仅允许 https / ts.net / 局域网与 loopback 明文；公网明文 http 会被拒绝\n'
            '· 原生媒体（TTS 等）走 Android 网络栈，ts.net 子域由 network_security_config 放行\n'
            '· 远程访问必须在 gateway 配置 MAFW_SERVER_API_TOKEN（或 server.apiToken）',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }
}
