// AC-1's fixture is byte-fixed: it renders `<Feature name="Bondi" />` without importing
// it, because the criterion only needs *a* component element to prove components are not
// stamped. The root tsconfig typechecks `packages/*/test`, so declare the name here rather
// than adding an import the criterion does not have.
declare const Feature: (props: { name: string }) => import('react').ReactElement;
