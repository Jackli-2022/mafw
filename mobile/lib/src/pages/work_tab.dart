/// Orcalore「工作」tab（首页）：项目、需要你与 Goal 活动流的聚合面。
///
/// Spec: `docs/superpowers/specs/2026-11-05-mobile-tailscale-pod-app-design.md`
/// §7.2（3-tab 结构）/ §7.3（工作 tab）。
///
/// 本文件在 Task 6 只是壳占位；Task 7 会把主体替换为
/// 品牌行 → 项目切换器 → 需要你置顶区 → Lead 入口条 → 五桶活动流 → FAB。
library;

import 'package:flutter/material.dart';

import '../theme.dart';

/// 「工作」tab 的占位 Widget。
///
/// Task 6 只要求 3-tab 壳能挂载它，因此这里不依赖 gateway client、不发起请求。
class WorkTab extends StatelessWidget {
  const WorkTab({super.key});

  @override
  Widget build(BuildContext context) {
    return const SafeArea(
      child: Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.space_dashboard_outlined,
                size: 40,
                color: MafwPalette.faint,
              ),
              SizedBox(height: 12),
              Text(
                '工作台',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: MafwPalette.text,
                ),
              ),
              SizedBox(height: 6),
              Text(
                '项目、需要你与 Goal 活动流将在这里汇总',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 12,
                  height: 1.4,
                  color: MafwPalette.dim,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
