export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["repo", "auth", "auth-fastify", "auth-prisma", "scheduling", "scheduling-fastify", "scheduling-prisma", "example"],
    ],
  },
};
