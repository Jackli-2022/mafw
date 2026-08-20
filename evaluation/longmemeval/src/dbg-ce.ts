(async () => {
  const { pipeline, env } = await new Function('spec', 'return import(spec)')('@xenova/transformers');
  env.remoteHost = (process.env.HF_ENDPOINT || 'https://hf-mirror.com/');
  const classifier: any = await pipeline('text-classification', 'Xenova/bge-reranker-base');
  const q = 'What is the capital of France?';
  const relevant = 'Paris is the capital of France.';
  const irrelevant = 'The cat sat on the mat.';
  const similar = 'What city is the capital of France?';
  for (const [name, text] of Object.entries({ relevant, irrelevant, similar })) {
    const out = await classifier([q, text]);
    console.log(name, '->', JSON.stringify(out));
  }
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
