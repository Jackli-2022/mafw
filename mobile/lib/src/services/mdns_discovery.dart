/// mDNS/DNS-SD discovery service for auto-finding MAFW Gateways on LAN.
///
/// Listens for `_mafw._tcp` service announcements (broadcast by gateway).
/// Returns discovered gateways with IP + port + auth requirement.
///
/// Usage:
/// ```dart
/// final discovery = MdnsDiscovery();
/// final gateways = await discovery.scan(timeout: Duration(seconds: 5));
/// // gateways: [DiscoveredGateway(name: 'MAFW Desktop', url: 'http://192.168.1.42:3000', authRequired: true)]
/// ```
library;

import 'dart:async';
import 'dart:io';

import 'package:multicast_dns/multicast_dns.dart';

class DiscoveredGateway {
  final String name;
  final String host;
  final int port;
  final bool authRequired;
  final String url;

  DiscoveredGateway({
    required this.name,
    required this.host,
    required this.port,
    required this.authRequired,
  }) : url = 'http://$host:$port';

  @override
  String toString() => 'DiscoveredGateway($name @ $url, auth=$authRequired)';
}

class MdnsDiscovery {
  static const String _serviceType = '_mafw._tcp.local';

  /// Scan LAN for MAFW Gateways via mDNS.
  ///
  /// [timeout] — how long to listen (default 5s). Longer = more thorough but slower.
  /// Returns list of discovered gateways (may be empty if none advertising).
  Future<List<DiscoveredGateway>> scan({
    Duration timeout = const Duration(seconds: 5),
  }) async {
    final gateways = <String, DiscoveredGateway>{}; // dedupe by host:port
    final client = MDnsClient();

    try {
      await client.start();

      // Query for PTR records → SRV → A (standard DNS-SD flow)
      await for (final ptr in client.lookup<PtrResourceRecord>(
        ResourceRecordQuery.serverPointer(_serviceType),
        timeout: timeout,
      )) {
        final serviceName = ptr.domainName;

        // SRV lookup → host + port
        await for (final srv in client.lookup<SrvResourceRecord>(
          ResourceRecordQuery.service(serviceName),
          timeout: const Duration(seconds: 2),
        )) {
          final host = srv.target;
          final port = srv.port;

          // TXT lookup → metadata (auth requirement, version)
          bool authRequired = true;
          String displayName = serviceName;
          await for (final txt in client.lookup<TxtResourceRecord>(
            ResourceRecordQuery.text(serviceName),
            timeout: const Duration(seconds: 2),
          )) {
            // Parse TXT record: "key=value" pairs separated by newlines or null bytes
            final txtText = txt.text;
            final lines = txtText.split(RegExp(r'[\n\x00]'));
            final attrs = <String, String>{};
            for (final line in lines) {
              final eqIdx = line.indexOf('=');
              if (eqIdx > 0) {
                attrs[line.substring(0, eqIdx)] = line.substring(eqIdx + 1);
              }
            }
            authRequired = attrs['auth'] == 'token';
            if (attrs.containsKey('name')) {
              displayName = attrs['name']!;
            }
          }

          final key = '$host:$port';
          if (!gateways.containsKey(key)) {
            gateways[key] = DiscoveredGateway(
              name: displayName,
              host: host,
              port: port,
              authRequired: authRequired,
            );
          }
        }
      }
    } finally {
      client.stop();
    }

    return gateways.values.toList();
  }
}
