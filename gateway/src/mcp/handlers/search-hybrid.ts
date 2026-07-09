import { ToolHandler } from "../../types";

export const handleSearchHybrid: ToolHandler = async (args, { memory }) => {
  try {
    const query = args.query as string;
    const topK = (args.topK as number) || 20;
    const results = memory.search(query, topK);

    let filtered = results;
    if (args.memoryType) {
      filtered = filtered.filter((r: any) => r.type === args.memoryType);
    }

    return { content: [{ type: "text", text: JSON.stringify({ results: filtered, count: filtered.length }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
