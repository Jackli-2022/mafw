import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:http/http.dart' as http;

import '../config/connection_config.dart';
import '../config/pairing_link.dart';
import '../services/mdns_discovery.dart';

/// QR code scanner page for gateway pairing.
///
/// Scans an `orcalore://pair?url=...&token=...&v=1&exp=...&nonce=...` deep link,
/// verifies the nonce with the gateway, writes credentials to SecureStorage,
/// and returns [ConnectionConfig] on success. The legacy `mafw://pair` scheme
/// is rejected (see `pairing_link.dart`).
///
/// P1: Auto-discovers gateways on LAN via mDNS before showing the scanner.
class PairingPage extends StatefulWidget {
  const PairingPage({super.key});

  @override
  State<PairingPage> createState() => _PairingPageState();
}

class _PairingPageState extends State<PairingPage> {
  MobileScannerController? _controller;
  bool _processing = false;
  String? _error;
  StreamSubscription? _subscription;
  bool _showManual = false;
  final _manualUrlCtrl = TextEditingController();
  final _manualTokenCtrl = TextEditingController();

  // mDNS auto-discovery (P1: zero-config LAN)
  List<DiscoveredGateway> _discovered = [];
  bool _scanning = true;

  @override
  void initState() {
    super.initState();
    _controller = MobileScannerController(
      detectionSpeed: DetectionSpeed.normal,
      facing: CameraFacing.back,
    );
    _scanLan();
  }

  Future<void> _scanLan() async {
    final discovery = MdnsDiscovery();
    final gateways = await discovery.scan(timeout: const Duration(seconds: 4));
    if (!mounted) return;
    setState(() {
      _discovered = gateways;
      _scanning = false;
    });
  }

