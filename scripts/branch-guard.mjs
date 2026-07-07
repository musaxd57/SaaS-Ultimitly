import { execFileSync } from "node:child_process";

const allowedBranch = "codpexgreatwhale/08619";

function runGit(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

const currentBranch = runGit(["branch", "--show-current"]);

if (currentBranch !== allowedBranch) {
  console.error(
    [
      "Branch guard blocked this command.",
      `Allowed branch: ${allowedBranch}`,
      `Current branch: ${currentBranch || "(detached)"}`,
      "Switching, merging, rebasing, deleting, or pushing other branches is not allowed for this work."
    ].join("\n")
  );
  process.exit(1);
}

console.log(`Branch guard OK: ${allowedBranch}`);
