/// E10f-E: 移动端 triage 卡片的取值兜底（对齐真实 wire）。
///
/// 事实源：`GET /api/triage` 原样返回 `~/.mafw/triage/*.json`
/// （`gateway/src/routes/schemas/human-gate.ts` `TriageItemSchema`）：
/// `id` / `automationId` / `discoveredAt` / `source` / `summary` /
/// `proposedGoal?.title` / `state` / `userAction` / `deadline` / `llmSuggestions`。
///
/// 已退役的幻影字段 **`goalId` / `reason` / `severity` / `createdAt`** 从来没有任何
/// writer 写过（E10b-3 桌面侧已对齐，见 `packages/desktop/src/renderer/mafw/triage-model.ts`）；
/// 移动端此前用 `reason` 当描述兜底，断言永远落在空串上。本模块是页面唯一取值入口，
/// 纯函数、无 Flutter 依赖，便于单测。
library;

/// 状态徽标的视觉语气（页面负责映射到主题 token）。
enum TriageTone { neutral, warn, danger }

class TriageBadge {
  final String label;
  final TriageTone tone;

  const TriageBadge({required this.label, required this.tone});
}

class TriageCardModel {
  final String title;

  /// `source · discoveredAt · 截止 deadline`；三处都缺时是空串。
  final String meta;
  final TriageBadge badge;

  const TriageCardModel({required this.title, required this.meta, required this.badge});
}

const Map<String, TriageBadge> _stateBadges = {
  'PENDING_CONFIRMATION': TriageBadge(label: '待确认', tone: TriageTone.warn),
  'CONFIRMED': TriageBadge(label: '已确认', tone: TriageTone.neutral),
  'REJECTED': TriageBadge(label: '已拒绝', tone: TriageTone.danger),
};

String? _text(Object? value) {
  if (value is! String) return null;
  final trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

Map? _asMap(Object? value) => value is Map ? value : null;

String? _draftName(Map? summary, String key) => _text(_asMap(summary?[key])?['name']);

/// 标题优先级与桌面一致：proposedGoal.title → summary.title → 草稿名 → id。
String titleOf(Map<String, dynamic> item) {
  return _text(_asMap(item['proposedGoal'])?['title']) ??
      _text(_asMap(item['summary'])?['title']) ??
      _draftName(_asMap(item['summary']), 'skillDraft') ??
      _draftName(_asMap(item['summary']), 'axiomDraft') ??
      _text(item['id']) ??
      '未命名待决项';
}

/// 本地时间 `YYYY-MM-DD HH:mm`；缺失 / 非法一律 null（绝不渲染 "Invalid Date"）。
String? localizedTimestamp(Object? value) {
  final raw = _text(value);
  if (raw == null) return null;
  final at = DateTime.tryParse(raw);
  if (at == null) return null;
  final local = at.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} '
      '${two(local.hour)}:${two(local.minute)}';
}

String metaOf(Map<String, dynamic> item) {
  final parts = <String>[];
  final source = _text(item['source']);
  if (source != null) parts.add(source);
  final discovered = localizedTimestamp(item['discoveredAt']);
  if (discovered != null) parts.add(discovered);
  final deadline = localizedTimestamp(item['deadline']);
  if (deadline != null) parts.add('截止 $deadline');
  return parts.join(' · ');
}

const Map<String, int> _priorityRank = {'high': 3, 'medium': 2, 'low': 1};

/// 与桌面一致：徽标 = 真实 `state`，只追加**最高优先级**的 LLM 建议。
TriageBadge badgeOf(Map<String, dynamic> item) {
  final state = _text(item['state']) ?? '';
  final base = _stateBadges[state] ??
      TriageBadge(label: state.isEmpty ? '未知状态' : state, tone: TriageTone.neutral);

  final suggestions = item['llmSuggestions'];
  if (suggestions is! List || suggestions.isEmpty) return base;
  Map? best;
  for (final raw in suggestions) {
    final entry = _asMap(raw);
    if (entry == null) continue;
    final rank = _priorityRank[_text(entry['priority'])] ?? 0;
    final bestRank = best == null ? -1 : (_priorityRank[_text(best['priority'])] ?? 0);
    if (rank > bestRank) best = entry;
  }
  if (best == null) return base;
  final action = _text(best['action']) == 'confirm' ? '建议确认' : '建议拒绝';
  final priority = _text(best['priority']);
  final suffix = priority == null ? action : '$action $priority';
  return TriageBadge(label: '${base.label} · $suffix', tone: base.tone);
}

/// 页面唯一取值入口。
TriageCardModel triageCardModel(Map<String, dynamic> item) {
  return TriageCardModel(
    title: titleOf(item),
    meta: metaOf(item),
    badge: badgeOf(item),
  );
}
