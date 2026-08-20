import json

ids = ['81507db6', '2b8f3739', 'gpt4_5501fe77', '3a704032', '3c1045c8', 'a08a253f']

with open('evaluation/longmemeval/data/longmemeval_s.json', 'r', encoding='utf-8') as f:
    data = json.load(f)
    for item in data:
        if item['question_id'] in ids:
            gold_ids = item.get('answer_session_ids', [])
            print(f"{item['question_id']}: gold_count={len(gold_ids)}, gold_ids={', '.join(gold_ids)}")
