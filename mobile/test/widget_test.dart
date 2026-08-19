// Basic smoke test: the app boots to the sessions page shell.
import 'package:flutter_test/flutter_test.dart';

import 'package:mafw_mobile/main.dart';

void main() {
  testWidgets('app boots', (WidgetTester tester) async {
    await tester.pumpWidget(const MafwMobileApp());
    await tester.pump(const Duration(milliseconds: 100));
    // Should reach either the connecting spinner or the sessions page.
    expect(tester.takeException(), isNull);
  });
}
