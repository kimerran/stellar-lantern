// The scanner lives in packages/lantern-scanner/ (#50, MIT). This shim keeps
// `@core/scan` working for the popup / background / recovery code so the app
// never has to know the scanner is a separate package.
export * from '@lantern/scanner';
