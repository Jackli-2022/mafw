import io

p = r"packages/desktop/src/renderer/mafw/components/ChatPane.tsx"
lines = io.open(p, encoding="utf-8").read().split("\n")
# delete TTS_ENGINE_SOURCE_LABEL constant block: lines 62-66 (1-indexed) => idx 61..66
assert "TTS_ENGINE_SOURCE_LABEL" in lines[61], lines[61]
assert lines[65] == "}", repr(lines[65])
del lines[61:66]
io.open(p, "w", encoding="utf-8", newline="\n").write("\n".join(lines))
print("constant removed, new total:", len(lines))
