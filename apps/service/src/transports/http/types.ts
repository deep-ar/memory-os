export interface AdminRequestValidator {
  (
    host: string | undefined,
    origin: string | undefined,
  ): { readonly ok: true } | { readonly ok: false; readonly message: string };
}
