/** A .yaml file imported by the Worker is its text (wrangler.toml's rule for .yaml files). */
declare module '*.yaml' {
  const text: string;
  export default text;
}
