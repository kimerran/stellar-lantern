// Lantern for Stellar Wallets Kit (#255): a wallet module that lets any dApp
// using @creit.tech/stellar-wallets-kit list "Lantern" in its wallet picker.
//
// No imports, so a dApp can copy this one file into its codebase until the
// module is upstream in the kit. It matches the kit's ModuleInterface in both
// 1.x (1.9.5, what Paiflow runs) and 2.x (2.7.0); the extra `onChange` is
// ignored by 1.x.
//
// It talks to window.lantern, the page API the Lantern Chrome extension adds
// to every https page (docs: https://golantern.xyz/docs/reference/connect/).
// Every request opens Lantern's own approval window; signing is sign-only, and
// Lantern never submits a transaction.

/** The kit's module types; the values are the same strings in 1.x and 2.x. */
const HOT_WALLET = 'HOT_WALLET';

export const LANTERN_ID = 'lantern';

/** What window.lantern answers, as far as this module needs it. */
interface LanternError extends Error {
  code?: string;
}
interface LanternApi {
  isLantern: true;
  apiVersion: number;
  isConnected(): Promise<{ isConnected: boolean; apiVersion?: number }>;
  requestAccess(): Promise<{ address: string }>;
  getAddress(): Promise<{ address: string }>;
  getNetwork(): Promise<{ network: string; networkPassphrase: string }>;
  signTransaction(
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<{ signedTxXdr: string; signerAddress: string }>;
  signAuthEntry(
    authEntry: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<unknown>;
  signMessage(
    message: string,
    opts?: { networkPassphrase?: string; address?: string },
  ): Promise<unknown>;
  on(event: 'change', cb: (data: Record<string, unknown>) => void): void;
}

/** The kit's error shape: `{ code, message, ext? }`, as its parseError builds it. */
export interface KitError {
  code: number;
  message: string;
  ext?: string;
}

/**
 * Lantern's error codes → the kit's numbers, following Freighter's: -4 the
 * user declined, -3 not allowed, -1 anything else. Lantern's own code is kept
 * in `ext` so a dApp can be precise (e.g. `network_mismatch`).
 */
export function toKitError(e: unknown): KitError {
  const err = e as LanternError | undefined;
  const code = typeof err?.code === 'string' ? err.code : undefined;
  const kitCode =
    code === 'user_rejected' ? -4 : code === 'not_allowed' || code === 'account_mismatch' ? -3 : -1;
  const message =
    typeof err?.message === 'string' && err.message ? err.message : 'Unhandled error from Lantern';
  return { code: kitCode, message, ...(code ? { ext: code } : {}) };
}

function lantern(): LanternApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = (window as unknown as { lantern?: LanternApi }).lantern;
  return api?.isLantern === true ? api : undefined;
}

export class LanternModule {
  moduleType = HOT_WALLET as never;
  productId = LANTERN_ID;
  productName = 'Lantern';
  productUrl = 'https://golantern.xyz';
  productIcon = 'https://golantern.xyz/wallet-icon.png';

  private api(): LanternApi {
    const api = lantern();
    if (!api) throw { code: -1, message: 'Lantern is not installed' } satisfies KitError;
    return api;
  }

  /** True when the Lantern extension is installed and answering on this page. */
  async isAvailable(): Promise<boolean> {
    const api = lantern();
    if (!api) return false;
    try {
      return (await api.isConnected()).isConnected === true;
    } catch {
      return false;
    }
  }

  /**
   * The connected account. Without `skipRequestAccess` this asks the user to
   * connect the site first (Lantern's window), and answers at once for a site
   * that's already connected.
   */
  async getAddress(params?: {
    path?: string;
    skipRequestAccess?: boolean;
  }): Promise<{ address: string }> {
    try {
      const api = this.api();
      const { address } = params?.skipRequestAccess
        ? await api.getAddress()
        : await api.requestAccess();
      return { address };
    } catch (e) {
      throw toKitError(e);
    }
  }

  /**
   * Sign a transaction the dApp built. Lantern reviews it in its own window,
   * signs it, and returns it; it never submits (`submit: true` is refused).
   */
  async signTransaction(
    xdr: string,
    opts?: {
      networkPassphrase?: string;
      address?: string;
      path?: string;
      submit?: boolean;
      submitUrl?: string;
    },
  ): Promise<{ signedTxXdr: string; signerAddress?: string }> {
    if (opts?.submit) {
      throw {
        code: -3,
        message: 'Lantern signs only; submit the transaction yourself.',
        ext: 'unsupported',
      } satisfies KitError;
    }
    try {
      const { signedTxXdr, signerAddress } = await this.api().signTransaction(xdr, {
        ...(opts?.networkPassphrase ? { networkPassphrase: opts.networkPassphrase } : {}),
        ...(opts?.address ? { address: opts.address } : {}),
      });
      return { signedTxXdr, signerAddress };
    } catch (e) {
      throw toKitError(e);
    }
  }

  /** Not supported by Lantern yet: rejects with `ext: 'unsupported'`. */
  async signAuthEntry(
    authEntry: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedAuthEntry: string; signerAddress?: string }> {
    try {
      return (await this.api().signAuthEntry(authEntry, opts)) as {
        signedAuthEntry: string;
        signerAddress?: string;
      };
    } catch (e) {
      throw toKitError(e);
    }
  }

  /** Not supported by Lantern yet: rejects with `ext: 'unsupported'`. */
  async signMessage(
    message: string,
    opts?: { networkPassphrase?: string; address?: string; path?: string },
  ): Promise<{ signedMessage: string; signerAddress?: string }> {
    try {
      return (await this.api().signMessage(message, opts)) as {
        signedMessage: string;
        signerAddress?: string;
      };
    } catch (e) {
      throw toKitError(e);
    }
  }

  async getNetwork(): Promise<{ network: string; networkPassphrase: string }> {
    try {
      const { network, networkPassphrase } = await this.api().getNetwork();
      return { network, networkPassphrase };
    } catch (e) {
      throw toKitError(e);
    }
  }

  /**
   * Kit 2.x: called with the account and network whenever Lantern reports a
   * change (account, network, or the site was disconnected). After a
   * disconnect the event carries the kit error instead.
   */
  onChange(
    callback: (event: {
      address: string;
      network: string;
      networkPassphrase: string;
      error?: KitError;
    }) => void,
  ): void {
    const api = lantern();
    if (!api) return;
    api.on('change', () => {
      void Promise.all([api.getAddress(), api.getNetwork()]).then(
        ([{ address }, { network, networkPassphrase }]) =>
          callback({ address, network, networkPassphrase }),
        (e) => callback({ address: '', network: '', networkPassphrase: '', error: toKitError(e) }),
      );
    });
  }
}
