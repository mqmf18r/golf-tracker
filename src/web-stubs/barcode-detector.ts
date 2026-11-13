// `barcode-detector`'s package.json "exports" map doesn't resolve cleanly
// under this project's Metro (same class of issue as expo-file-system's
// SDK 57 export map — see pixelblob.ts). expo-camera's web build only
// reaches this via a dynamic `import('barcode-detector')` inside its QR/
// barcode scanner path, which we never use (ShotVision only takes still
// photos) — but Metro still resolves every import() statically to build
// the bundle, so an unresolvable target crashes the ENTIRE web build, not
// just barcode scanning. Stub it out on web only; native builds never hit
// this file (see metro.config.js).
export class BarcodeDetector {
  static async getSupportedFormats(): Promise<string[]> { return []; }
  async detect(): Promise<unknown[]> { return []; }
}
