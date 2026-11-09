import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readGatewayReleaseExpectation } from "./gateway-release-expectation"

describe("readGatewayReleaseExpectation", () => {
  test("reads release.json next to the managed entry and binds the desktop channel", () => {
    const dir = mkdtempSync(join(tmpdir(), "mafw-release-expectation-"))
    try {
      writeFileSync(join(dir, "index.js"), "")
      writeFileSync(join(dir, "release.json"), JSON.stringify({
        productVersion: "5.2.0",
        gatewayVersion: "5.2.0",
        experienceVersion: "2026.11.1",
        minimumClientExperienceVersion: "2026.11.0",
        schemaEpoch: 1,
      }))
      expect(readGatewayReleaseExpectation(join(dir, "index.js"), "prod")).toEqual({
        gatewayVersion: "5.2.0",
        experienceVersion: "2026.11.1",
        minimumClientExperienceVersion: "2026.11.0",
        schemaEpoch: 1,
        channel: "prod",
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("fails with the release path when metadata is missing or malformed", () => {
    const dir = mkdtempSync(join(tmpdir(), "mafw-release-expectation-"))
    try {
      writeFileSync(join(dir, "index.js"), "")
      expect(() => readGatewayReleaseExpectation(join(dir, "index.js"), "prod"))
        .toThrow(join(dir, "release.json"))
      writeFileSync(join(dir, "release.json"), "{}")
      expect(() => readGatewayReleaseExpectation(join(dir, "index.js"), "prod"))
        .toThrow(join(dir, "release.json"))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
