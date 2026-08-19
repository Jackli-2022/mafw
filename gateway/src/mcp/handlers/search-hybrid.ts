import { config } from "../../config";
import { ToolHandler } from "../../types";
import { HarmonicUnitFileStore } from "../../memory/harmonic-file-store";

export const handleSearchHybrid: ToolHandler = async (args, { memory, mafwDir }) => {
  try {
    const query = args.query as string;
    const topK = (args.topK as number) || config.search.defaultTopK;
    const retriever = (args.retriever as 'token' | 'bm25' | undefined) || config.search.defaultRetriever;
    const results = memory.search(query, topK * 2, { retriever });

    let filtered = results;
    if (args.memoryType) {
      filtered = filtered.filter((r: any) => r.type === args.memoryType);
    }
    filtered = filtered.slice(0, topK);

    // Enrich with full memory_value from OKF store.
    const store = new HarmonicUnitFileStore(mafwDir || config.resolvePath());
    const enriched: any[] = [];
    for (const r of filtered) {
      let unit = null;
      try {
        unit = await store.read(r.id);
      } catch { /* keep entry-only */ }
      enriched.push({ ...r, memory_value: unit?.memory_value || (r as any).memory_value || '' });
    }

    return { content: [{ type: "text", text: JSON.stringify({ results: enriched, count: enriched.length }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
