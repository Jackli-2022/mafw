/// Shared chat rendering: message bubbles + Perplexity-style generation phase.
///
/// Single source for both chat surfaces (Task 12):
/// - `pages/chat_page.dart` — ordinary session chat;
/// - `pages/tech_lead_discussion_page.dart` — Tech Lead Goal discussion.
///
/// Palette discipline (spec §3): user messages are a neutral ink pill
/// (`MafwPalette.badgeBg`), assistant messages are full-width document text
/// (`scheme.onSurface`); mint is reserved for active state / CTA / 需要你, so the
/// phase bar only tints the *writing* stage with the accent.
library;

import 'package:flutter/material.dart';

import '../models/mafw_models.dart';
import '../theme.dart';

/// Perplexity 式流式阶段：idle → searching → writing →（done = idle，隐藏）。
///
/// searching = 已发送待处理；writing = 收到 part 增量（生成中）。
enum GenPhase { idle, searching, writing }

/// One message bubble.
///
/// `user` → right-aligned neutral ink pill; anything else (assistant) →
/// full-width document text. Text is selectable on both (copy from the OS
/// selection menu).
class MafwMessageBubble extends StatelessWidget {
  final MafwMessage msg;

  const MafwMessageBubble({super.key, required this.msg});

  @override
  Widget build(BuildContext context) {
    final isUser = msg.role == 'user';
    final text = msg.text ?? '';
    final scheme = Theme.of(context).colorScheme;

    if (isUser) {
      // 用户消息：中性 ink pill（Orcalore accent 纪律：mint 只给需要你/CTA/激活/进行中）
      return Align(
        alignment: Alignment.centerRight,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
          constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.82),
          decoration: BoxDecoration(
            color: MafwPalette.badgeBg,
            borderRadius: BorderRadius.circular(18),
          ),
          child: SelectableText(
            text,
            style: const TextStyle(color: MafwPalette.text, fontSize: 15, height: 1.45),
          ),
        ),
      );
    }

    // AI 消息：全宽文档感（无气泡，行高 1.55，Claude 式排版）
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: SelectableText(
        text,
        style: TextStyle(
          color: scheme.onSurface,
          fontSize: 15,
          height: 1.55,
        ),
      ),
    );
  }
}

/// Perplexity 式阶段指示条（searching→writing 逐级点亮）。
class GenPhaseIndicator extends StatelessWidget {
  final GenPhase phase;

  const GenPhaseIndicator({super.key, required this.phase});

  @override
  Widget build(BuildContext context) {
    final writing = phase == GenPhase.writing;
    final label = writing ? '正在生成…' : '正在处理…';

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 0, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: writing
            ? kMafwPrimary.withValues(alpha: 0.12)
            : kMafwGoalActive.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 12,
            height: 12,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: writing ? kMafwPrimary : kMafwGoalActive,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: writing ? kMafwPrimary : kMafwGoalActive,
            ),
          ),
        ],
      ),
    );
  }
}
