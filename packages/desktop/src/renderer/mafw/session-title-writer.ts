// F3/F4: the ONE writer for a runtime session title (`session.updated`).
//
// Every surface reads titles through `session-title.ts`, so this writes the
// entity cache and stops there. Copying into the open tab list was the double
// write the entity cache removed — do not re-introduce it here.
//
// A resumed tab can receive an update before its project bucket is fetched, so
// an unknown id is created instead of being dropped (mirrors the user rename
// path in MafwShell). Role-named tabs are pinned at read time
// (`sessionTabTitle` → `Lead`), so the entity may carry the runtime title.
import { sessionEntities } from "./session-entities"

export function retitleSessionEntity(id: string, title: string): void {
  if (!id || typeof title !== "string" || !title.trim()) return
  if (sessionEntities.patch(id, { title })) return
  sessionEntities.upsert({ id, title })
}
