import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ModuleInterface } from '@creit.tech/stellar-wallets-kit';
import {
  LanternModule,
  LANTERN_ID,
  toKitError,
} from '../packages/lantern-wallets-kit-module/src/lantern.module';

// The Stellar Wallets Kit module (#255) against a fake window.lantern. It must
// fit the kit's ModuleInterface (checked against 2.7.0 here; 1.9.5 has the
// same shape minus onChange) and turn Lantern's errors into the kit's.

// Compile-time: the module is a valid kit 2.x module.
const asKitModule: ModuleInterface = new LanternModule();
void asKitModule;

class FakeLanternError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Fn = ReturnType<typeof vi.fn>;
let api: {
  isLantern: boolean;
  apiVersion: number;
  [method: string]: Fn | boolean | number;
} & Record<
  | 'isConnected'
  | 'requestAccess'
  | 'getAddress'
  | 'getNetwork'
  | 'signTransaction'
  | 'signAuthEntry'
  | 'signMessage'
  | 'on',
  Fn
>;
let changeCb: (() => void) | undefined;
beforeEach(() => {
  changeCb = undefined;
  api = {
    isLantern: true,
    apiVersion: 1,
    isConnected: vi.fn(async () => ({ isConnected: true, apiVersion: 1 })),
    requestAccess: vi.fn(async () => ({ address: 'GADDR' })),
    getAddress: vi.fn(async () => ({ address: 'GADDR' })),
    getNetwork: vi.fn(async () => ({
      network: 'TESTNET',
      networkPassphrase: 'Test SDF Network ; September 2015',
    })),
    signTransaction: vi.fn(async () => ({ signedTxXdr: 'SIGNED', signerAddress: 'GADDR' })),
    signAuthEntry: vi.fn(async () => {
      throw new FakeLanternError(
        'unsupported',
        'This version of Lantern does not support that request yet',
      );
    }),
    signMessage: vi.fn(async () => {
      throw new FakeLanternError(
        'unsupported',
        'This version of Lantern does not support that request yet',
      );
    }),
    on: vi.fn((_e: string, cb: () => void) => (changeCb = cb)),
  };
  (globalThis as Record<string, unknown>).window = { lantern: api };
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('LanternModule', () => {
  it('describes itself to the kit', () => {
    const m = new LanternModule();
    expect(m).toMatchObject({
      moduleType: 'HOT_WALLET',
      productId: LANTERN_ID,
      productName: 'Lantern',
      productUrl: 'https://golantern.xyz',
      productIcon: 'https://golantern.xyz/wallet-icon.png',
    });
  });

  it('is available only when window.lantern is Lantern and answers', async () => {
    expect(await new LanternModule().isAvailable()).toBe(true);
    api.isConnected.mockRejectedValueOnce(new Error('gone'));
    expect(await new LanternModule().isAvailable()).toBe(false);
    (globalThis as Record<string, unknown>).window = { lantern: { isLantern: false } };
    expect(await new LanternModule().isAvailable()).toBe(false);
    (globalThis as Record<string, unknown>).window = {};
    expect(await new LanternModule().isAvailable()).toBe(false);
  });

  it('getAddress asks to connect unless told to skip it', async () => {
    const m = new LanternModule();
    expect(await m.getAddress()).toEqual({ address: 'GADDR' });
    expect(api.requestAccess).toHaveBeenCalledTimes(1);
    expect(await m.getAddress({ skipRequestAccess: true })).toEqual({ address: 'GADDR' });
    expect(api.getAddress).toHaveBeenCalledTimes(1);
    expect(api.requestAccess).toHaveBeenCalledTimes(1);
  });

  it('signTransaction passes the network and account through and returns the kit shape', async () => {
    const m = new LanternModule();
    expect(
      await m.signTransaction('XDR', {
        networkPassphrase: 'Test SDF Network ; September 2015',
        address: 'GADDR',
        path: 'x',
      }),
    ).toEqual({
      signedTxXdr: 'SIGNED',
      signerAddress: 'GADDR',
    });
    expect(api.signTransaction).toHaveBeenCalledWith('XDR', {
      networkPassphrase: 'Test SDF Network ; September 2015',
      address: 'GADDR',
    });
    await m.signTransaction('XDR');
    expect(api.signTransaction).toHaveBeenLastCalledWith('XDR', {});
  });

  it('refuses submit: Lantern signs only', async () => {
    await expect(
      new LanternModule().signTransaction('XDR', { submit: true }),
    ).rejects.toMatchObject({ code: -3, ext: 'unsupported' });
    expect(api.signTransaction).not.toHaveBeenCalled();
  });

  it('turns a rejection into the kit’s -4, keeping Lantern’s code in ext', async () => {
    api.signTransaction.mockRejectedValueOnce(
      new FakeLanternError('user_rejected', 'User rejected the request'),
    );
    await expect(new LanternModule().signTransaction('XDR')).rejects.toEqual({
      code: -4,
      message: 'User rejected the request',
      ext: 'user_rejected',
    });
  });

  it('maps not_allowed and account_mismatch to -3, the rest to -1', () => {
    expect(toKitError(new FakeLanternError('not_allowed', 'x')).code).toBe(-3);
    expect(toKitError(new FakeLanternError('account_mismatch', 'x')).code).toBe(-3);
    expect(toKitError(new FakeLanternError('network_mismatch', 'Wrong network'))).toEqual({
      code: -1,
      message: 'Wrong network',
      ext: 'network_mismatch',
    });
    expect(toKitError(undefined)).toEqual({ code: -1, message: 'Unhandled error from Lantern' });
  });

  it('signAuthEntry and signMessage reject as unsupported', async () => {
    await expect(new LanternModule().signAuthEntry('E')).rejects.toMatchObject({
      code: -1,
      ext: 'unsupported',
    });
    await expect(new LanternModule().signMessage('M')).rejects.toMatchObject({
      code: -1,
      ext: 'unsupported',
    });
  });

  it('every call fails with the kit shape when Lantern is not installed', async () => {
    (globalThis as Record<string, unknown>).window = {};
    await expect(new LanternModule().getAddress()).rejects.toMatchObject({
      code: -1,
      message: 'Lantern is not installed',
    });
    await expect(new LanternModule().getNetwork()).rejects.toMatchObject({ code: -1 });
  });

  it('onChange (kit 2.x) reports the new account and network, or the error after a disconnect', async () => {
    const events: unknown[] = [];
    new LanternModule().onChange((e) => events.push(e));
    changeCb!();
    await new Promise((r) => setTimeout(r, 0));
    api.getAddress.mockRejectedValueOnce(
      new FakeLanternError('not_allowed', 'This site is not connected to Lantern'),
    );
    changeCb!();
    await new Promise((r) => setTimeout(r, 0));
    expect(events).toEqual([
      {
        address: 'GADDR',
        network: 'TESTNET',
        networkPassphrase: 'Test SDF Network ; September 2015',
      },
      {
        address: '',
        network: '',
        networkPassphrase: '',
        error: { code: -3, message: 'This site is not connected to Lantern', ext: 'not_allowed' },
      },
    ]);
  });
});
