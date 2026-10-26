/** dataUrl → File（截图进既有媒体管道用；浏览器环境）。 */
export async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const blob = await (await fetch(dataUrl)).blob()
  return new File([blob], name, { type: blob.type || "image/png" })
}
