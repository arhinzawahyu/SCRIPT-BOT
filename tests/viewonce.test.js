// Self-check: deteksi viewonce di quoted reply (SATU-SATUNYA jalur capture di bot ini).
const assert = require("assert");
const { getViewOnceContent } = require("../src/media");

// viewOnceMessageV2 wrap
assert(getViewOnceContent({ viewOnceMessageV2: { message: { imageMessage: { viewOnce: true, mediaKey: "k", url: "u", directPath: "d", caption: "rahasia" } } } })?.type === "image", "v2 image");

// ephemeral + viewOnceMessage nested
assert(getViewOnceContent({ ephemeralMessage: { message: { viewOnceMessage: { message: { videoMessage: { viewOnce: true } } } } } })?.type === "video", "ephemeral+vo video");

// viewOnceMessageV2Extension audio
assert(getViewOnceContent({ viewOnceMessageV2Extension: { message: { audioMessage: { viewOnce: true } } } })?.type === "audio", "v2ext audio");

// plain image tanpa flag viewOnce = BUKAN viewonce
assert(getViewOnceContent({ imageMessage: { viewOnce: false, url: "x" } }) === null, "plain image rejected");

// null input
assert(getViewOnceContent(null) === null && getViewOnceContent(undefined) === null, "null inputs");

console.log("viewonce detection OK");