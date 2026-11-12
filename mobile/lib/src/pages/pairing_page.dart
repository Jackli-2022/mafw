import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:http/http.dart' as http;

import '../config/connection_config.dart';
import '../config/device_identity.dart';
import '../config/pairing_flow.dart';
import '../config/pairing_link.dart';
import '../services/background_credentials.dart';
import '../services/mdns_discovery.dart';
import '../services/secure_config_store.dart';

/// QR code scanner page for gateway pairing.
///
/// Scans an `orcalore://pair?...` deep link (`v=2` device-token links or legacy
/// `v=1` links that still embed a shared token), redeems the nonce at
/// `POST /api/mobile/pairing/verify`, writes credentials to SecureStorage, and
/// returns [ConnectionConfig] on success. The legacy `mafw://pair` scheme is
/// rejected (see `pairing_link.dart`).
///
/// P1: Auto-discovers gateways on LAN via mDNS before showing the scanner.
class PairingPage extends StatefulWidget {
  /// Injected HTTP client (tests); production creates its own.
  final http.Client? httpClient;

  /// Injected device-id provider (tests); defaults to [getOrCreateDeviceId].
  final Future<String> Function()? deviceIdProvider;

  /// Injected credential store (tests); defaults to [SecureConfigStore].
  final SecureConfigStore? configStore;

  /// Test overrides for [Platform.operatingSystem] / [Platform.localHostname].
  final String? platform;
  final String? deviceName;

  const PairingPage({
    super.key,
    this.httpClient,
    this.deviceIdProvider,
    this.configStore,
    this.platform,
    this.deviceName,
  });

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

  late final http.Client _http = widget.httpClient ?? http.Client();
  late final SecureConfigStore _store = widget.configStore ?? SecureConfigStore();

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
    if (widget.httpClient == null) _http.close();
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
    // App-layer policy (spec §6): v1 is Tailscale/private only. Public cleartext
    // and malformed URLs are hard-rejected; LAN / bare-IP cleartext still
    // connects with a warning. (Native media is governed separately by the
    // Android NSC ts.net allowlist; Dart/package:http sockets are not NSC-bound.)
    final check = checkBaseUrl(url);
    if (!canPairWithUrl(url)) {
      if (mounted) {
        setState(() {
          _error = check == UrlCheck.publicPlaintext
              ? '公网明文 http 连接被拒绝：请使用 https，或 Tailscale/局域网地址'
              : '连接地址无效：请使用 http(s):// 主机名:端口（推荐 MagicDNS 主机名 *.ts.net）';
          _processing = false;
        });
      }
      return;
    }
    if (check == UrlCheck.bareIpWarn && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('提示：裸 IP 明文连接，建议改用 MagicDNS 主机名（*.ts.net）')),
      );
    } else if (check == UrlCheck.plaintextLanWarn && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('警告：使用局域网明文连接，仅限可信网络')),
      );
    }

    try {
      // Pairing v2: the nonce is the credential and the gateway mints a
      // revocable device token. Manual entry has nothing to redeem.
      final deviceId = nonce == kManualPairingNonce ? '' : await _deviceId();
      final rotate = shouldRotateForPairing(
        existing: await _existingConfig(),
        baseUrl: url,
        nonce: nonce,
      );

      final result = await redeemPairing(
        baseUrl: url,
        linkToken: token,
        nonce: nonce,
        client: _http,
        deviceId: deviceId,
        platform: _platformName(),
        deviceName: _deviceName(),
        rotate: rotate,
      );

      // Save credentials via SecureConfigStore (token → flutter_secure_storage)
      await _store.save(result.config);
      // Keep the WorkManager background copy on the same (device) credential.
      // Best-effort: a background mirror failure must not lose a good pairing.
      try {
        await syncBackgroundCredentials(result.config);
      } catch (_) {}
      if (!mounted) return;
      Navigator.of(context).pop<ConnectionConfig>(result.config);
    } on PairingException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _processing = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '保存配对信息失败: $e';
        _processing = false;
      });
    }
  }

  /// Stable device identity; falling back to empty lets the gateway mint one
  /// (older gateways ignore unknown fields) rather than blocking pairing.
  Future<String> _deviceId() async {
    try {
      final provider = widget.deviceIdProvider;
      return provider != null ? await provider() : await getOrCreateDeviceId();
    } catch (_) {
      return '';
    }
  }

  /// Locally stored credentials, if any (used to decide re-pair rotation).
  Future<ConnectionConfig?> _existingConfig() async {
    try {
      return await _store.load();
    } catch (_) {
      return null;
    }
  }

  String _platformName() {
    final override = widget.platform;
    if (override != null && override.isNotEmpty) return override;
    try {
      return Platform.operatingSystem;
    } catch (_) {
      return 'unknown';
    }
  }

  String _deviceName() {
    final override = widget.deviceName;
    if (override != null && override.isNotEmpty) return override;
    try {
      final host = Platform.localHostname;
      if (host.isNotEmpty) {
        // Gateway bound: DEVICE_NAME_MAX_LENGTH = 100.
        return host.length > 100 ? host.substring(0, 100) : host;
      }
    } catch (_) {}
    return 'Orcalore';
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
    _verifyAndConnect(raw, _manualTokenCtrl.text.trim(), kManualPairingNonce);
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
