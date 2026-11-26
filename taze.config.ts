export default {
  includeLocked: true,
  maturityPeriodExclude: ["@onkernel/*", "eve"],
  mode: "major",
  packageMode: {
    "@types/node": "minor",
    typescript: "minor",
  },
  recursive: true,
};
