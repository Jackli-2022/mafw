// ESM entry: `node --import tsx --import @mafw/test-shim/register.mjs --test ...`
import { register } from "node:module";

register(new URL("./resolve-hook.mjs", import.meta.url));
