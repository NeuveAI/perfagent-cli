declare module "which" {
  interface WhichModule {
    readonly sync: (command: string) => string;
  }

  const which: WhichModule;
  export default which;
}
