import { test } from "node:test"
import assert from "node:assert/strict"
import {
  closeImageLightbox,
  imageLightboxUrl,
  openImageLightbox,
  resetImageLightboxForTests,
} from "./image-lightbox"

test("image lightbox stores only data:image urls and closes", () => {
  resetImageLightboxForTests()
  assert.equal(imageLightboxUrl(), null)
  openImageLightbox("https://example.com/a.png")
  assert.equal(imageLightboxUrl(), null)
  openImageLightbox("data:image/png;base64,AAAA")
  assert.equal(imageLightboxUrl(), "data:image/png;base64,AAAA")
  openImageLightbox("data:image/svg+xml;base64,BBBB")
  assert.equal(imageLightboxUrl(), "data:image/svg+xml;base64,BBBB")
  closeImageLightbox()
  assert.equal(imageLightboxUrl(), null)
})
