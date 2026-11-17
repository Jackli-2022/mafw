import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationPrefs,
} from "../shared/notifications"

export const NOTIFICATION_PREF_KEYS = {
  selfDrawn: "notifySelfDrawn",
  doNotDisturb: "notifyDoNotDisturb",
  fallbackToNative: "notifyFallbackToNative",
} as const

export interface NotificationPrefsStore {
  get(key: string, defaultValue?: unknown): unknown
  set(key: string, value: unknown): void
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

export function readNotificationPrefs(store: NotificationPrefsStore): NotificationPrefs {
  return {
    selfDrawn: bool(store.get(NOTIFICATION_PREF_KEYS.selfDrawn), DEFAULT_NOTIFICATION_PREFS.selfDrawn),
    doNotDisturb: bool(
      store.get(NOTIFICATION_PREF_KEYS.doNotDisturb),
      DEFAULT_NOTIFICATION_PREFS.doNotDisturb,
    ),
    fallbackToNative: bool(
      store.get(NOTIFICATION_PREF_KEYS.fallbackToNative),
      DEFAULT_NOTIFICATION_PREFS.fallbackToNative,
    ),
  }
}

export function writeNotificationPrefs(
  store: NotificationPrefsStore,
  patch: Partial<NotificationPrefs>,
): NotificationPrefs {
  const current = readNotificationPrefs(store)
  const next: NotificationPrefs = {
    selfDrawn: typeof patch.selfDrawn === "boolean" ? patch.selfDrawn : current.selfDrawn,
    doNotDisturb: typeof patch.doNotDisturb === "boolean" ? patch.doNotDisturb : current.doNotDisturb,
    fallbackToNative:
      typeof patch.fallbackToNative === "boolean" ? patch.fallbackToNative : current.fallbackToNative,
  }
  store.set(NOTIFICATION_PREF_KEYS.selfDrawn, next.selfDrawn)
  store.set(NOTIFICATION_PREF_KEYS.doNotDisturb, next.doNotDisturb)
  store.set(NOTIFICATION_PREF_KEYS.fallbackToNative, next.fallbackToNative)
  return next
}