  void _onDiscoverTap(DiscoveredGateway gw) {
    // mDNS gives us URL but no token — user still needs to pair via QR
    // to get the nonce-verified token. Pre-fill manual entry with discovered URL.
    _manualUrlCtrl.text = gw.url;
    setState(() => _showManual = true);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('已发现 ${gw.name}，请输入 Token 连接'),
        duration: const Duration(seconds: 2),
      ),
    );
  }

  @override
  void dispose() {
    _subscription?.cancel();
    _manualUrlCtrl.dispose();
    _manualTokenCtrl.dispose();
    _controller?.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_processing) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null) continue;
      final result = parsePairingLink(raw);
      if (result.ok) {
        _processing = true;
        final link = result.link!;
        _verifyAndConnect(link.url, link.token, link.nonce);
        return;
      }
      if (result.isExpired) {
        if (mounted) setState(() => _error = '配对码已过期');
      } else if (raw.contains('://')) {
        if (mounted) setState(() => _error = '配对链接无效（仅支持 orcalore://pair）');
      }
    }
  }

  Future<void> _verifyAndConnect(String url, String token, String nonce) async {
    // Spec §6: https is always safe; http is accepted for ts.net / loopback /
    // trusted LAN only, with the same hostname advice as the settings form.
    switch (checkBaseUrl(url)) {
      case UrlCheck.invalid:
        if (mounted) {
          setState(() {
            _error = '连接地址无效：请使用 http(s):// 主机名:端口（推荐 MagicDNS 主机名 *.ts.net）';
            _processing = false;
          });
        }
        return;
      case UrlCheck.bareIpWarn:
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('提示：裸 IP 明文连接，建议改用 MagicDNS 主机名（*.ts.net）')),
          );
        }
        break;
      case UrlCheck.plaintextLanWarn:
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('警告：使用局域网明文连接，仅限可信网络')),
          );
        }
        break;
      case UrlCheck.ok:
        break;
    }

    try {
      // Manual fallback skips nonce verification (no nonce to redeem)
      if (nonce != '__manual__') {
        final verifyUri = Uri.parse('$url/api/mobile/pairing/verify');
        final verifyRes = await http.post(
          verifyUri,
          headers: {
            'Content-Type': 'application/json',
            if (token.isNotEmpty) 'Authorization': 'Bearer $token',
          },
          body: jsonEncode({'nonce': nonce}),
        );

        if (verifyRes.statusCode != 200) {
          if (!mounted) return;
          setState(() {
            _error = '配对验证失败: ${verifyRes.statusCode}';
            _processing = false;
          });
          return;
        }
      }

      // Save credentials via SecureConfigStore (token → flutter_secure_storage)
      final config = ConnectionConfig(baseUrl: url, apiToken: token);
      await config.save();
      if (!mounted) return;
      Navigator.of(context).pop<ConnectionConfig>(config);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '保存配对信息失败: $e';
        _processing = false;
      });
    }
  }

  void _onManualSubmit() {
    final raw = _manualUrlCtrl.text.trim();
    if (raw.isEmpty) {
      setState(() => _error = '请输入配对链接或 Base URL');
      return;
    }

    final result = parsePairingLink(raw);
    if (result.ok) {
      setState(() => _processing = true);
      final link = result.link!;
      _verifyAndConnect(link.url, link.token, link.nonce);
      return;
    }

    // A deep link with a non-http(s) scheme can only be a (wrong/expired)
    // pairing link — surface that instead of treating it as a base URL.
    final looksLikeDeepLink =
        raw.contains('://') && !raw.startsWith('http://') && !raw.startsWith('https://');
    if (looksLikeDeepLink) {
      setState(() => _error = result.isExpired ? '配对码已过期' : '配对链接无效（仅支持 orcalore://pair）');
      return;
    }

    // Raw URL/token fallback: allow plain url+token without the orcalore:// wrapper.
    _verifyAndConnect(raw, _manualTokenCtrl.text.trim(), '__manual__');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('扫描配对码'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: Column(
        children: [
          // mDNS discovered gateways (P1: zero-config LAN)
          if (_discovered.isNotEmpty || _scanning)
            Container(
              color: Theme.of(context).colorScheme.primaryContainer,
              padding: const EdgeInsets.all(8),
              child: _scanning
                  ? const Row(
                      children: [
                        SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        SizedBox(width: 8),
                        Text('正在扫描局域网...', style: TextStyle(fontSize: 13)),
                      ],
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '发现 ${_discovered.length} 个网关：',
                          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
                        ),
                        const SizedBox(height: 4),
                        ..._discovered.map((gw) => ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(Icons.dns, size: 20),
                              title: Text(gw.name, style: const TextStyle(fontSize: 14)),
                              subtitle: Text(gw.url, style: const TextStyle(fontSize: 12)),
                              trailing: const Icon(Icons.chevron_right, size: 18),
                              onTap: () => _onDiscoverTap(gw),
                            )),
                      ],
                    ),
            ),
          // QR scanner (fills remaining space)
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                MobileScanner(
                  controller: _controller,
                  onDetect: _onDetect,
                ),
                // Overlay with scan area
                CustomPaint(
                  painter: _ScanOverlay(),
                ),
                if (_processing)
                  const Center(
                    child: Card(
                      child: Padding(
                        padding: EdgeInsets.all(24),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            CircularProgressIndicator(),
                            SizedBox(height: 16),
                            Text('正在连接...'),
                          ],
                        ),
                      ),
                    ),
                  ),
                if (_error != null)
                  Positioned(
                    bottom: 40,
                    left: 20,
                    right: 20,
                    child: Card(
                      color: Theme.of(context).colorScheme.errorContainer,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text(
                          _error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.onErrorContainer,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ),
                    ),
                  ),
                Positioned(
                  bottom: 0,
                  left: 0,
                  right: 0,
                  child: SafeArea(
                    child: Container(
                      color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.95),
                      padding: const EdgeInsets.all(12),
                      child: _showManual
                          ? Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                TextField(
                                  controller: _manualUrlCtrl,
                                  decoration: const InputDecoration(
                                    labelText: '配对链接或 Base URL',
                                    hintText: 'orcalore://pair?... 或 https://xxx.ts.net:3000',
                                    border: OutlineInputBorder(),
                                    isDense: true,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                TextField(
                                  controller: _manualTokenCtrl,
                                  obscureText: true,
                                  decoration: const InputDecoration(
                                    labelText: 'Token（手动回退时可填）',
                                    border: OutlineInputBorder(),
                                    isDense: true,
                                  ),
                                ),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    TextButton(
                                      onPressed: () => setState(() => _showManual = false),
                                      child: const Text('返回扫码'),
                                    ),
                                    const Spacer(),
                                    FilledButton(
                                      onPressed: _onManualSubmit,
                                      child: const Text('连接'),
                                    ),
                                  ],
                                ),
                              ],
                            )
                          : Align(
                              alignment: Alignment.centerRight,
                              child: TextButton.icon(
                                onPressed: () => setState(() => _showManual = true),
                                icon: const Icon(Icons.keyboard, size: 18),
                                label: const Text('手动输入'),
                              ),
                            ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ScanOverlay extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.black54
      ..style = PaintingStyle.fill;

    final scanWidth = size.width * 0.7;
    final scanHeight = scanWidth;
    final left = (size.width - scanWidth) / 2;
    final top = (size.height - scanHeight) / 3;

    // Draw dark overlay with cutout
    final path = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height))
      ..addRect(Rect.fromLTWH(left, top, scanWidth, scanHeight))
      ..fillType = PathFillType.evenOdd;
    canvas.drawPath(path, paint);

    // Draw scan frame border
    final borderPaint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    canvas.drawRect(Rect.fromLTWH(left, top, scanWidth, scanHeight), borderPaint);

    // Draw hint text
    final textPainter = TextPainter(
      text: const TextSpan(
        text: '将二维码放入框内',
        style: TextStyle(color: Colors.white, fontSize: 14),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    textPainter.paint(
      canvas,
      Offset((size.width - textPainter.width) / 2, top + scanHeight + 16),
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
