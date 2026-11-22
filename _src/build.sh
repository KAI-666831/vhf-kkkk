set -e
cd "$(dirname "$0")"
rm -rf dist && mkdir -p dist/ort
cp public/* dist/
npx esbuild src/app.js --bundle --format=esm --minify --outfile=dist/app.js
npx esbuild src/worker.js --bundle --format=esm --outfile=dist/worker.js --external:onnxruntime-node --external:sharp --log-level=warning
for f in ort-wasm-simd-threaded.asyncify.mjs ort-wasm-simd-threaded.asyncify.wasm ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do cp node_modules/onnxruntime-web/dist/$f dist/ort/; done
ls -la dist dist/ort
