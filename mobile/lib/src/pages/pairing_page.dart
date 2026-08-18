import 'dart:async';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../config/connection_config.dart';
import '../services/secure_config_store.dart';

/// QR code scanner page for gateway pairing.
///
/// Scans a `mafw://pair?url=...&token=...&v=1&exp=...&nonce=...` deep link,
/// writes credentials to SecureStorage, and returns [ConnectionConfig] on success.
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
    _controller?.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_processing) return;
    for (final barcode in capture.barcodes) {
      final raw = barcode.rawValue;
      if (raw == null) continue;
      final config = _parsePairUrl(raw);
      if (config != null) {
        _processing = true;
        _connect(config);
        return;
      }
    }
  }

  ConnectionConfig? _parsePairUrl(String raw) {
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
      return ConnectionConfig(baseUrl: url, apiToken: token);
    } catch (_) {
      return null;
    }
  }

  Future<void> _connect(ConnectionConfig config) async {
    try {
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
