/** Normalize file-diff metadata across opencode v1 and 2.1.
 *
 * 2.1: metadata.files is FileDiff.Info[] (file/patch/status/additions/deletions).
 * v1:  metadata.filediff is a single object; metadata.diff is a patch string.
 */
export function normalizeFileDiffs(metadata: any, fallbackFile?: string): any[] {
  const files = metadata?.files
  if (Array.isArray(files)) {
    const normalized = files.flatMap((file: any) => {
      if (!file || typeof file !== "object" || Array.isArray(file)) return []
      if (typeof file.file === "string" && file.file) return [file]
      if (typeof file.patch === "string" && file.patch) return [{ ...file, file: fallbackFile }]
      return []
    })
    if (normalized.length > 0) return normalized
  }

  const filediff = metadata?.filediff
  if (filediff && typeof filediff === "object" && !Array.isArray(filediff)) {
    return [{ ...filediff, file: filediff.file || fallbackFile }]
  }

  if (typeof metadata?.diff === "string" && metadata.diff) {
    return [{ file: fallbackFile, patch: metadata.diff }]
  }

  return []
}
