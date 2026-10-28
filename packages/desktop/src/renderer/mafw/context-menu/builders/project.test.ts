import { expect, test } from "bun:test"
import { buildProjectMenu } from "./project"
import { ids } from "../test-helpers"
import { validateMenu } from "../model"

test("project menu is new session / reveal / copy path", () => {
  const m = buildProjectMenu({ id: "p", path: "C:/work/x" })
  expect(ids(m)).toEqual(["project.newSession", "project.reveal", "project.copyPath"])
  expect(validateMenu(m)).toEqual([])
})
