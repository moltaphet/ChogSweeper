// Copies shared/nft-resolver.ts into the packages that use it. Run after editing the shared file.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const dest of ["indexer/src/nft-resolver.ts", "web/lib/server/nft-resolver.ts"]) {
  mkdirSync(dirname(resolve(root, dest)), { recursive: true });
  copyFileSync(resolve(root, "shared/nft-resolver.ts"), resolve(root, dest));
  console.log("synced", dest);
}
