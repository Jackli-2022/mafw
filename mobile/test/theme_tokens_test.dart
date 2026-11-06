// Orcalore brand foundation — token table + app identity guard.
//
// Spec: docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md §3/§3.1
// Plan: docs/superpowers/plans/2026-11-05-mobile-app-v1.md (Task 1, Global Constraints)
//
// The token values below are the contract for every later task: mint is the only
// chromatic accent, ink/cream carry the chrome, phase badges are neutral.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orcalore_mobile/main.dart';
import 'package:orcalore_mobile/src/theme.dart';

void main() {
  group('MafwPalette token table (Orcalore B-mint)', () {
    test('black is the OLED base background', () {
      expect(MafwPalette.black, const Color(0xFF000000));
    });

    test('surface is ink #1D1F25', () {
      expect(MafwPalette.surface, const Color(0xFF1D1F25));
    });

    test('border is #2A2D36', () {
      expect(MafwPalette.border, const Color(0xFF2A2D36));
    });

    test('text is cream #FCF8F1', () {
      expect(MafwPalette.text, const Color(0xFFFCF8F1));
    });

    test('dim is #9CA3AF', () {
      expect(MafwPalette.dim, const Color(0xFF9CA3AF));
    });

    test('faint is #6B6B72', () {
      expect(MafwPalette.faint, const Color(0xFF6B6B72));
    });

    test('accent is mint #4FD388 (the only chromatic accent)', () {
      expect(MafwPalette.accent, const Color(0xFF4FD388));
    });

    test('accentDim is 13% mint (desktop --accent-dim parity)', () {
      // rgba(79,211,136,.13) -> 0x21 alpha.
      expect(MafwPalette.accentDim, const Color(0x214FD388));
    });

    test('badgeBg is the neutral phase-badge surface #24272F', () {
      expect(MafwPalette.badgeBg, const Color(0xFF24272F));
    });

    test('badgeText is the neutral phase-badge foreground #C9C9D4', () {
      expect(MafwPalette.badgeText, const Color(0xFFC9C9D4));
    });

    test('kMafwPrimary is the mint accent (AI purple retired)', () {
      expect(kMafwPrimary, const Color(0xFF4FD388));
      expect(kMafwPrimary, MafwPalette.accent);
    });
  });

  group('Orcalore Material theme wiring', () {
    test('dark theme paints mint primary on ink surfaces', () {
      final theme = mafwDarkTheme();
      expect(theme.colorScheme.primary, MafwPalette.accent);
      expect(theme.colorScheme.surface, MafwPalette.surface);
      expect(theme.colorScheme.onSurface, MafwPalette.text);
      expect(theme.colorScheme.outline, MafwPalette.border);
      expect(theme.scaffoldBackgroundColor, MafwPalette.black);
      expect(theme.floatingActionButtonTheme.backgroundColor, MafwPalette.text);
      expect(theme.floatingActionButtonTheme.foregroundColor, MafwPalette.black);
    });

    test('light hook also returns the single dark Orcalore theme (v1)', () {
      // v1 ships one dark theme (spec §3: 「深色极简」); the light hook stays as
      // an API-compatible alias so MaterialApp's system mode cannot fall back to
      // a stray purple/white palette on light-mode devices.
      expect(mafwLightTheme().colorScheme.primary, MafwPalette.accent);
      expect(mafwLightTheme().colorScheme.surface, MafwPalette.surface);
      expect(mafwLightTheme().scaffoldBackgroundColor, MafwPalette.black);
    });
  });

  testWidgets('MaterialApp title is Orcalore', (WidgetTester tester) async {
    await tester.pumpWidget(const MafwMobileApp());
    await tester.pump(const Duration(milliseconds: 100));
    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.title, 'Orcalore');
  });

  group('app identity files', () {
    test('pubspec declares the orcalore_mobile package name', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      expect(
        pubspec,
        contains(RegExp(r'^name: orcalore_mobile$', multiLine: true)),
      );
    });

    test('Android manifest labels the launcher as Orcalore', () {
      final manifest =
          File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
      expect(manifest, contains('android:label="Orcalore"'));
    });

    test('Android namespace and applicationId are ai.orcalore.mobile', () {
      final gradle =
          File('android/app/build.gradle.kts').readAsStringSync();
      expect(gradle, contains('namespace = "ai.orcalore.mobile"'));
      expect(gradle, contains('applicationId = "ai.orcalore.mobile"'));
    });

    test('launcher icon uses the ink adaptive background', () {
      final background =
          File('android/app/src/main/res/values/ic_launcher_background.xml')
              .readAsStringSync();
      expect(background, contains('name="ic_launcher_background"'));
      expect(background.toUpperCase(), contains('#1D1F25'));

      final adaptive =
          File('android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml')
              .readAsStringSync();
      expect(adaptive, contains('@mipmap/ic_launcher_foreground'));
      expect(adaptive, contains('@mipmap/ic_launcher_monochrome'));
    });
  });
}
