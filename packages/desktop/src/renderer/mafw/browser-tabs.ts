// 兼容 facade：Phase 2C 起 web tab 由 documents/browser-documents 持有。
// 保留旧命名（BrowserTab / browserTabs / browser-tab-N）给 BrowserDock、persistence 与测试。
export type { BrowserDocument as BrowserTab } from "./documents/browser-documents"
export type { OpenBrowserDocumentOpts as OpenBrowserTabOpts } from "./documents/browser-documents"
export {
  BROWSER_TAB_LIMIT,
  activeBrowserDocumentId as activeBrowserTabId,
  browserDocumentTitle as browserTabTitle,
  browserDocuments as browserTabs,
  closeBrowserDocument as closeBrowserTab,
  closeBrowserDocumentsToRight as closeBrowserTabsToRight,
  closeOtherBrowserDocuments as closeOtherBrowserTabs,
  createBrowserDocument as createBrowserTab,
  nextBrowserDocumentAfterClose as nextBrowserTabAfterClose,
  openBrowserDocument as openBrowserTab,
  resetBrowserDocumentsForTests as resetBrowserTabsForTests,
  setActiveBrowserDocument as setActiveBrowserTab,
  updateBrowserDocument as updateBrowserTab,
} from "./documents/browser-documents"
