import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:http/http.dart' as http;

import '../config/connection_config.dart';
import '../services/secure_config_store.dart';

/// QR code scanner page for gateway pairing.
///
/// Scans a `mafw://pair?url=...&token=...&v=1&exp=...&nonce=...` deep link,
/// verifies the nonce with the gateway, writes credentials to SecureStorage,
/// and returns [ConnectionConfig] on success.
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

  @override
  void initState() {
    super.initState();
    _controller = MobileScannerController(
      detectionSpeed: DetectionSpeed.normal,
      facing: CameraFacing.back,
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
      final result = _parsePairUrl(raw);
      if (result != null) {
        _processing = true;
        _verifyAndConnect(result.url, result.token, result.nonce);
        return;
      }
    }
  }

  ({String url, String token, String nonce})? _parsePairUrl(String raw) {
    try {
      final uri = Uri.parse(raw);
      if (uri.scheme != 'mafw' || uri.host != 'pair') return null;
      final url = uri.queryParameters['url'];
      final token = uri.queryParameters['token'];
      final v = uri.queryParameters['v'];
      final exp = uri.queryParameters['exp'];
      final nonce = uri.queryParameters['nonce'];
      if (url == null || token == null || v != '1' || exp == null || nonce == null) {
        return null;
      }
      // Check expiry
      final expTime = int.tryParse(exp);
      if (expTime == null || DateTime.now().millisecondsSinceEpoch > expTime) {
        if (mounted) setState(() => _error = '配对码已过期');
        return null;
      }
      return (url: url, token: token, nonce: nonce);
    } catch (_) {
      return null;
    }
  }

  Future<void> _verifyAndConnect(String url, String token, String nonce) async {
    // Tailscale https/wss enforced, http only 192.168/10.x with UI warning (spec §5.3)
    if (_isLocalHttpUrl(url)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('警告：使用局域网明文连接，仅限可信网络')),
        );
      }
    } else if (url.startsWith('http://')) {
      if (mounted) {
        setState(() {
          _error = '非可信网络的 http 连接被拒绝，请使用 https (Tailscale)';
          _processing = false;
        });
      }
      return;
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
    if (raw.isEmpty) return;
    final result = _parsePairUrl(raw);
    if (result != null) {
      setState(() => _processing = true);
      _verifyAndConnect(result.url, result.token, result.nonce);
    } else {
      // Raw URL/token fallback: allow plain url+token without mafw:// wrapper (manual fallback per task brief)
      final url = _manualUrlCtrl.text.trim();
      final token = _manualTokenCtrl.text.trim();
      if (url.isNotEmpty) {
        // No nonce verification needed for manual fallback; save directly
        _verifyAndConnect(url, token, '__manual__');
      } else {
        setState(() => _error = '请输入配对链接或 Base URL');
      }
    }
  }

  bool _isLocalHttpUrl(String url) {
    try {
      final uri = Uri.parse(url);
      if (uri.scheme != 'http') return false;
      final host = uri.host;
      return host.startsWith('192.168.') ||
          host.startsWith('10.') ||
          host.startsWith('172.16.');
    } catch (_) {
      return false;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('扫描配对码'),
        backgroundColor: Theme.of(context).colorScheme.inversePrimary,
      ),
      body: Stack(
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
                color: Theme.of(context).colorScheme.surface.withOpacity(0.95),
                padding: const EdgeInsets.all(12),
                child: _showManual
                    ? Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          TextField(
                            controller: _manualUrlCtrl,
                            decoration: const InputDecoration(
                              labelText: '配对链接或 Base URL',
                              hintText: 'mafw://pair?... 或 https://xxx.ts.net:3000',
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
