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
  bool _testing = false;
  String? _testResult;

  @override
  void initState() {
    super.initState();
    _urlCtrl = TextEditingController(text: widget.initial.baseUrl);
    _tokenCtrl = TextEditingController(text: widget.initial.apiToken);
  }

  @override
  void dispose() {
    _urlCtrl.dispose();
    _tokenCtrl.dispose();
    super.dispose();
  }

  Future<void> _test() async {
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
          const Text('电脑上的 MAFW Gateway 地址',
              style: TextStyle(fontSize: 13, color: Colors.grey)),
          const SizedBox(height: 6),
          TextField(
            controller: _urlCtrl,
            keyboardType: TextInputType.url,
            decoration: const InputDecoration(
              labelText: 'Base URL',
              hintText: 'http://192.168.1.5:3000 或 https://xxx.tailnet.ts.net:3000',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _tokenCtrl,
            obscureText: true,
            decoration: const InputDecoration(
              labelText: 'API Token（可选，远程必填）',
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
            '提示：\n· 局域网：直接填电脑 IP:3000\n· 远程：装 Tailscale 后用 tailnet 地址，gateway 需配置 MAFW_SERVER_API_TOKEN',
            style: TextStyle(fontSize: 12, color: Colors.grey),
          ),
        ],
      ),
    );
  }
}
