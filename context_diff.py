import json

# 3 道回退题
regression_ids = ['2b8f3739', 'gpt4_5501fe77', 'a08a253f']

# Load L1 runs (有 top_sessions)
with open('evaluation/longmemeval/results/2026-08-20T05-39-43-361Z/l1-run.jsonl', 'r', encoding='utf-8') as f:
    l1_run1 = {json.loads(l)['question_id']: json.loads(l) for l in f if l.strip()}

with open('evaluation/longmemeval/results/2026-08-20T06-56-25-133Z/l1-run.jsonl', 'r', encoding='utf-8') as f:
    l1_run2 = {json.loads(l)['question_id']: json.loads(l) for l in f if l.strip()}

# Load L2 runs (有 judge_score)
with open('evaluation/longmemeval/results/2026-08-20T05-39-43-361Z/l2-qa.jsonl', 'r', encoding='utf-8') as f:
    l2_run1 = {json.loads(l)['question_id']: json.loads(l) for l in f if l.strip()}

with open('evaluation/longmemeval/results/2026-08-20T06-56-25-133Z/l2-qa.jsonl', 'r', encoding='utf-8') as f:
    l2_run2 = {json.loads(l)['question_id']: json.loads(l) for l in f if l.strip()}

for qid in regression_ids:
    r1_l1 = l1_run1[qid]
    r2_l1 = l1_run2[qid]
    r1_l2 = l2_run1[qid]
    r2_l2 = l2_run2[qid]
    
    print(f'=== {qid} ===')
    print(f'Question: {r1_l1["question"][:80]}')
    print()
    print(f'Run 1 (05-39): score={r1_l2["judge_score"]} (correct)')
    print(f'Run 2 (06-56): score={r2_l2["judge_score"]} (wrong)')
    print()
    
    # 提取 top_sessions（前 10 个）
    r1_sessions = r1_l1['top_sessions'][:10]
    r2_sessions = r2_l1['top_sessions'][:10]
    
    print(f'Run 1 top-10 sessions: {r1_sessions}')
    print(f'Run 2 top-10 sessions: {r2_sessions}')
    print()
    
    # Diff
    r1_set = set(r1_sessions)
    r2_set = set(r2_sessions)
    
    only_in_r1 = r1_set - r2_set
    only_in_r2 = r2_set - r1_set
    common = r1_set & r2_set
    
    print(f'Only in Run 1 (lost): {list(only_in_r1)}')
    print(f'Only in Run 2 (added): {list(only_in_r2)}')
    print(f'Common: {len(common)} sessions')
    print()
    
    # 检查顺序变化
    if common:
        r1_order = [s for s in r1_sessions if s in common]
        r2_order = [s for s in r2_sessions if s in common]
        if r1_order != r2_order:
            print(f'Order changed!')
            print(f'  Run 1: {r1_order[:5]}')
            print(f'  Run 2: {r2_order[:5]}')
        else:
            print(f'Order unchanged for common sessions')
    print()
    print('=' * 80)
    print()
