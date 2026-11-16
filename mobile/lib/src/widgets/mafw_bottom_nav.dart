import 'package:flutter/material.dart';

import '../theme.dart';

/// Editorial Ink 底部导航：细线图标 + 9px 标签 + 激活项 mint 点。
///
/// 刻意不用 Material `NavigationBar`：它的 pill 指示器是当前界面显得
/// “默认 Flutter”的主要来源之一。这里只有 hairline、文字与一个 3px 点。
class MafwBottomNav extends StatelessWidget {
  static const List<String> labels = ['工作', '聊天', '我的'];

  static const List<IconData> _icons = [
    Icons.grid_view_outlined,
    Icons.chat_bubble_outline,
    Icons.person_outline,
  ];

  final int selectedIndex;
  final ValueChanged<int> onSelected;

  const MafwBottomNav({
    super.key,
    required this.selectedIndex,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: MafwPalette.black,
        border: Border(top: BorderSide(color: MafwPalette.border)),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 64,
          child: Row(
            children: [
              for (var i = 0; i < labels.length; i++)
                Expanded(child: _item(i)),
            ],
          ),
        ),
      ),
    );
  }

  Widget _item(int index) {
    final selected = index == selectedIndex;
    final color = selected ? MafwPalette.text : MafwPalette.faint;
    return Semantics(
      button: true,
      selected: selected,
      label: '${labels[index]}，第 ${index + 1} 个，共 ${labels.length} 个',
      excludeSemantics: true,
      child: InkResponse(
        key: Key('tab-${labels[index]}'),
        onTap: () => onSelected(index),
        radius: 32,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(_icons[index], size: 19, color: color),
            const SizedBox(height: 5),
            Text(
              labels[index],
              style: TextStyle(
                fontSize: 9,
                height: 1,
                letterSpacing: 0.6,
                color: color,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
            const SizedBox(height: 4),
            // 3px 点只标记当前 tab；不是通知红点，也不做 pill 背景。
            Container(
              width: 3,
              height: 3,
              decoration: BoxDecoration(
                color: selected ? MafwPalette.accent : Colors.transparent,
                shape: BoxShape.circle,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
