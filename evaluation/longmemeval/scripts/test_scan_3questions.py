"""
Test scan on the 3 critical questions to see if it can find missing gold sessions.
"""
import json
import subprocess
import sys

def run_scan_test(qid, question, haystack_path):
    """Run scan on a single question."""
    print(f"\n=== Testing {qid} ===")
    print(f"Question: {question}")
    
    # Run L1 with scan enabled
    cmd = [
        'npx', 'ts-node', '--project', 'evaluation/longmemeval/tsconfig.json',
        'evaluation/longmemeval/src/l1-retrieval.ts',
        '--sample', '1',
        '--granularity', 'session',
        '--retriever', 'bm25',
        '--scan', 'true',
        '--data', haystack_path,
        '--questionId', qid,
    ]
    
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True, cwd='C:\\work\\work-loop\\opencode-plugin-mafw')
    
    # Parse output to find scan results
    output = result.stdout + result.stderr
    
    # Look for scan log lines
    scan_lines = [line for line in output.split('\n') if '[scan]' in line]
    for line in scan_lines:
        print(line)
    
    return output

# Load gold
with open('evaluation/longmemeval/data/longmemeval_s.json', 'r', encoding='utf-8') as f:
    gold_data = {item['question_id']: item for item in json.load(f)}

# Test the 3 questions
for qid in ['3c1045c8', '4dfccbf8', '09d032c9']:
    item = gold_data[qid]
    run_scan_test(qid, item['question'], 'evaluation/longmemeval/data/longmemeval_s.json')
