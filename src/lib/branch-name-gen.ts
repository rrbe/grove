const adjectives = [
  "swift", "calm", "bright", "bold", "warm", "cool", "keen", "fair",
  "glad", "pure", "soft", "wild", "free", "kind", "neat", "wise",
  "vast", "deep", "slim", "true", "rare", "safe", "rich", "firm",
  "crisp", "fresh", "light", "quick", "sharp", "clear", "proud", "still",
  "jolly", "vivid", "lucid", "noble", "prime", "rapid", "steady", "gentle",
  "merry", "loyal", "eager", "witty", "agile", "hardy", "quiet", "lively",
  "grand", "fine", "lean", "tidy", "snug", "brisk", "dense", "plain",
  "stout", "sleek", "blunt", "frank", "steep", "brief", "stark", "deft",
];

const nouns1 = [
  "maple", "river", "cedar", "storm", "crane", "frost", "pearl", "ridge",
  "ember", "coral", "bloom", "grove", "flint", "heron", "cliff", "brook",
  "birch", "delta", "forge", "haven", "blaze", "shore", "aspen", "drift",
  "crest", "marsh", "stone", "trace", "shade", "plume", "lunar", "thorn",
  "ocean", "prism", "amber", "cloud", "flame", "grain", "latch", "orbit",
  "robin", "solar", "vapor", "wheat", "brine", "chalk", "dune", "glade",
  "ivory", "jade", "knoll", "linen", "mint", "opal", "quill", "slate",
  "terra", "inlet", "vale", "wren", "alder", "basin", "clover", "fig",
];

const nouns2 = [
  "spark", "bridge", "tower", "field", "trail", "crown", "arrow", "wheel",
  "vault", "anvil", "beacon", "shard", "prism", "forge", "quest", "bloom",
  "drift", "haven", "ledge", "crest", "gate", "helm", "keep", "lance",
  "manor", "nexus", "pylon", "relay", "spire", "torch", "weave", "craft",
  "glyph", "lodge", "bench", "flask", "lathe", "pivot", "scope", "truss",
  "blade", "cairn", "depot", "grove", "knot", "loom", "notch", "patch",
  "ridge", "seal", "turf", "wing", "axis", "bolt", "chord", "frame",
  "hatch", "joint", "lever", "mount", "plank", "roost", "shelf", "spoke",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateBranchName(): string {
  return `worktree/${pick(adjectives)}-${pick(nouns1)}-${pick(nouns2)}`;
}
