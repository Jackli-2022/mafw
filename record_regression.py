"""
回归集记录工具：记录每次 L2 运行的错题名单，支持 diff 对比。

用法：
  python record_regression.py <l2_summary_path> <l2_qa_path> [baseline_path]

示例：
  python record_regression.py results/2026-08-20T05-39-43-361Z/l2-summary.json results/2026-08-20T05-39-43-361Z/l2-qa.jsonl
  python record_regression.py results/2026-08-20T06-56-25-133Z/l2-summary.json results/2026-08-20T06-56-25-133Z/l2-qa.jsonl results/2026-08-20T05-39-43-361Z/regression_set.jsonl
"""

import json
import sys
from pathlib import Path
from datetime import datetime

def load_l2_results(qa_path):
    """加载 L2 QA 结果"""
    results = {}
    with open(qa_path, 'r', encoding='utf-8') as f:
        for line in f:
            if line.strip():
                item = json.loads(line)
                results[item['question_id']] = {
                    'question_type': item['question_type'],
                    'judge_score': item['judge_score'],
                    'question': item['question'][:100],  # 截断避免过长
                }
    return results

def record_regression(summary_path, qa_path, output_path):
    """记录回归集"""
    with open(summary_path, 'r', encoding='utf-8') as f:
        summary = json.load(f)
    
    results = load_l2_results(qa_path)
    
    # 提取错题
    wrong_answers = []
    for qid, data in results.items():
        if data['judge_score'] == 0:
            wrong_answers.append({
                'question_id': qid,
                'question_type': data['question_type'],
                'question': data['question'],
            })
    
    # 按 question_type 分组统计
    by_type = {}
    for item in wrong_answers:
        qt = item['question_type']
        if qt not in by_type:
            by_type[qt] = []
        by_type[qt].append(item['question_id'])
    
    regression_record = {
        'timestamp': datetime.now().isoformat(),
        'summary_path': str(summary_path),
        'qa_path': str(qa_path),
        'overall_accuracy': summary['overall']['accuracy'],
        'total_wrong': len(wrong_answers),
        'wrong_by_type': by_type,
        'wrong_answers': wrong_answers,
    }
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(regression_record, f, indent=2, ensure_ascii=False)
    
    print(f"回归集已记录: {output_path}")
    print(f"  总错题: {len(wrong_answers)}")
    print(f"  Overall accuracy: {summary['overall']['accuracy']:.3f}")
    for qt, qids in by_type.items():
        print(f"  {qt}: {len(qids)} 题")

def diff_regression(baseline_path, current_path):
    """对比两次运行的错题变化"""
    with open(baseline_path, 'r', encoding='utf-8') as f:
        baseline = json.load(f)
    with open(current_path, 'r', encoding='utf-8') as f:
        current = json.load(f)
    
    baseline_wrong = set(item['question_id'] for item in baseline['wrong_answers'])
    current_wrong = set(item['question_id'] for item in current['wrong_answers'])
    
    # 新增错题（回退）
    regressions = current_wrong - baseline_wrong
    # 修复的错题
    improvements = baseline_wrong - current_wrong
    # 持续错题
    persistent = baseline_wrong & current_wrong
    
    print("\n=== 回归集 Diff ===")
    print(f"Baseline: {baseline['timestamp']} (accuracy: {baseline['overall_accuracy']:.3f}, wrong: {baseline['total_wrong']})")
    print(f"Current:  {current['timestamp']} (accuracy: {current['overall_accuracy']:.3f}, wrong: {current['total_wrong']})")
    print()
    
    if regressions:
        print(f"[!] 新增错题（回退）: {len(regressions)} 题")
        for qid in regressions:
            item = next(i for i in current['wrong_answers'] if i['question_id'] == qid)
            print(f"  - {qid} [{item['question_type']}]: {item['question'][:60]}")
    else:
        print("[OK] 无新增错题")
    print()
    
    if improvements:
        print(f"[OK] 修复的错题: {len(improvements)} 题")
        for qid in improvements:
            item = next(i for i in baseline['wrong_answers'] if i['question_id'] == qid)
            print(f"  + {qid} [{item['question_type']}]: {item['question'][:60]}")
    else:
        print("无修复的错题")
    print()
    
    if persistent:
        print(f"持续错题: {len(persistent)} 题")
        for qid in persistent:
            item = next(i for i in current['wrong_answers'] if i['question_id'] == qid)
            print(f"  * {qid} [{item['question_type']}]: {item['question'][:60]}")
    print()
    
    # 返回 diff 结果供程序使用
    return {
        'regressions': list(regressions),
        'improvements': list(improvements),
        'persistent': list(persistent),
    }

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    
    summary_path = Path(sys.argv[1])
    qa_path = Path(sys.argv[2])
    
    # 生成输出路径
    output_path = summary_path.parent / 'regression_set.jsonl'
    
    # 记录当前运行
    record_regression(summary_path, qa_path, output_path)
    
    # 如果提供了 baseline，做 diff
    if len(sys.argv) >= 4:
        baseline_path = Path(sys.argv[3])
        if baseline_path.exists():
            diff_regression(baseline_path, output_path)
        else:
            print(f"Baseline 不存在: {baseline_path}")
