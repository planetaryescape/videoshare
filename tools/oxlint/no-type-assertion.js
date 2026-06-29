export default {
  meta: {
    name: "videoshare-strict"
  },
  rules: {
    "no-type-assertion": {
      meta: {
        type: "problem",
        docs: {
          description:
            "Disallow type assertions (`as` and `<Type>`). Narrow with type guards or proper inference instead."
        },
        schema: [],
        messages: {
          as: "Type assertions are banned. Narrow with type guards or proper inference instead of `{{raw}}`.",
          angle: "Type assertions are banned. Narrow with type guards or proper inference instead of `{{raw}}`."
        }
      },
      create(context) {
        return {
          TSAsExpression(node) {
            context.report({ node, messageId: "as", data: { raw: context.sourceCode.getText(node) } });
          },
          TSTypeAssertion(node) {
            context.report({ node, messageId: "angle", data: { raw: context.sourceCode.getText(node) } });
          }
        };
      }
    }
  }
};
