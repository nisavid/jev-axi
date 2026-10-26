import { writeFileSync } from "node:fs";

// The executable-selector regression fails if production ever invokes this file.
writeFileSync(process.argv[2], "ran");
