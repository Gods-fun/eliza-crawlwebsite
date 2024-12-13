import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/index.ts"],
    outDir: "dist",
    sourcemap: true,
    clean: true,
    format: ["esm"],
    external: [
        "dotenv",
        "fs",
        "path",
        "@reflink/reflink",
        "@node-llama-cpp",
        "https",
        "http",
        "agentkeepalive",
    ],
    noExternal: [/selenium-webdriver/],
    banner: {
        js: `
          import { createRequire } from 'module';
          import { fileURLToPath } from 'url';
          import { dirname, join } from 'path';
          const require = createRequire(import.meta.url);
          const __filename = fileURLToPath(import.meta.url);
          const __dirname = dirname(__filename);
          process.env.CHROMEDRIVER_PATH = join(__dirname, 'node_modules', 'chromedriver', 'lib', 'chromedriver');
        `,
    }
});