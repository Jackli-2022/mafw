// Basic smoke test: the app boots to the sessions page shell.
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:orcalore_mobile/main.dart';

void main() {
  setUp(() {
    // The 工作 tab persists its active project (Task 7).
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets('app boots', (WidgetTester tester) async {
    await tester.pumpWidget(const MafwMobileApp());
    await tester.pump(const Duration(milliseconds: 100));
    // Should reach either the connecting spinner or the sessions page.
    expect(tester.takeException(), isNull);
  });
}
