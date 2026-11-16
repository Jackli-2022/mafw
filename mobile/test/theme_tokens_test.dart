// Orcalore brand foundation — token table + app identity guard.
//
// Spec: docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md §3/§3.1
// Plan: docs/superpowers/plans/2026-11-05-mobile-app-v1.md (Task 1, Global Constraints)
//
// The token values below are the contract for every later task: mint is the only
// chromatic accent, ink/cream carry the chrome, phase badges are neutral.
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orcalore_mobile/main.dart';
import 'package:orcalore_mobile/src/config/app_info.dart';
import 'package:orcalore_mobile/src/theme.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    // Booting the real app mounts the 工作 tab, which persists its active
    // project (Task 7) — install the prefs mock for every test in this file.
    SharedPreferences.setMockInitialValues({});
  });

  group('MafwPalette token table (Orcalore B-mint)', () {
    test('black is the warm near-black Editorial Ink canvas', () {
      expect(MafwPalette.black, const Color(0xFF0A0A0B));
    });

    test('surface is ink #141416', () {
      expect(MafwPalette.surface, const Color(0xFF141416));
    });

    test('border is hairline #232326', () {
      expect(MafwPalette.border, const Color(0xFF232326));
    });

    test('text is warm cream #F4EFE6', () {
      expect(MafwPalette.text, const Color(0xFFF4EFE6));
    });

    test('dim is #8B8B90', () {
      expect(MafwPalette.dim, const Color(0xFF8B8B90));
    });

    test('faint is #58585E', () {
      expect(MafwPalette.faint, const Color(0xFF58585E));
    });

    test('accent is mint #63E6A4 (the only chromatic accent)', () {
      expect(MafwPalette.accent, const Color(0xFF63E6A4));
    });

    test('accentDim is 12% mint', () {
      expect(MafwPalette.accentDim, const Color(0x1F63E6A4));
    });

    test('badgeBg is the neutral surface #17171A', () {
      expect(MafwPalette.badgeBg, const Color(0xFF17171A));
    });

    test('badgeText is warm neutral #C9C4BA', () {
      expect(MafwPalette.badgeText, const Color(0xFFC9C4BA));
    });

    test('kMafwPrimary is the mint accent (AI purple retired)', () {
      expect(kMafwPrimary, const Color(0xFF63E6A4));
      expect(kMafwPrimary, MafwPalette.accent);
    });
  });

  group('MafwType / MafwSpace / MafwRadius scale', () {
    test('type scale is ordered with a display jump', () {
      expect(MafwType.display, greaterThan(MafwType.title));
      expect(MafwType.title, greaterThan(MafwType.heading));
      expect(MafwType.heading, greaterThan(MafwType.body));
      expect(MafwType.body, greaterThan(MafwType.meta));
      expect(MafwType.meta, greaterThan(MafwType.caption));
      expect(MafwType.overline, MafwType.caption);
      expect(MafwType.display, 40);
    });

    test('spacing follows the 4pt grid', () {
      for (final value in [
        MafwSpace.xs,
        MafwSpace.sm,
        MafwSpace.md,
        MafwSpace.lg,
        MafwSpace.xl,
        MafwSpace.xxl,
      ]) {
        expect(value % 4, 0);
      }
    });

    test('radii are the component scale', () {
      expect(MafwRadius.sm, 8);
      expect(MafwRadius.md, 14);
      expect(MafwRadius.lg, 18);
      expect(MafwRadius.pill, 999);
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

    test('onError stays black for 5.4:1 contrast on error red', () {
      expect(mafwDarkTheme().colorScheme.onError, MafwPalette.black);
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
    test('Instrument Serif wordmark font is bundled', () async {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      expect(pubspec, contains('InstrumentSerif-Regular.ttf'));
      final data = await rootBundle.load('assets/fonts/InstrumentSerif-Regular.ttf');
      expect(data.lengthInBytes, greaterThan(1000));
    });

    test('kAppVersion matches pubspec.yaml', () {
      final pubspec = File('pubspec.yaml').readAsStringSync();
      final match = RegExp(r'^version:\s*(\d+\.\d+\.\d+)\+?\d*$', multiLine: true)
          .firstMatch(pubspec);
      expect(match, isNotNull, reason: 'pubspec.yaml has no semver version');
      expect(kAppVersion, match!.group(1));
    });

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
